import { StockfishEngine } from "./engine.js";
import { chooseMove } from "./ai.js";

let engine = null;
let ready = false;
let busy = false;

self.onmessage = async event => {
  const message = event.data;

  if (message.type === "dispose") {
    engine?.dispose();
    self.close();
    return;
  }

  if (message.type === "init") {
    if (engine) return;

    try {
      engine = new StockfishEngine();
      await engine.init();
      ready = true;
      self.postMessage({ type: "ready" });
    } catch (error) {
      engine?.dispose();
      self.postMessage({ type: "error", message: error.message });
    }

    return;
  }

  if (message.type !== "think") return;

  if (!ready || busy) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: "El motor no está disponible para esta búsqueda.",
    });
    return;
  }

  busy = true;

  try {
    const move = await chooseMove(
      message.state,
      message.difficulty,
      engine,
      progress => self.postMessage({
        type: "progress",
        id: message.id,
        ...progress,
      })
    );

    self.postMessage({ type: "move", id: message.id, move });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: error.message,
    });
  } finally {
    busy = false;
  }
};