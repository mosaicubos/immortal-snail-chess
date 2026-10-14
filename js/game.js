import { Chess } from "../vendor/chess.js";
import { CONFIG } from "./config.js";
import {
  COLORS,
  opposite,
  validSquare,
  validateRules,
  countChessMove,
  nextSnailSquare,
} from "./snails.js";

export { Chess };

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function turnOf(state) {
  return state.fen.split(" ")[1];
}

/**
 * Codec de tablero: no implementa reglas de movimiento.
 * También sirve para dibujar una posición terminal sin uno de los reyes.
 */
export function boardFromFen(fen) {
  const board = {};
  const rows = fen.split(" ")[0].split("/");

  rows.forEach((row, rowIndex) => {
    let file = 0;

    for (const symbol of row) {
      if (/\d/.test(symbol)) {
        file += Number(symbol);
      } else {
        const square = String.fromCharCode(97 + file) + (8 - rowIndex);
        board[square] = {
          type: symbol.toLowerCase(),
          color: symbol === symbol.toUpperCase() ? "w" : "b",
        };
        file += 1;
      }
    }
  });

  return board;
}

export function encodeBoard(board) {
  const rows = [];

  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;

    for (let file = 0; file < 8; file += 1) {
      const square = String.fromCharCode(97 + file) + rank;
      const piece = board[square];

      if (!piece) {
        empty += 1;
      } else {
        if (empty) row += empty;
        empty = 0;
        row += piece.color === "w"
          ? piece.type.toUpperCase()
          : piece.type;
      }
    }

    if (empty) row += empty;
    rows.push(row);
  }

  return rows.join("/");
}

export function kingSquare(board, color) {
  return Object.keys(board).find(
    square => board[square].type === "k" && board[square].color === color
  );
}

function normalizedFen(chess) {
  // Conserva el objetivo original de en passant, incluso si actualmente
  // no hay un capturador. La clave de repetición se normaliza aparte.
  return chess.fen({ forceEnpassantSquare: true });
}

export function positionKey(state) {
  const chess = new Chess(state.fen);

  // chess.js normaliza el objetivo EP según su relevancia legal.
  const conventional = chess.fen().split(" ").slice(0, 4).join(" ");

  return [
    conventional,
    state.snails.w,
    state.snails.b,
    state.ticks.w,
    state.ticks.b,
  ].join("|");
}

/**
 * Constructor de posiciones válidas no terminales.
 * Permite superposiciones de caracoles para fixtures y estados de variante.
 * createGame() añade la validación más estricta de posiciones iniciales.
 */
export function makeState(
  fen = START_FEN,
  snails = CONFIG.rules.starts,
  ticks = { w: 0, b: 0 },
  rules = CONFIG.rules
) {
  validateRules(rules);
  const chess = new Chess(fen);

  for (const color of COLORS) {
    if (!validSquare(snails[color])) {
      throw new Error("Casilla de caracol inválida.");
    }

    if (!Number.isInteger(ticks[color]) ||
        ticks[color] < 0 ||
        ticks[color] >= rules.frequency) {
      throw new Error("Contador inválido.");
    }
  }

  const state = {
    fen: normalizedFen(chess),
    snails: { ...snails },
    ticks: { ...ticks },
    ply: 0,
    result: null,
    last: null,
    event: null,
    history: [],
    keys: [],
  };

  state.keys = [positionKey(state)];
  return state;
}

export function createGame(rules = CONFIG.rules) {
  validateRules(rules);
  const board = boardFromFen(START_FEN);

  for (const color of COLORS) {
    if (board[rules.starts[color]]) {
      throw new Error(
        `El caracol ${color} debe empezar en una casilla vacía.`
      );
    }
  }

  return makeState(START_FEN, rules.starts, { w: 0, b: 0 }, rules);
}

/**
 * Retirada atómica mediante FEN.
 *
 * No se utiliza Chess.remove(), para evitar sus actualizaciones implícitas.
 * No cambia turno ni número de jugada.
 * Conserva enroques y EP salvo los invalidados por la pieza retirada.
 * Reinicia el reloj de 50 movimientos porque ha ocurrido una captura.
 */
function removeCapturedPiece(fen, square) {
  const fields = fen.split(" ");
  const board = boardFromFen(fen);
  const victim = board[square];

  if (!victim) return fen;

  delete board[square];
  fields[0] = encodeBoard(board);

  let rights = fields[2] === "-" ? "" : fields[2];

  if (victim.type === "r") {
    const rookRight = {
      "w:a1": "Q",
      "w:h1": "K",
      "b:a8": "q",
      "b:h8": "k",
    }[`${victim.color}:${square}`];

    if (rookRight) rights = rights.replace(rookRight, "");
  }

  if (victim.type === "k") {
    rights = victim.color === "w"
      ? rights.replace(/[KQ]/g, "")
      : rights.replace(/[kq]/g, "");
  }

  fields[2] = rights || "-";

  if (fields[3] !== "-" && victim.type === "p") {
    const ep = fields[3];

    // Blancas al turno => el peón vulnerable es negro, en fila 5.
    // Negras al turno => el peón vulnerable es blanco, en fila 4.
    const vulnerable = ep[0] +
      (Number(ep[1]) + (fields[1] === "w" ? -1 : 1));

    if (square === vulnerable) fields[3] = "-";
  }

  fields[4] = "0";
  return fields.join(" ");
}

export function actionOf(move) {
  return {
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

export function uciOf(move) {
  return move.from + move.to + (move.promotion ?? "");
}

/**
 * Una transición completa, sin adjudicación convencional.
 *
 * Es la MISMA función para humanos, IA y pruebas.
 * Devuelve null si el avance deja en jaque al rey que acaba de mover.
 * Capturar un rey produce un terminal antes de realizar esa comprobación.
 */
function transition(state, action, rules) {
  if (state.result) throw new Error("THe game already ended");

  const chess = new Chess(state.fen);
  const actor = chess.turn();
  const move = chess.move(action);

  const counted = countChessMove(state.ticks, actor, rules);

  const next = {
    ...state,
    fen: normalizedFen(chess),
    snails: { ...state.snails },
    ticks: counted.ticks,
    ply: state.ply + 1,
    result: null,
    last: {
      ...actionOf(move),
      san: move.san,
      color: actor,
    },
    event: null,
  };

  if (counted.due) {
    const board = boardFromFen(next.fen);
    const king = kingSquare(board, actor);
    if (!king) throw new Error("Estado no terminal sin rey.");

    const from = next.snails[actor];
    const to = nextSnailSquare(from, king, rules);
    const victim = board[to] ? { ...board[to] } : null;

    next.snails[actor] = to;
    next.event = { color: actor, from, to, captured: victim };

    if (victim) {
      next.fen = removeCapturedPiece(next.fen, to);

      if (victim.type === "k") {
        const ownKing = victim.color === actor;

        next.result = {
          winner: ownKing ? opposite(actor) : actor,
          reason: ownKing ? "snail-own-king" : "snail-enemy-king",
        };

        // No construir Chess con un FEN al que le falta un rey.
        // La interfaz dibuja directamente el tablero terminal.
        return next;
      }
    }
  }

  const after = new Chess(next.fen);
  const board = boardFromFen(next.fen);
  const ownKing = kingSquare(board, actor);

  if (after.isAttacked(ownKing, opposite(actor))) {
    return null;
  }

  next.keys = [...state.keys, positionKey(next)];
  return next;
}

/**
 * Jugadas legales de la variante.
 * chess.js genera todas las jugadas convencionales; solo se añade
 * la comprobación de seguridad posterior a la activación.
 *
 * Los sucesores aún no incluyen finales convencionales.
 */
export function successors(state, rules = CONFIG.rules) {
  if (state.result) return [];

  const chess = new Chess(state.fen);
  const list = [];

  for (const move of chess.moves({ verbose: true })) {
    const action = actionOf(move);
    const next = transition(state, action, rules);
    if (next) list.push({ move: action, state: next });
  }

  return list;
}

export function adjudicate(state, rules = CONFIG.rules) {
  if (state.result) return state;

  const chess = new Chess(state.fen);
  let result = null;

  if (chess.isCheckmate()) {
    result = { winner: opposite(chess.turn()), reason: "checkmate" };
  } else if (chess.isStalemate()) {
    result = { winner: null, reason: "stalemate" };
  } else {
    // Puede haber jugadas convencionales pero ninguna que mantenga
    // la seguridad del rey después del avance.
    const hasVariantMove = chess.moves({ verbose: true }).some(move =>
      transition(state, actionOf(move), rules) !== null
    );

    if (!hasVariantMove) {
      result = chess.inCheck()
        ? { winner: opposite(chess.turn()), reason: "variant-checkmate" }
        : { winner: null, reason: "variant-stalemate" };
    } else if (chess.isInsufficientMaterial()) {
      result = { winner: null, reason: "insufficient-material" };
    } else if (chess.isDrawByFiftyMoves()) {
      result = { winner: null, reason: "fifty-moves" };
    } else {
      const key = positionKey(state);
      const repetitions = state.keys.filter(item => item === key).length;
      if (repetitions >= 3) {
        result = { winner: null, reason: "repetition" };
      }
    }
  }

  return result ? { ...state, result } : state;
}

/**
 * Confirma una jugada real.
 * Las simulaciones usan transition/successors; solo aquí se añade historial.
 */
export function play(state, action, rules = CONFIG.rules) {
  if (state.result) throw new Error("The game already ended");

  let next;

  try {
    next = transition(state, action, rules);
  } catch (error) {
    throw new Error(`Jugada ilegal: ${error.message}`);
  }

  if (!next) {
    throw new Error(
      "Illegal move: the snail would leave your king in check after the advance."
    );
  }

  next = adjudicate(next, rules);

  return {
    ...next,
    history: [
      ...state.history,
      {
        ply: next.ply,
        color: next.last.color,
        san: next.last.san,
        event: next.event,
      },
    ],
  };
}

const PIECE_NAMES = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export function colorName(color) {
  return color === "w" ? "White" : "Black";
}

export function eventText(event) {
  if (!event) return "";

  let text =
    `${colorName(event.color)} snail: ` +
    `${event.from.toUpperCase()} → ${event.to.toUpperCase()}.`;

  if (event.captured) {
    const side = colorName(event.captured.color).toLowerCase();
    const piece = PIECE_NAMES[event.captured.type];

    text += ` Captures a ${side} ${piece}.`;
  }

  return text;
}

export function resultText(result) {
  if (!result) return "";

  const outcome = result.winner
    ? `${colorName(result.winner)} wins`
    : "Draw";

  const reasons = {
    "snail-own-king": "the snail reached its own king",
    "snail-enemy-king": "the snail captured the opposing king",
    checkmate: "checkmate",
    stalemate: "stalemate",
    "variant-checkmate":
      "check with no legal response after accounting for the snail",
    "variant-stalemate":
      "no legal moves in the variant, without check",
    "insufficient-material":
      "insufficient material according to chess.js",
    "fifty-moves": "the fifty-move rule",
    repetition: "threefold repetition of the complete game state",
  };

  return `${outcome}: ${reasons[result.reason] ?? result.reason}.`;
}