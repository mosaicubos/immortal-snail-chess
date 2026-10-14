import { CONFIG } from "./config.js";
import {
  Chess,
  createGame,
  successors,
  play,
  turnOf,
  boardFromFen,
  kingSquare,
  colorName,
  eventText,
  resultText,
} from "./game.js";

const $ = selector => document.querySelector(selector);

const SNAIL_IMAGES = Object.freeze({
  w: new URL("../assets/Pieces/snail-white.svg", import.meta.url).href,
  b: new URL("../assets/Pieces/snail-black.svg", import.meta.url).href,
});

const elements = {
  board: $("#board"),
  status: $("#status"),
  modeLabel: $("#mode-label"),
  engineStatus: $("#engine-status"),
  retryAI: $("#retry-ai"),
  notice: $("#notice"),
  history: $("#history"),
  whiteCounter: $("#white-counter"),
  blackCounter: $("#black-counter"),
  menu: $("#menu"),
  form: $("#settings-form"),
  mode: $("#mode"),
  color: $("#color"),
  difficulty: $("#difficulty"),
  aiSettings: $("#ai-settings"),
  cancelMenu: $("#cancel-menu"),
  promotion: $("#promotion"),
  promotionOptions: $("#promotion-options"),
};

const SYMBOLS = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const PIECE_NAMES = {
  k: "rey", q: "dama", r: "torre", b: "alfil", n: "caballo", p: "peón",
};

let state = createGame();
let options = { mode: "local", color: "w", difficulty: "normal" };
let started = false;
let flipped = false;
let selected = null;
let selectedMoves = [];

let aiWorker = null;
let aiReady = false;
let thinking = false;
let aiFailed = false;
let aiMessage = "";
let generation = 0;
let requestSequence = 0;
let pendingRequest = null;

for (const [value, level] of Object.entries(CONFIG.ai.difficulties)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = level.label;
  elements.difficulty.append(option);
}

elements.difficulty.value = "normal";

function clearSelection() {
  selected = null;
  selectedMoves = [];
}

function canHumanMove() {
  return started &&
    !state.result &&
    !elements.menu.open &&
    !elements.promotion.open &&
    (
      options.mode === "local" ||
      turnOf(state) === options.color
    );
}

function appendTextSpan(parent, className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  parent.append(span);
  return span;
}

function renderBoard() {
  const board = boardFromFen(state.fen);
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const destinations = new Set(selectedMoves.map(move => move.to));

  let checkedKing = null;

  if (!state.result) {
    const chess = new Chess(state.fen);
    if (chess.inCheck()) checkedKing = kingSquare(board, chess.turn());
  }

  const fragment = document.createDocumentFragment();

  ranks.forEach((rank, rowIndex) => {
    [...files].forEach((file, columnIndex) => {
      const square = file + rank;
      const piece = board[square];
      const button = document.createElement("button");
      const fileIndex = file.charCodeAt(0) - 97;

      button.type = "button";
      button.className = "square " +
        ((fileIndex + rank) % 2 === 0 ? "light" : "dark");
      button.dataset.square = square;

      if (piece) button.classList.add("has-piece");
      if (selected === square) button.classList.add("selected");
      if (destinations.has(square)) button.classList.add("legal");
      if (checkedKing === square) button.classList.add("in-check");

      if (state.last &&
          (state.last.from === square || state.last.to === square)) {
        button.classList.add("last");
      }

      const labels = [square.toUpperCase()];

      if (piece) {
        appendTextSpan(
          button,
          `piece ${piece.color}`,
          SYMBOLS[piece.color][piece.type]
        ).setAttribute("aria-hidden", "true");

        labels.push(
          `${PIECE_NAMES[piece.type]} de ${colorName(piece.color)}`
        );
      } else {
        labels.push("vacía");
      }

      const both =
        state.snails.w === square &&
        state.snails.b === square;

      const hasSnail =
        state.snails.w === square ||
        state.snails.b === square;

      button.classList.toggle("has-snail", hasSnail);

      for (const color of ["w", "b"]) {
        if (state.snails[color] !== square) continue;

        const image = document.createElement("img");

        image.src = SNAIL_IMAGES[color];
        image.className =
          `snail-piece ${color}${both ? " both" : ""}`;

        // La descripción accesible está en el botón de la casilla.
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.draggable = false;
        image.width = 128;
        image.height = 128;

        button.append(image);

        labels.push(
          `caracol ${color === "w" ? "blanco" : "negro"}`
        );
      }

      if (columnIndex === 0) {
        appendTextSpan(button, "coordinate rank", String(rank));
      }

      if (rowIndex === 7) {
        appendTextSpan(button, "coordinate file", file);
      }

      if (destinations.has(square)) labels.push("destino legal");
      if (checkedKing === square) labels.push("jaque");

      button.setAttribute("aria-label", labels.join(", "));
      button.setAttribute("aria-pressed", String(selected === square));
      fragment.append(button);
    });
  });

  elements.board.replaceChildren(fragment);
}

function renderHistory() {
  const fragment = document.createDocumentFragment();

  for (const record of state.history) {
    const li = document.createElement("li");
    const moveNumber = Math.ceil(record.ply / 2);

    li.textContent = `${moveNumber}${record.color === "w" ? "." : "..."} ` +
      `${record.san} · ${colorName(record.color)}`;

    if (record.event) {
      const small = document.createElement("small");
      small.textContent = eventText(record.event);
      li.append(small);
    }

    fragment.append(li);
  }

  elements.history.replaceChildren(fragment);
  elements.history.scrollTop = elements.history.scrollHeight;
}

function render() {
  renderBoard();
  renderHistory();

  const level = CONFIG.ai.difficulties[options.difficulty].label;

  elements.modeLabel.textContent = options.mode === "local"
    ? "Two players"
    : `Against the bot · ${level} · You play with ${colorName(options.color)}`;

  if (state.result) {
    let text = resultText(state.result);

    if (options.mode === "ai" && state.result.winner) {
      text = (state.result.winner === options.color
        ? "Victory. "
        : "Defeat. ") + text;
    }

    elements.status.textContent = text;
  } else {
    const chess = new Chess(state.fen);
    elements.status.textContent =
      `${colorName(turnOf(state))} turn` +
      (chess.inCheck() ? " · ¡CHeck!" : "");
  }

  for (const color of ["w", "b"]) {
    const remaining = CONFIG.rules.frequency - state.ticks[color];
    const target = color === "w"
      ? elements.whiteCounter
      : elements.blackCounter;

    target.textContent =
      `${state.snails[color].toUpperCase()} · ` +
      `${remaining} play${remaining === 1 ? "" : "s"} of that color ` +
      "till activation";
  }

  elements.engineStatus.textContent = options.mode === "ai" ? aiMessage : "";
  elements.retryAI.hidden = !aiFailed || options.mode !== "ai" || !!state.result;
}

function disposeAI() {
  if (aiWorker) {
    aiWorker.postMessage({ type: "dispose" });
    aiWorker.terminate();
  }

  // Al terminar el Worker padre se terminan también sus Workers hijos.
  aiWorker = null;
  aiReady = false;
  thinking = false;
  pendingRequest = null;
}

function failAI(message) {
  disposeAI();
  aiFailed = true;
  aiMessage = `AI stopped: ${message}`;
  render();
}

function startAI() {
  disposeAI();
  aiFailed = false;
  aiMessage = "Loading Stockfish WebAssembly…";

  const thisGeneration = generation;
  const worker = new Worker(new URL("./ai-worker.js", import.meta.url), {
    type: "module",
  });

  aiWorker = worker;

  worker.onerror = event => {
    if (aiWorker !== worker || generation !== thisGeneration) return;
    failAI(event.message || "IA worker couldt be loaded");
  };

  worker.onmessage = event => {
    if (aiWorker !== worker || generation !== thisGeneration) return;
    const message = event.data;

    if (message.type === "ready") {
      aiReady = true;
      aiMessage = "Stockfish ready.";
      render();
      requestAI();
      return;
    }

    if (message.type === "error") {
      failAI(message.message);
      return;
    }

    if (!pendingRequest || message.id !== pendingRequest.id) return;

    if (message.type === "progress") {
      aiMessage = message.phase === "tactics"
        ? `AI: checking snails and answers ` +
          `${message.current}/${message.total}…`
        : `Stockfish: evaluating ${message.current}/${message.total}…`;

      // No reconstruir el tablero para mensajes de progreso.
      elements.engineStatus.textContent = aiMessage;
      return;
    }

    if (message.type === "move") {
      const expectedPly = pendingRequest.ply;
      pendingRequest = null;
      thinking = false;
      aiMessage = "Stockfish ready.";

      try {
        commitMove(message.move, expectedPly, true);
      } catch (error) {
        failAI(error.message);
      }
    }
  };

  worker.postMessage({ type: "init" });
  render();
}

function requestAI() {
  if (!started ||
      options.mode !== "ai" ||
      state.result ||
      turnOf(state) === options.color ||
      !aiReady ||
      thinking ||
      aiFailed) {
    return;
  }

  thinking = true;
  const id = ++requestSequence;
  pendingRequest = { id, ply: state.ply };
  aiMessage = "AI: examining the consequences of the snails…";

  render();

  aiWorker.postMessage({
    type: "think",
    id,
    state,
    difficulty: options.difficulty,
  });
}

function commitMove(move, expectedPly, fromAI = false) {
  if (state.ply !== expectedPly || state.result) {
    throw new Error("An obsolete move was discarded.");
  }

  if (fromAI &&
      (options.mode !== "ai" || turnOf(state) === options.color)) {
    throw new Error("The AI attempted to move out of turn.");
  }

  state = play(state, move);
  clearSelection();

  elements.notice.textContent = state.event
    ? eventText(state.event)
    : `Jugada: ${state.last.san}.`;

  if (state.result) {
    elements.notice.textContent += ` ${resultText(state.result)}`;
    aiMessage = "";
  }

  render();
  requestAI();
}

function askPromotion(moves) {
  const currentGeneration = generation;
  const expectedPly = state.ply;
  const actor = turnOf(state);

  elements.promotionOptions.replaceChildren();

  for (const move of moves) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = SYMBOLS[actor][move.promotion];
    button.setAttribute("aria-label", PIECE_NAMES[move.promotion]);

    button.onclick = () => {
      elements.promotion.close();

      if (generation !== currentGeneration ||
          state.ply !== expectedPly ||
          state.result) {
        return;
      }

      try {
        commitMove(move, expectedPly);
      } catch (error) {
        elements.notice.textContent = error.message;
        clearSelection();
        render();
      }
    };

    elements.promotionOptions.append(button);
  }

  elements.promotion.showModal();
}

elements.board.addEventListener("click", event => {
  const square = event.target.closest("button[data-square]")?.dataset.square;
  if (!square || !canHumanMove()) return;

  const destinations = selectedMoves.filter(move => move.to === square);

  if (destinations.length) {
    if (destinations.some(move => move.promotion)) {
      askPromotion(destinations);
    } else {
      try {
        commitMove(destinations[0], state.ply);
      } catch (error) {
        elements.notice.textContent = error.message;
        clearSelection();
        render();
      }
    }
    return;
  }

  const piece = boardFromFen(state.fen)[square];

  if (piece?.color === turnOf(state) && selected !== square) {
    selected = square;
    selectedMoves = successors(state)
      .map(item => item.move)
      .filter(move => move.from === square);

    elements.notice.textContent = selectedMoves.length
      ? "Choose a highlighted square."
      : "This piece has no legal moves in the variant.";
  } else {
    clearSelection();
  }

  renderBoard();
});

function beginGame(nextOptions) {
  generation += 1;
  disposeAI();

  options = { ...nextOptions };
  state = createGame();
  started = true;
  flipped = options.mode === "ai" && options.color === "b";
  aiFailed = false;
  aiMessage = "";
  clearSelection();

  if (elements.promotion.open) elements.promotion.close();
  if (elements.menu.open) elements.menu.close();

  elements.notice.textContent =
    "New game. Select a piece to see its legal moves.";

  render();

  if (options.mode === "ai") startAI();
}

elements.mode.addEventListener("change", () => {
  elements.aiSettings.disabled = elements.mode.value !== "ai";
});

elements.form.addEventListener("submit", event => {
  event.preventDefault();

  beginGame({
    mode: elements.mode.value,
    color: elements.color.value,
    difficulty: elements.difficulty.value,
  });
});

$("#new-game").addEventListener("click", () => {
  elements.mode.value = options.mode;
  elements.color.value = options.color;
  elements.difficulty.value = options.difficulty;
  elements.aiSettings.disabled = options.mode !== "ai";
  elements.cancelMenu.hidden = !started;
  elements.menu.showModal();
});

$("#restart").addEventListener("click", () => {
  beginGame(options);
});

$("#flip").addEventListener("click", () => {
  flipped = !flipped;
  renderBoard();
});

elements.cancelMenu.addEventListener("click", () => {
  if (started) elements.menu.close();
});

elements.menu.addEventListener("cancel", event => {
  if (!started) event.preventDefault();
});

$("#cancel-promotion").addEventListener("click", () => {
  elements.promotion.close();
  clearSelection();
  renderBoard();
});

elements.promotion.addEventListener("cancel", () => {
  clearSelection();
  renderBoard();
});

elements.retryAI.addEventListener("click", () => {
  if (options.mode === "ai" && !state.result) startAI();
});

window.addEventListener("beforeunload", disposeAI);

render();
elements.cancelMenu.hidden = true;
elements.menu.showModal();