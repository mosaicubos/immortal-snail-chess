import { CONFIG } from "./config.js";

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.listeners = new Set();
    this.failureListeners = new Set();
    this.options = new Set();
    this.pendingFailure = null;
    this.busy = false;
  }

  emitFailure(error) {
    this.pendingFailure = error;
    for (const listener of [...this.failureListeners]) listener(error);
  }

  waitFor(predicate, timeoutMs, start) {
    return new Promise((resolve, reject) => {
      if (this.pendingFailure) {
        reject(this.pendingFailure);
        return;
      }

      let timer;

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(onLine);
        this.failureListeners.delete(onFailure);
      };

      const onFailure = error => {
        cleanup();
        reject(error);
      };

      const onLine = line => {
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };

      this.listeners.add(onLine);
      this.failureListeners.add(onFailure);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Stockfish no respondió dentro del tiempo esperado."));
      }, timeoutMs);

      try {
        start();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  send(command) {
    if (!this.worker) throw new Error("Stockfish no está iniciado.");
    this.worker.postMessage(command);
  }

  async init() {
    if (typeof WebAssembly === "undefined") {
      throw new Error("Este navegador no admite WebAssembly.");
    }

    const manifestURL = new URL("../vendor/engine.json", import.meta.url);
    const response = await fetch(manifestURL);

    if (!response.ok) {
      throw new Error(
        "Falta vendor/engine.json. Ejecuta tools/prepare.py antes de publicar."
      );
    }

    const manifest = await response.json();
    const workerURL = new URL(manifest.worker, manifestURL);

    if (workerURL.origin !== manifestURL.origin) {
      throw new Error("El motor debe estar alojado en el mismo origen.");
    }

    // Worker clásico: el fichero distribuido por Stockfish contiene
    // su propia inicialización Emscripten.
    this.worker = new Worker(workerURL);

    this.worker.onerror = event => {
      this.emitFailure(new Error(
        `No se pudo cargar Stockfish/WASM: ${event.message || "error de Worker"}`
      ));
    };

    this.worker.onmessageerror = () => {
      this.emitFailure(new Error("Mensaje inválido recibido de Stockfish."));
    };

    this.worker.onmessage = event => {
      const text = typeof event.data === "string" ? event.data : "";
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        const option = line.match(/^option name (.+?) type /);
        if (option) this.options.add(option[1]);

        for (const listener of [...this.listeners]) listener(line);
      }
    };

    await this.waitFor(
      line => line === "uciok",
      60000,
      () => this.send("uci")
    );

    if (this.options.has("Threads")) {
      this.send("setoption name Threads value 1");
    }

    if (this.options.has("Hash")) {
      this.send(`setoption name Hash value ${CONFIG.ai.hashMB}`);
    }

    if (this.options.has("MultiPV")) {
      this.send("setoption name MultiPV value 1");
    }

    if (this.options.has("Ponder")) {
      this.send("setoption name Ponder value false");
    }

    if (this.options.has("Skill Level")) {
      // No se usa para fingir niveles: la diferencia de dificultad
      // se aplica a depth/movetime al evaluar cada posición.
      this.send("setoption name Skill Level value 20");
    }

    this.send("ucinewgame");

    await this.waitFor(
      line => line === "readyok",
      30000,
      () => this.send("isready")
    );
  }

  /**
   * Devuelve evaluación desde el punto de vista del jugador al turno
   * en el FEN enviado. Nunca se envían posiciones terminales sin rey.
   */
  async evaluate(fen, { depth, movetime }) {
    if (this.busy) throw new Error("Búsqueda UCI concurrente no permitida.");
    this.busy = true;

    let score = null;

    const captureScore = line => {
      if (!line.startsWith("info ")) return;
      if (/\b(upperbound|lowerbound)\b/.test(line)) return;

      const match = line.match(/\bscore (cp|mate) (-?\d+)/);
      if (!match) return;

      const value = Number(match[2]);

      if (match[1] === "cp") {
        score = value;
      } else {
        score = value > 0
          ? 90000 - Math.min(value, 1000)
          : -90000 + Math.min(Math.abs(value), 1000);
      }
    };

    this.listeners.add(captureScore);

    try {
      this.send(`position fen ${fen}`);

      await this.waitFor(
        line => line.startsWith("bestmove "),
        Math.max(15000, movetime + 10000),
        () => this.send(
          `go depth ${Math.max(1, Math.floor(depth))} ` +
          `movetime ${Math.max(10, Math.floor(movetime))}`
        )
      );

      if (score === null) {
        throw new Error("Stockfish terminó sin proporcionar una evaluación.");
      }

      return score;
    } catch (error) {
      this.send("stop");
      throw error;
    } finally {
      this.listeners.delete(captureScore);
      this.busy = false;
    }
  }

  dispose() {
    const worker = this.worker;
    this.worker = null;
    this.emitFailure(new Error("Motor cerrado."));
    worker?.terminate();
    this.listeners.clear();
    this.failureListeners.clear();
  }
}