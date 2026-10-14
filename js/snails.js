export const COLORS = ["w", "b"];

export function opposite(color) {
  return color === "w" ? "b" : "w";
}

export function validSquare(square) {
  return typeof square === "string" && /^[a-h][1-8]$/.test(square);
}

export function coordinates(square) {
  if (!validSquare(square)) throw new Error(`Casilla inválida: ${square}`);
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

export function squareAt(x, y) {
  return String.fromCharCode(97 + x) + String(y + 1);
}

export function chebyshev(a, b) {
  const [ax, ay] = coordinates(a);
  const [bx, by] = coordinates(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function validateRules(rules) {
  if (!Number.isInteger(rules.frequency) || rules.frequency < 1) {
    throw new Error("La frecuencia debe ser un entero positivo.");
  }

  if (!["file-rank", "rank-file"].includes(rules.tieBreak)) {
    throw new Error("Criterio de desempate desconocido.");
  }

  for (const color of COLORS) {
    if (!validSquare(rules.starts[color])) {
      throw new Error(`Posición inicial inválida del caracol ${color}.`);
    }
  }

  if (rules.starts.w === rules.starts.b) {
    throw new Error("Los caracoles deben empezar en casillas distintas.");
  }
}

/**
 * ÚNICO punto donde avanza el contador.
 *
 * Se llama exactamente una vez por jugada convencional confirmada
 * o por una simulación independiente de esa jugada.
 *
 * Los valores guardados son restos: 0 ... frequency - 1.
 * Solo puede activarse el caracol del jugador que acaba de mover.
 * Los movimientos automáticos NO llaman a esta función.
 */
export function countChessMove(ticks, actor, rules) {
  const next = { ...ticks };

  for (const color of COLORS) {
    if (!Number.isInteger(next[color]) ||
        next[color] < 0 ||
        next[color] >= rules.frequency) {
      throw new Error("Contador de caracol fuera de rango.");
    }
  }

  if (!COLORS.includes(actor)) throw new Error("Color inválido.");

  next[actor] += 1;
  const due = next[actor] === rules.frequency;
  if (due) next[actor] = 0;

  return { ticks: next, due };
}

/**
 * Movimiento determinista, sin obstáculos.
 *
 * Se consideran exclusivamente vecinos que reduzcan la distancia.
 * Entre ellos se minimiza Chebyshev y después el orden configurado.
 *
 * Adyacente: llega al rey.
 * Misma casilla: permanece y el llamador resuelve su captura.
 */
export function nextSnailSquare(from, king, rules) {
  const initialDistance = chebyshev(from, king);
  if (initialDistance === 0) return from;

  const [x, y] = coordinates(from);
  const candidates = [];

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;

      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx > 7 || ny < 0 || ny > 7) continue;

      const square = squareAt(nx, ny);
      const distance = chebyshev(square, king);

      if (distance < initialDistance) {
        candidates.push({ square, distance, x: nx, y: ny });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (rules.tieBreak === "rank-file") {
      return a.y - b.y || a.x - b.x;
    }
    return a.x - b.x || a.y - b.y;
  });

  // En un tablero rectangular sin obstáculos solo se alcanza este
  // fallback cuando no hay vecino más cercano. No hay recursión.
  return candidates[0]?.square ?? from;
}