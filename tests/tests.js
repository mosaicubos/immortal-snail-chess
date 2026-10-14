import { CONFIG } from "../js/config.js";
import {
  Chess,
  START_FEN,
  createGame,
  makeState,
  play,
  successors,
  adjudicate,
  boardFromFen,
  encodeBoard,
  positionKey,
  turnOf,
} from "../js/game.js";
import {
  nextSnailSquare,
  countChessMove,
  chebyshev,
} from "../js/snails.js";
import { chooseMove } from "../js/ai.js";
import { StockfishEngine } from "../js/engine.js";

const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const engineButton = document.querySelector("#run-engine");

let passed = 0;
let failed = 0;

function assert(condition, message = "Aserción fallida") {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}\nEsperado: ${JSON.stringify(expected)}\n` +
      `Recibido: ${JSON.stringify(actual)}`
    );
  }
}

function throws(fn) {
  let thrown = false;
  try { fn(); } catch { thrown = true; }
  assert(thrown, "Se esperaba una excepción.");
}

async function test(name, fn) {
  const li = document.createElement("li");

  try {
    await fn();
    passed += 1;
    li.className = "pass";
    li.textContent = `✓ ${name}`;
  } catch (error) {
    failed += 1;
    li.className = "fail";
    li.textContent = `✗ ${name}`;

    const pre = document.createElement("pre");
    pre.textContent = error.stack || error.message;
    li.append(pre);
  }

  results.append(li);
  summary.textContent = `${passed} correctas · ${failed} fallidas`;
}

function fixture(
  pieces,
  {
    turn = "w",
    rights = "-",
    ep = "-",
    halfmove = 0,
    fullmove = 1,
    snails = { w: "a4", b: "a5" },
    ticks = { w: 0, b: 0 },
  } = {}
) {
  const board = {};

  for (const [square, symbol] of Object.entries(pieces)) {
    board[square] = {
      type: symbol.toLowerCase(),
      color: symbol === symbol.toUpperCase() ? "w" : "b",
    };
  }

  const fen = [
    encodeBoard(board),
    turn,
    rights,
    ep,
    halfmove,
    fullmove,
  ].join(" ");

  return makeState(fen, snails, ticks);
}

function move(state, from, to, promotion) {
  return play(state, {
    from,
    to,
    ...(promotion ? { promotion } : {}),
  });
}

function aiDangerPosition(color) {
  if (color === "w") {
    return fixture(
      { e1: "K", h1: "R", a2: "P", h8: "k", a8: "r" },
      {
        snails: { w: "d2", b: "a5" },
        ticks: { w: 2, b: 0 },
      }
    );
  }

  return fixture(
    { h1: "K", a1: "R", e8: "k", h8: "r", a7: "p" },
    {
      turn: "b",
      snails: { w: "a4", b: "d7" },
      ticks: { w: 0, b: 2 },
    }
  );
}

await test("Posiciones iniciales y FEN inicial", () => {
  const state = createGame();
  equal(state.snails, { w: "a4", b: "a5" });
  equal(state.ticks, { w: 0, b: 0 });
  equal(state.fen, START_FEN);
});

await test("Configuración inicial inválida rechazada", () => {
  throws(() => createGame({
    ...CONFIG.rules,
    starts: { w: "e1", b: "a5" },
  }));

  throws(() => createGame({
    ...CONFIG.rules,
    starts: { w: "a9", b: "a5" },
  }));

  throws(() => createGame({
    ...CONFIG.rules,
    frequency: 0,
  }));
});

await test("Contadores independientes: tercera blanca y tercera negra", () => {
  let state = createGame();

  state = move(state, "g1", "f3");
  state = move(state, "g8", "f6");
  state = move(state, "f3", "g1");
  state = move(state, "f6", "g8");

  equal(state.snails, { w: "a4", b: "a5" });
  equal(state.ticks, { w: 2, b: 2 });

  state = move(state, "g1", "f3");
  equal(state.snails, { w: "b3", b: "a5" });
  equal(state.ticks, { w: 0, b: 2 });

  state = move(state, "g8", "f6");
  equal(state.snails, { w: "b3", b: "b5" });
  equal(state.ticks, { w: 0, b: 0 });
  equal(state.ply, 6);
});

await test("Frecuencia configurable y contador sin mutaciones", () => {
  const rules = { ...CONFIG.rules, frequency: 2 };
  const ticks = { w: 1, b: 0 };
  const result = countChessMove(ticks, "w", rules);

  equal(result, { ticks: { w: 0, b: 0 }, due: true });
  equal(ticks, { w: 1, b: 0 });
});

await test("Movimiento determinista, bordes y adyacencia", () => {
  equal(nextSnailSquare("a4", "e1", CONFIG.rules), "b3");
  equal(nextSnailSquare("d2", "e1", CONFIG.rules), "e1");
  equal(nextSnailSquare("e1", "e1", CONFIG.rules), "e1");

  for (const from of ["a1", "a8", "h1", "h8"]) {
    for (const target of ["a1", "d4", "h8"]) {
      const next = nextSnailSquare(from, target, CONFIG.rules);
      assert(/^[a-h][1-8]$/.test(next));
      assert(chebyshev(from, next) <= 1);
      assert(
        next === target ||
        chebyshev(next, target) < chebyshev(from, target) ||
        from === target
      );
    }
  }
});

for (const victim of ["R", "r"]) {
  await test(`El caracol captura torre ${victim === "R" ? "propia" : "rival"}`, () => {
    const initial = fixture(
      { e1: "K", h8: "k", g1: "N", b3: victim, h6: "r" },
      { ticks: { w: 2, b: 0 } }
    );

    const next = move(initial, "g1", "f3");

    assert(!boardFromFen(next.fen).b3);
    equal(next.snails.w, "b3");
    equal(next.event.captured.color, victim === "R" ? "w" : "b");
    equal(turnOf(next), "b");
    equal(next.fen.split(" ")[4], "0");

    // La retirada no ha corrompido la posición.
    const chess = new Chess(next.fen);
    assert(chess.moves().length > 0);

    // La simulación no modifica el estado de origen.
    assert(boardFromFen(initial.fen).b3);
  });
}

await test("Alcanzar al propio rey provoca derrota y detiene la partida", () => {
  const initial = fixture(
    { e1: "K", h8: "k", a8: "r", a2: "P" },
    {
      snails: { w: "d2", b: "a5" },
      ticks: { w: 2, b: 0 },
    }
  );

  const next = move(initial, "a2", "a3");

  equal(next.result, { winner: "b", reason: "snail-own-king" });
  assert(!boardFromFen(next.fen).e1);
  equal(successors(next), []);
  throws(() => move(next, "h8", "g8"));
});

await test("Capturar al rey contrario provoca victoria del caracol", () => {
  const initial = fixture(
    { e1: "K", b3: "k", h8: "r", a2: "P" },
    { ticks: { w: 2, b: 0 } }
  );

  const next = move(initial, "a2", "a3");

  equal(next.result, { winner: "w", reason: "snail-enemy-king" });
  assert(!boardFromFen(next.fen).b3);
});

await test("Victoria de caracol prevalece sobre un mate convencional", () => {
  const initial = fixture(
    { e1: "K", g6: "Q", c4: "B", h8: "k" },
    {
      snails: { w: "d2", b: "a5" },
      ticks: { w: 2, b: 0 },
    }
  );

  const chess = new Chess(initial.fen);
  chess.move({ from: "g6", to: "g8" });
  assert(chess.isCheckmate(), "La jugada convencional debe ser mate.");

  const next = move(initial, "g6", "g8");
  equal(next.result, { winner: "b", reason: "snail-own-king" });
});

await test("Se rechaza el jaque al propio rey descubierto por el caracol", () => {
  const initial = fixture(
    { e1: "K", e2: "B", b1: "N", e8: "r", h8: "k" },
    {
      snails: { w: "f3", b: "a5" },
      ticks: { w: 2, b: 0 },
    }
  );

  // f3 -> e2 retiraría el alfil que protege al rey de la torre e8.
  throws(() => move(initial, "b1", "c3"));

  assert(!successors(initial).some(
    item => item.move.from === "b1" && item.move.to === "c3"
  ));
});

await test("Enroque corto", () => {
  const initial = fixture(
    { e1: "K", a1: "R", h1: "R", e8: "k", a8: "r", h8: "r" },
    { rights: "KQkq" }
  );

  const next = move(initial, "e1", "g1");
  const board = boardFromFen(next.fen);

  equal(board.g1, { type: "k", color: "w" });
  equal(board.f1, { type: "r", color: "w" });
  assert(!board.h1);
});

await test("Enroque largo", () => {
  const initial = fixture(
    { e1: "K", a1: "R", h1: "R", e8: "k", a8: "r", h8: "r" },
    { rights: "KQkq" }
  );

  const next = move(initial, "e1", "c1");
  const board = boardFromFen(next.fen);

  equal(board.c1, { type: "k", color: "w" });
  equal(board.d1, { type: "r", color: "w" });
  assert(!board.a1);
});

await test("Captura al paso convencional con activación posterior", () => {
  let state = createGame();

  state = move(state, "e2", "e4");
  state = move(state, "a7", "a6");
  state = move(state, "e4", "e5");
  state = move(state, "d7", "d5");
  state = move(state, "e5", "d6");

  const board = boardFromFen(state.fen);
  equal(board.d6, { type: "p", color: "w" });
  assert(!board.d5);
  equal(state.snails.w, "b3");
});

await test("Una captura de caracol conserva un EP ajeno válido", () => {
  const initial = fixture(
    { e1: "K", h8: "k", a8: "r", b3: "R", h2: "P", g4: "p" },
    { ticks: { w: 2, b: 0 } }
  );

  const next = move(initial, "h2", "h4");

  equal(next.fen.split(" ")[3], "h3");
  equal(next.fen.split(" ")[1], "b");
  equal(next.fen.split(" ")[5], "1");

  const afterEP = move(next, "g4", "h3");
  assert(!boardFromFen(afterEP.fen).h4);
  equal(boardFromFen(afterEP.fen).h3, { type: "p", color: "b" });
});

await test("Se invalida EP si el caracol retira el peón vulnerable", () => {
  const initial = fixture(
    { e1: "K", h8: "k", h6: "r", b2: "P", a4: "p" },
    {
      snails: { w: "a5", b: "a6" },
      ticks: { w: 2, b: 0 },
    }
  );

  const next = move(initial, "b2", "b4");

  equal(next.snails.w, "b4");
  assert(!boardFromFen(next.fen).b4);
  equal(next.fen.split(" ")[3], "-");
});

await test("Promoción: dama, torre, alfil y caballo", () => {
  for (const promotion of ["q", "r", "b", "n"]) {
    const initial = fixture(
      { e1: "K", h8: "k", a7: "P", h6: "r" }
    );

    const next = move(initial, "a7", "a8", promotion);
    equal(boardFromFen(next.fen).a8, {
      type: promotion,
      color: "w",
    });
  }
});

await test("Detección convencional de jaque mate y ahogado", () => {
  const mate = fixture(
    { f7: "K", g7: "Q", h8: "k" },
    { turn: "b" }
  );

  equal(adjudicate(mate).result.reason, "checkmate");

  const stale = fixture(
    { f7: "K", g6: "Q", h8: "k" },
    { turn: "b" }
  );

  equal(adjudicate(stale).result.reason, "stalemate");
});

await test("Material insuficiente y regla de 50 movimientos", () => {
  const insufficient = fixture({ e1: "K", e8: "k" });
  equal(adjudicate(insufficient).result.reason, "insufficient-material");

  const fifty = fixture(
    { e1: "K", b1: "N", h1: "R", h8: "k", a8: "r" },
    { halfmove: 99 }
  );

  const next = move(fifty, "b1", "c3");
  equal(next.result.reason, "fifty-moves");
});

await test("La repetición incluye caracoles y contadores", () => {
  const state = createGame();
  const key = positionKey(state);

  const repeated = {
    ...state,
    keys: [key, key, key],
  };

  equal(adjudicate(repeated).result.reason, "repetition");

  const different = {
    ...state,
    ticks: { w: 1, b: 0 },
    keys: [key, key, key],
  };

  assert(positionKey(different) !== key);
  assert(!adjudicate(different).result);
});

await test("Jugada ilegal rechazada sin modificar el estado", () => {
  const initial = createGame();
  const before = JSON.stringify(initial);

  throws(() => move(initial, "e2", "e5"));
  equal(JSON.stringify(initial), before);
});

await test("Reiniciar restablece todo el estado", () => {
  let state = createGame();
  state = move(state, "g1", "f3");
  assert(state.ply === 1);

  const restarted = createGame();

  equal(restarted, createGame());
  equal(restarted.history, []);
  equal(restarted.ticks, { w: 0, b: 0 });
  equal(restarted.last, null);
  equal(restarted.event, null);
  equal(restarted.result, null);
});

await test("Las simulaciones no ejecutan activaciones sobre el estado real", () => {
  let state = createGame();
  state = move(state, "g1", "f3");
  state = move(state, "g8", "f6");
  state = move(state, "f3", "g1");
  state = move(state, "f6", "g8");

  const before = JSON.stringify(state);
  successors(state);
  successors(state);

  equal(JSON.stringify(state), before);
});

const fakeEngine = {
  async evaluate() { return 0; },
};

for (const color of ["w", "b"]) {
  await test(`Capa de IA: juega legal con ${color} y evita su caracol`, async () => {
    const initial = aiDangerPosition(color);
    const action = await chooseMove(initial, "easy", fakeEngine);
    const next = play(initial, action);

    assert(next.result?.winner !== (color === "w" ? "b" : "w"));
    assert(action.from === (color === "w" ? "e1" : "e8"));
    equal(next.ply, initial.ply + 1);
    equal(next.ticks[color], 0);
  });
}

await test("Recursos locales accesibles mediante rutas relativas", async () => {
  const manifestURL = new URL("../vendor/engine.json", import.meta.url);
  const response = await fetch(manifestURL);
  assert(response.ok, "No se pudo cargar engine.json.");

  const manifest = await response.json();

  for (const path of [manifest.worker, manifest.wasm]) {
    const url = new URL(path, manifestURL);
    assert(url.origin === location.origin);

    const asset = await fetch(url, { method: "HEAD" });
    assert(asset.ok, `No se pudo cargar ${url.pathname}`);
  }

  const chess = await fetch(new URL("../vendor/chess.js", import.meta.url), {
    method: "HEAD",
  });
  assert(chess.ok);
});

engineButton.disabled = false;

engineButton.addEventListener("click", async () => {
  engineButton.disabled = true;
  const engine = new StockfishEngine();
  let initialized = false;

  await test("Stockfish real: inicialización UCI y WASM", async () => {
    await engine.init();
    initialized = true;
    assert(engine.options.size > 0);
  });

  if (initialized) {
    for (const color of ["w", "b"]) {
      await test(`Stockfish real + variante con ${color}`, async () => {
        const initial = aiDangerPosition(color);
        const action = await chooseMove(initial, "easy", engine);
        const next = play(initial, action);

        assert(action.from === (color === "w" ? "e1" : "e8"));
        assert(next.result?.winner !== (color === "w" ? "b" : "w"));
        equal(next.ticks[color], 0);
      });
    }
  }

  engine.dispose();
  engineButton.disabled = false;
});