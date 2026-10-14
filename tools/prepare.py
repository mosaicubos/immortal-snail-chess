#!/usr/bin/env python3

import argparse
import base64
import hashlib
import io
import json
import re
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
LICENSES = VENDOR / "licenses"

CHESS_VERSION = "1.4.0"
STOCKFISH_VERSION = "17.1.0"

HEADERS = {
    "User-Agent": "ImmortalSnailChess-DependencyPreparation/1.0"
}


def download(url):
    print("Descargando:", url)
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def load_package(name, version):
    metadata_url = f"https://registry.npmjs.org/{name}/{version}"
    metadata = json.loads(download(metadata_url))

    archive = download(metadata["dist"]["tarball"])
    integrity = metadata["dist"].get("integrity", "")

    valid = False
    for entry in integrity.split():
        algorithm, separator, expected = entry.partition("-")
        if not separator or algorithm not in ("sha512", "sha256"):
            continue

        actual = base64.b64encode(
            hashlib.new(algorithm, archive).digest()
        ).decode("ascii")

        if actual == expected:
            valid = True
            break

    if not valid:
        raise RuntimeError(
            f"No se pudo verificar dist.integrity de {name}@{version}."
        )

    files = {}

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        for member in package.getmembers():
            if not member.isfile():
                continue

            path = PurePosixPath(member.name)

            if ".." in path.parts or path.is_absolute():
                raise RuntimeError("Ruta insegura dentro del paquete.")

            stream = package.extractfile(member)
            if stream:
                files[str(path)] = stream.read()

    return metadata, files


def find_license(files, preferred_names):
    candidates = []

    for name, content in files.items():
        basename = PurePosixPath(name).name.lower()

        if basename in preferred_names:
            candidates.append((name.count("/"), name, content))

    if not candidates:
        raise RuntimeError(
            "El paquete no contiene una licencia reconocible."
        )

    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[0][2]


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    print("Escrito:", path.relative_to(ROOT))


def source_license(archive):
    """
    Busca el texto GPL-3.0 dentro del archivo fuente descargado.
    Conserva los bytes originales de la licencia.
    Admite COPYING.txt, Copying.txt, LICENSE.md y variantes.
    """
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
        candidates = []

        for member in source.getmembers():
            if not member.isfile():
                continue

            basename = PurePosixPath(member.name).name.lower()

            is_license_name = (
                basename.startswith("copying")
                or basename.startswith("license")
                or basename.startswith("licence")
                or basename.startswith("gpl")
            )

            if is_license_name:
                candidates.append(member)

        # Prioriza documentos situados cerca de la raíz del repositorio.
        candidates.sort(
            key=lambda member: (
                member.name.count("/"),
                member.name.lower(),
            )
        )

        for member in candidates:
            stream = source.extractfile(member)
            if stream is None:
                continue

            with stream:
                content = stream.read()

            # Normaliza solo para reconocer el texto.
            # El archivo que se guarda conserva el contenido original.
            text = content.decode("utf-8-sig", errors="replace")
            normalized = " ".join(text.upper().split())

            has_gpl_title = "GNU GENERAL PUBLIC LICENSE" in normalized
            has_version_three = re.search(
                r"\bVERSION\s+3\b", normalized
            ) is not None
            has_license_body = "TERMS AND CONDITIONS" in normalized

            if has_gpl_title and has_version_three and has_license_body:
                print("Licencia GPL-3.0 encontrada:", member.name)
                return content

        inspected = "\n".join(
            f"  - {member.name}" for member in candidates
        ) or "  (ningún archivo con nombre de licencia)"

        raise RuntimeError(
            "No se pudo identificar el texto completo GPL-3.0 "
            "en el archivo fuente.\n"
            "Archivos candidatos encontrados:\n"
            + inspected
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stockfish-ref",
        help=(
            "Commit exacto de nmrugg/stockfish.js, solo si los metadatos "
            "npm no incluyen gitHead. Debe corresponder a stockfish 16.1.0."
        ),
    )
    args = parser.parse_args()

    VENDOR.mkdir(parents=True, exist_ok=True)
    LICENSES.mkdir(parents=True, exist_ok=True)

    chess_meta, chess_files = load_package("chess.js", CHESS_VERSION)

    chess_path = "package/dist/esm/chess.js"
    if chess_path not in chess_files:
        raise RuntimeError("No se encontró el módulo ESM esperado de chess.js.")

    write(VENDOR / "chess.js", chess_files[chess_path])
    write(
        LICENSES / "chess-LICENSE",
        find_license(chess_files, {"license", "license.txt", "license.md"}),
    )

    sf_meta, sf_files = load_package("stockfish", STOCKFISH_VERSION)

    candidates = [
        name for name in sf_files
        if "lite-single" in PurePosixPath(name).name.lower()
        and name.endswith(".js")
        and not name.endswith(".worker.js")
    ]

    candidates.sort()

    compatible = []
    for js_name in candidates:
        wasm_name = js_name[:-3] + ".wasm"
        if wasm_name in sf_files:
            compatible.append((js_name, wasm_name))

    if len(compatible) != 1:
        raise RuntimeError(
            "No se encontró exactamente un par lite-single JS/WASM. "
            f"Candidatos encontrados: {compatible}"
        )

    js_name, wasm_name = compatible[0]
    js_basename = PurePosixPath(js_name).name
    wasm_basename = PurePosixPath(wasm_name).name

    write(VENDOR / "stockfish" / js_basename, sf_files[js_name])
    write(VENDOR / "stockfish" / wasm_basename, sf_files[wasm_name])

    ref = args.stockfish_ref or sf_meta.get("gitHead")

    if not ref or not re.fullmatch(r"[0-9a-fA-F]{40}", ref):
        raise RuntimeError(
            "Falta un gitHead verificable. Consulta los metadatos de "
            "stockfish@16.1.0 y utiliza --stockfish-ref con su commit exacto."
        )

    source_url = (
        "https://codeload.github.com/nmrugg/stockfish.js/tar.gz/" + ref
    )
    sources = download(source_url)

    # Conservamos el archivo original completo, dividido en partes
    # de 48 MiB para no superar el límite por archivo de GitHub.
    # No se eliminan archivos ni recursos del código fuente.
    part_size = 48 * 1024 * 1024
    source_parts = []

    # Elimina restos de preparaciones anteriores.
    old_archive = LICENSES / "stockfish-source.tar.gz"
    if old_archive.exists():
        old_archive.unlink()

    for old_part in LICENSES.glob("stockfish-source.tar.gz.part*"):
        if old_part.is_file():
            old_part.unlink()

    for index, offset in enumerate(range(0, len(sources), part_size), start=1):
        part_name = f"stockfish-source.tar.gz.part{index:03d}"
        part_content = sources[offset:offset + part_size]

        write(LICENSES / part_name, part_content)
        source_parts.append(part_name)

    source_manifest = {
        "filename": "stockfish-source.tar.gz",
        "source_url": source_url,
        "commit": ref,
        "size": len(sources),
        "sha256": hashlib.sha256(sources).hexdigest(),
        "parts": source_parts,
    }

    write(
        LICENSES / "stockfish-source-parts.json",
        (
            json.dumps(source_manifest, indent=2) + "\n"
        ).encode("utf-8"),
    )

    source_parts_description = "\n".join(
        f"  {name}" for name in source_parts
    )

    # Obtiene la licencia directamente de las fuentes del commit
    # asociado al paquete, sin depender del nombre usado en npm.
    copying = source_license(sources)
    write(LICENSES / "stockfish-COPYING", copying)

    manifest = {
        "package": "stockfish",
        "version": STOCKFISH_VERSION,
        "variant": "lite-single",
        "worker": f"stockfish/{js_basename}",
        "wasm": f"stockfish/{wasm_basename}",
    }

    write(
        VENDOR / "engine.json",
        (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
    )

    sources_text = f"""DEPENDENCIAS DE IMMORTAL SNAIL CHESS

chess.js
Versión: {CHESS_VERSION}
Licencia: BSD-2-Clause
Repositorio: https://github.com/jhlywa/chess.js
Paquete: {chess_meta["dist"]["tarball"]}
Integridad npm: {chess_meta["dist"]["integrity"]}
Licencia incluida: chess-LICENSE

Stockfish.js / Stockfish
Paquete npm: stockfish@{STOCKFISH_VERSION}
Variante distribuida: lite-single, un solo hilo
Licencia: GPL-3.0
Repositorio: https://github.com/nmrugg/stockfish.js
Paquete: {sf_meta["dist"]["tarball"]}
Integridad npm: {sf_meta["dist"]["integrity"]}
Commit de fuentes: {ref}
Archivo de fuentes: stockfish-source.tar.gz, distribuido en partes.
Las partes deben concatenarse en el orden del manifiesto.
Manifiesto: stockfish-source-parts.json
SHA-256 del archivo reconstruido: {source_manifest["sha256"]}
Partes incluidas:
{source_parts_description}
Instrucciones de reconstrucción: README.md del proyecto.
Origen de fuentes: {source_url}
Licencia incluida: stockfish-COPYING
Binarios distribuidos sin modificaciones:
  ../stockfish/{js_basename}
  ../stockfish/{wasm_basename}

El código fuente correspondiente y los avisos deben acompañar
la redistribución. Si cambias los binarios, debes actualizar también
las fuentes, scripts e instrucciones necesarios para reconstruirlos.
Consulta el README principal y las instrucciones de compilación upstream.
"""

    write(LICENSES / "SOURCES.txt", sources_text.encode("utf-8"))

    print()
    print("Preparación completada.")
    print("Ahora ejecuta: python3 -m http.server 8080")
    print("Abre: http://localhost:8080/")
    print("Pruebas: http://localhost:8080/tests/")


if __name__ == "__main__":
    main()