import { CONFIG } from "./config.js";
import {
  successors,
  adjudicate,
  turnOf,
  boardFromFen,
  kingSquare,
  uciOf,
} from "./game.js";
import { opposite, chebyshev } from "./snails.js";

function snailRisk(state, color, rules) {
  const board = boardFromFen(state.fen);
  const king = kingSquare(board, color);
  if (!king) return 1000000;

  const distance = chebyshev(state.snails[color], king);
  const remaining = rules.frequency - state.ticks[color];

  return Math.max(0, 4 - distance) *
    CONFIG.ai.snailRiskWeight / remaining;
}

function terminalScore(result, actor) {
  if (!result?.winner) return 0;
  return result.winner === actor ? 1000000000 : -1000000000;
}

/**
 * engine solo necesita implementar evaluate(fen, limits).
 * Esto permite probar la capa de variante con un evaluador simulado,
 * sin confundirlo con las pruebas de integración del WASM real.
 */
export async function chooseMove(
  state,
  difficulty,
  engine,
  progress = () => {},
  rules = CONFIG.rules
) {
  if (state.result) throw new Error("La IA recibió una partida terminada.");

  const level = CONFIG.ai.difficulties[difficulty];
  if (!level) throw new Error("Dificultad desconocida.");

  const actor = turnOf(state);
  const enemy = opposite(actor);

  let candidates = successors(state, rules).map(item => ({
    move: item.move,
    state: adjudicate(item.state, rules),
    unsafe: false,
  }));

  candidates.sort((a, b) => uciOf(a.move).localeCompare(uciOf(b.move)));

  if (!candidates.length) {
    throw new Error("No hay jugadas legales para la IA.");
  }

  const immediateWin = candidates.find(
    item => item.state.result?.winner === actor
  );

  if (immediateWin) return immediateWin.move;

  const notImmediatelyLost = candidates.filter(
    item => item.state.result?.winner !== enemy
  );

  if (notImmediatelyLost.length) candidates = notImmediatelyLost;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    progress({
      phase: "tactics",
      current: index + 1,
      total: candidates.length,
    });

    if (candidate.state.result) {
      candidate.unsafe = candidate.state.result.winner === enemy;
      continue;
    }

    // Búsqueda exhaustiva de victorias en una respuesta del rival.
    for (const reply of successors(candidate.state, rules)) {
      const final = adjudicate(reply.state, rules);

      if (final.result?.winner === enemy) {
        candidate.unsafe = true;
        break;
      }
    }
  }

  const safe = candidates.filter(item => !item.unsafe);
  if (safe.length) candidates = safe;

  const movetime = Math.max(
    10,
    Math.min(
      level.maxPerPositionMs,
      Math.floor(level.totalMs / candidates.length)
    )
  );

  let best = null;
  let bestScore = -Infinity;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    progress({
      phase: "engine",
      current: index + 1,
      total: candidates.length,
    });

    let score;

    if (candidate.state.result) {
      score = terminalScore(candidate.state.result, actor);
    } else {
      // Después de nuestra jugada es turno del enemigo:
      // la evaluación UCI debe cambiarse de signo.
      const conventional = await engine.evaluate(candidate.state.fen, {
        depth: level.depth,
        movetime,
      });

      score = -conventional +
        snailRisk(candidate.state, enemy, rules) -
        snailRisk(candidate.state, actor, rules);

      if (candidate.unsafe) score -= 10000000;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate.move;
    }
  }

  if (!best) throw new Error("La IA no pudo seleccionar una jugada.");
  return best;
}