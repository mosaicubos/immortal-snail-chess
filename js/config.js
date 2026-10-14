export const CONFIG = Object.freeze({
  rules: Object.freeze({
    starts: Object.freeze({ w: "a4", b: "a5" }),
    frequency: 3,

    // "file-rank": a1, a2, ..., a8, b1, ...
    // "rank-file": a1, b1, ..., h1, a2, ...
    tieBreak: "file-rank",
  }),

  ai: Object.freeze({
    hashMB: 16,

    // Se aplican límites UCI reales: depth y movetime.
    // totalMs es el presupuesto aproximado de Stockfish, repartido
    // entre las posiciones candidatas. No incluye la simulación JS.
    difficulties: Object.freeze({
      easy: Object.freeze({
        label: "Easy",
        depth: 2,
        totalMs: 500,
        maxPerPositionMs: 45,
      }),
      normal: Object.freeze({
        label: "Normal",
        depth: 5,
        totalMs: 1400,
        maxPerPositionMs: 120,
      }),
      hard: Object.freeze({
        label: "Hard",
        depth: 9,
        totalMs: 3500,
        maxPerPositionMs: 250,
      }),
      expert: Object.freeze({
        label: "Expert",
        depth: 14,
        totalMs: 7000,
        maxPerPositionMs: 450,
      }),
    }),

    // Heurística complementaria, en unidades similares a centipeones.
    snailRiskWeight: 60,
  }),
});