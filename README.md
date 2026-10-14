# Immortal Snail Chess

Juego estático de ajedrez con dos caracoles inmortales.

- Dos jugadores locales.
- Contra Stockfish WebAssembly.
- Cuatro dificultades.
- Sin backend, cuentas ni servicios remotos durante la partida.
- Compatible con alojamiento estático y rutas relativas de GitHub Pages.

## 1. Dependencias

Versiones fijadas:

- chess.js 1.4.0 — BSD-2-Clause.
- stockfish 16.1.0, compilación lite-single — GPL-3.0.

Se utiliza un motor de un solo hilo para no depender de SharedArrayBuffer,
COOP, COEP ni cabeceras que GitHub Pages no permite configurar libremente.

Las dependencias se descargan una vez, durante la preparación del proyecto.
Después se sirven desde la misma carpeta que la aplicación.

## 2. Preparación

Necesitas Python 3 con acceso a Internet.

Desde la raíz:

    python3 tools/prepare.py

En Windows también puede utilizarse:

    py tools/prepare.py

El script:

1. Descarga versiones exactas de npm.
2. Verifica sus hashes dist.integrity.
3. Copia el módulo ESM de chess.js.
4. Localiza el par Stockfish lite-single JS/WASM.
5. Conserva los nombres originales del motor.
6. Genera vendor/engine.json.
7. Incluye licencias y un archivo fuente del repositorio de Stockfish.js
   correspondiente al gitHead publicado por el paquete.

No cambies el nombre del archivo WASM: el cargador del motor espera encontrarlo
junto a su JavaScript con su nombre original.

Si los metadatos npm carecen de gitHead, el script se detiene. En ese caso,
verifica el commit exacto del paquete y utiliza:

    python3 tools/prepare.py --stockfish-ref COMMIT_COMPLETO

No inventes ni sustituyas ese commit por una versión diferente.

## 3. Ejecutar localmente

Desde la raíz del proyecto:

    python3 -m http.server 8080

Abre:

    http://localhost:8080/

No abras index.html con file://. Los módulos ES, fetch y Web Workers necesitan
un origen HTTP/HTTPS.

Python no es un backend del juego: solo sirve archivos estáticos en desarrollo.

## 4. Publicar en GitHub Pages

1. Ejecuta tools/prepare.py.
2. Comprueba que vendor/ contiene el JavaScript, WASM, manifiesto y licencias.
3. Añade todos los archivos al repositorio, incluido vendor/.
4. Sube los cambios a GitHub.
5. En Settings → Pages:
   - Source: Deploy from a branch.
   - Branch: main.
   - Folder: / (root).
6. Guarda y espera al despliegue.
7. Abre la URL que muestra GitHub.

La aplicación utiliza rutas relativas y new URL(..., import.meta.url).
No presupone que esté alojada en la raíz del dominio.

Ejemplo compatible:

    https://usuario.github.io/immortal-snail-chess/

.nojekyll evita procesamiento innecesario por Jekyll.

No se necesita ejecutar Python ni Node.js en GitHub Pages.

## 5. Reglas de los caracoles

Configuración central: js/config.js.

Por defecto:

- Blanco: a4.
- Negro: a5.
- Activación cada tres jugadas de su propio color.
- Desempate: primero columna y después fila, ambas ascendentes.

Un turno es una jugada individual, no una pareja de jugadas.

Ejemplo:

- Tras la tercera jugada blanca se activa el caracol blanco.
- Tras la tercera jugada negra se activa el caracol negro.

La única función que actualiza los contadores es countChessMove(), en
js/snails.js.

Los movimientos de caracol no pasan por esa función y no consumen turnos.

### Movimiento

El caracol considera sus ocho vecinos dentro del tablero.

1. Solo considera vecinos que reduzcan su distancia al rey propio.
2. Minimiza la distancia de Chebyshev.
3. Resuelve empates con el orden configurado.

Al estar adyacente, avanza al rey y lo captura.

Si ya comparte casilla con su rey, permanece allí y resuelve la captura.

No hay obstáculos ni búsquedas recursivas que puedan bloquear el avance.

### Ocupación y capturas

El caracol no forma parte del conjunto de piezas de chess.js.

Puede compartir casilla con:

- Una pieza blanca.
- Una pieza negra.
- El otro caracol.

Una pieza puede moverse a una casilla con caracol. Eso no captura el caracol
ni desencadena por sí solo una captura de pieza.

La captura se resuelve al activarse el caracol.

Toda pieza encontrada en su destino se retira, independientemente del color.

Los caracoles no se capturan entre sí.

### Reyes y prioridad

Si un caracol captura a su propio rey, pierde el bando del caracol.

Si captura al rey enemigo, gana el bando del caracol.

Secuencia de una jugada:

1. chess.js valida y ejecuta la jugada convencional.
2. Se actualiza únicamente el contador del jugador que ha movido.
3. Si corresponde, se mueve su caracol.
4. Se resuelve su captura.
5. Si se ha capturado un rey, la partida termina inmediatamente.
6. En otro caso se comprueba la seguridad del rey que acaba de mover.
7. Se adjudican mate, ahogado y tablas.

Por tanto, una captura de rey por caracol tiene prioridad sobre un mate o
unas tablas producidos por la misma jugada convencional.

Una vez terminada la partida no se admiten más jugadas.

### Jaque descubierto sobre el rey que acaba de mover

Una retirada automática podría descubrir un ataque al rey del jugador que
acaba de mover.

Permitir que el rival jugase desde ese estado no sería compatible con las
premisas de legalidad del ajedrez convencional.

Por ello, se añade esta regla de integración:

> Una jugada debe ser legal según chess.js y mantener a salvo al rey del
> jugador que acaba de mover después de la activación de su caracol,
> salvo que la activación ya haya terminado la partida capturando un rey.

La interfaz no ofrece estas jugadas como legales. La IA utiliza exactamente
la misma comprobación.

Si no existen jugadas legales de la variante:

- Con jaque: derrota por mate de variante.
- Sin jaque: tablas por ahogado de variante.

No se permiten capturas convencionales de reyes.

### Enroque

chess.js decide su legalidad, movimientos del rey y la torre.

Los caracoles estacionarios no bloquean el enroque ni atacan casillas a
efectos de su validación convencional.

Después se aplica la activación correspondiente, si la hay.

Una captura de caracol no cambia derechos de enroque ajenos a la pieza
capturada. Si retirase una torre titular, el derecho asociado se elimina:
no se conserva un derecho imposible.

### Captura al paso

chess.js resuelve la captura al paso convencional.

Un avance automático no cambia turno, número de jugada ni un objetivo EP
todavía válido.

Si retira al peón que podía ser capturado al paso, se elimina ese objetivo.
Conservarlo permitiría capturar un peón inexistente.

### Promoción

Se ofrecen dama, torre, alfil y caballo.

La promoción se ejecuta antes del avance automático. El caracol puede
capturar la pieza recién promocionada si llega a su casilla.

### Tablas

Se aplican:

- Ahogado convencional.
- Ahogado de variante.
- Material insuficiente de chess.js.
- Regla de 50 movimientos de chess.js.
- Triple repetición del estado completo.

La captura de una pieza por un caracol reinicia el reloj de 50 movimientos,
porque ha ocurrido una captura, pero no incrementa el número de jugada.

Para la repetición no basta con comparar piezas:

- Posición convencional normalizada por chess.js.
- Casilla de cada caracol.
- Resto del contador de cada color.

Se mantiene un registro propio de estas claves porque una modificación
externa del tablero mediante FEN no conserva el historial interno de
chess.js, y porque dos posiciones con caracoles distintos no son la misma
posición de esta variante.

Las tablas por material insuficiente se conservan expresamente conforme
al motor convencional, aunque los caracoles hagan posible una victoria
que no existiría en ajedrez normal.

Los finales de tablas se adjudican automáticamente; no hay botón de
reclamación ni negociación de tablas.

## 6. Autoridad de reglas y representación

chess.js es la autoridad para:

- Movimientos convencionales.
- Jaque.
- Enroque.
- Captura al paso.
- Promoción.
- Mate y ahogado convencionales.
- Material insuficiente.
- Regla de 50 movimientos.

La aplicación no reimplementa los movimientos de las piezas.

El estado adicional contiene:

- FEN.
- Caracoles.
- Contadores.
- Resultado.
- Última jugada.
- Sucesos de caracol.
- Historial.
- Claves de repetición.

Las retiradas automáticas se realizan mediante una transformación atómica
del FEN. No se usa Chess.remove(), evitando cambios implícitos en campos
que deben preservarse.

Si se captura un rey, el FEN terminal se utiliza solo para dibujar.
No se vuelve a cargar ese FEN sin rey en chess.js o Stockfish.

La notación SAN del historial describe la jugada convencional antes de
la activación. Los sucesos del caracol aparecen por separado. No se
presenta ese historial como un PGN estándar de la variante.

## 7. Inteligencia artificial

Stockfish no conoce Immortal Snail Chess.

La capa de integración:

1. Genera todas las jugadas legales de la variante.
2. Simula cada jugada con la misma función usada por humanos.
3. Aplica el avance automático y las capturas.
4. Escoge una victoria inmediata si existe.
5. Evita una derrota inmediata cuando existe alternativa.
6. Examina todas las respuestas inmediatas del rival.
7. Si hay opciones que no permiten victoria en una respuesta, descarta
   las que sí la permiten.
8. Envía a Stockfish los FEN reales posteriores a la activación.
9. Combina esa evaluación con una heurística de distancia y urgencia
   de los caracoles.

No se envía a Stockfish una posición anterior a una captura automática
como si siguiese siendo el estado real.

La búsqueda de variante se ejecuta en un Worker de módulo.
Stockfish se ejecuta en un Worker clásico hijo.

### Dificultades

Los límites están en js/config.js.

Se utilizan órdenes UCI reales:

    go depth N movetime M

El presupuesto de tiempo se reparte entre las posiciones candidatas.

Valores predeterminados:

| Nivel | Profundidad máxima | Presupuesto aproximado Stockfish |
|---|---:|---:|
| Fácil | 2 | 500 ms |
| Normal | 5 | 1400 ms |
| Difícil | 9 | 3500 ms |
| Experto | 14 | 7000 ms |

El límite de tiempo puede detener una búsqueda antes de alcanzar la
profundidad indicada.

El presupuesto no incluye las simulaciones JavaScript ni el arranque
del motor. Existe un mínimo de 10 ms por candidato.

La diferencia de nivel no depende de una etiqueta visual ni de parámetros
inexistentes. Skill Level se mantiene al máximo; la fuerza se limita
mediante profundidad y tiempo.

### Límites de la IA

La búsqueda exacta específica de caracoles solo cubre:

- Nuestra jugada inmediata.
- La posible victoria en una respuesta del adversario.

Más allá de eso, Stockfish busca ajedrez convencional desde el tablero
resultante y la heurística aproxima el peligro de los caracoles.

No se afirma optimalidad, fuerza Elo concreta ni equivalencia con un
Stockfish modificado que conociese todas las reglas.

La comprobación de respuestas protege frente a derrotas inmediatamente
demostrables, pero no frente a todas las amenazas de varios turnos.

## 8. Reinicios y concurrencia

Cada partida tiene una generación de interfaz.

Cada petición de IA tiene un identificador y el ply esperado.

Al reiniciar:

- Se termina el Worker anterior y sus hijos.
- Se restablecen contadores, historial, caracoles y resultado.
- Se descartan mensajes obsoletos.
- Se crea un estado inicial nuevo.

La promoción también comprueba la generación y el ply antes de confirmar.

Las simulaciones crean estados independientes y no modifican el estado real.

## 9. Pruebas

Con el servidor local activo:

    http://localhost:8080/tests/

La batería automática comprueba:

- Posiciones iniciales.
- Validación de configuración.
- Contadores independientes.
- Frecuencia configurable.
- Movimiento y desempate.
- Capturas propias y rivales.
- Captura de ambos tipos de rey.
- Prioridad sobre mate convencional.
- Inmutabilidad de simulaciones.
- Seguridad del rey tras activación.
- Enroque corto y largo.
- Captura al paso.
- Conservación e invalidación selectiva de EP.
- Las cuatro promociones.
- Mate, ahogado, material insuficiente y 50 movimientos.
- Clave de triple repetición.
- Rechazo de jugadas ilegales.
- Reinicio del estado.
- Capa de IA con ambos colores.
- Resolución de rutas relativas.

El botón adicional prueba el WebAssembly real:

- Inicialización UCI.
- Evaluaciones reales.
- Selección legal con blancas y negras.
- Evitar una derrota inmediata por el caracol propio.

Las pruebas con evaluador controlado verifican la capa de variante; no
sustituyen las pruebas reales del motor.

### Comprobaciones manuales antes de publicar

1. Ejecutar la batería y el botón de Stockfish real.
2. Jugar con ambos colores contra la máquina.
3. Reiniciar mientras piensa.
4. Abrir nueva partida mientras piensa.
5. Promocionar y cancelar una promoción.
6. Probar ratón y pantalla táctil.
7. Repetir las pruebas desde la URL final de GitHub Pages.
8. Comprobar que JS y WASM no devuelven 404.
9. Comprobar la consola del navegador.
10. Verificar que un resultado terminal bloquea el tablero.

El proyecto entregado incluye estas pruebas, pero no debe considerarse
verificado en un navegador concreto hasta ejecutarlas.

## 10. Licencias y redistribución de Stockfish

El código propio del proyecto se publica bajo MIT.

chess.js conserva su licencia BSD-2-Clause.

Stockfish y su compilación JavaScript/WebAssembly están sujetos a GPL-3.0.

Al redistribuir el motor:

- Conserva sus avisos y licencia.
- Distribuye o proporciona acceso conforme a GPL al código fuente
  correspondiente de la versión exacta.
- Incluye las modificaciones si cambias el motor.
- Incluye los scripts e instrucciones necesarios para reconstruir esa
  versión y las dependencias o recursos requeridos por su compilación.
- No sustituyas la fuente correspondiente por una rama "latest".
- No presentes el binario Stockfish como software MIT propio.

tools/prepare.py incluye la licencia y el archivo del repositorio fuente
asociado al gitHead del paquete, junto con sus referencias de integridad.

Antes de redistribuir una compilación modificada, verifica en particular
que el conjunto publicado incluya su configuración de compilación,
envoltorio JavaScript y los recursos NNUE que requiera. El script de este
proyecto descarga binarios upstream sin modificarlos; no reconstruye ni
audita por sí mismo toda la cadena de compilación upstream.

Los usuarios pueden acceder a los avisos y las fuentes desde:

    vendor/licenses/SOURCES.txt
    vendor/licenses/stockfish-COPYING
    vendor/licenses/stockfish-source.tar.gz

No elimines estos archivos para reducir el tamaño de la publicación.

## 11. Limitaciones conocidas

- No hay persistencia tras recargar la página.
- No hay multijugador por Internet.
- No hay deshacer ni exportación PGN de la variante.
- La IA no realiza una búsqueda completa de las reglas del caracol.
- Experto usa Stockfish lite y un hilo, no la compilación más grande
  y multihilo del motor.
- Las piezas se dibujan con Unicode; su aspecto depende de las fuentes
  del sistema.
- Se utiliza selección por pulsaciones, no arrastre.
- Se requieren navegadores modernos con módulos ES, dialog,
  WebAssembly y Workers anidados.
- La primera carga del motor puede tardar, especialmente en móviles.
- Las etiquetas Fácil/Normal/Difícil/Experto no representan ratings Elo.
- La regla posterior de seguridad del rey y el ahogado de variante son
  definiciones explícitas necesarias para evitar posiciones incoherentes.
- No se ha añadido Service Worker ni funcionamiento offline garantizado.