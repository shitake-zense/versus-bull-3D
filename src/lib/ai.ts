// vsb3 AI: 反復深化 Minimax + α-β枝刈り。
// 勝利は3D（縦・横・斜め・階段・空間対角）なので、評価関数も全13方向のラインを見る。
// これにより「相手のオープン3を防ぐ」「自分のフォークを作る」といった立体的な手筋を理解する。
// 時間予算内で到達できる最大深さまで反復深化し、1手の思考時間が暴れないようにする。

import type { Board, Player } from '../types';
import {
  BOARD_DIM,
  DIRECTIONS,
  WIN_LEN,
  applyMove,
  checkWinAt,
  legalMoves,
  oppositeOf,
} from './gameLogic';

const TIME_BUDGET_MS = 350; // 1手あたりの思考時間の上限（UIフリーズ防止）
const MAX_DEPTH = 6; // 時間が余れば深掘りする上限
const WIN_SCORE = 1_000_000;

// ライン上に揃った枚数ごとの価値。
const LINE_VALUE = [0, 1, 14, 90, WIN_SCORE];
// 「空きマスが今すぐ置ける（スタック高さがちょうどその層）」ラインは脅威度が高い。
const IMMEDIATE_MULT = 6;

interface SearchCtx {
  ai: Player;
}

const ABORT = Symbol('abort');
let deadline = 0;
let nodeCounter = 0;

function checkTime(): void {
  // perf.now() は重いので 1024 ノードに1回だけ確認する。
  if ((nodeCounter++ & 1023) === 0 && performance.now() > deadline) throw ABORT;
}

/**
 * AIの着手を返す。手が無ければ null。
 * 即勝ちは最優先で取り、以降は時間予算まで反復深化する。
 */
export function getBestMove(
  board: Board,
  piecesLeft: Record<Player, number>,
  aiPlayer: Player,
): number | null {
  const rootMoves = orderedMoves(board, legalMoves(piecesLeft[aiPlayer]));
  if (rootMoves.length === 0) return null;

  // 即勝ちがあれば探索せず即採用。
  for (const m of rootMoves) {
    if (checkWinAt(applyMove(board, m, aiPlayer), m, aiPlayer)) return m;
  }

  const ctx: SearchCtx = { ai: aiPlayer };
  deadline = performance.now() + TIME_BUDGET_MS;
  nodeCounter = 0;
  let bestMove = rootMoves[0];

  for (let depth = 2; depth <= MAX_DEPTH; depth++) {
    try {
      const result = rootSearch(board, piecesLeft, aiPlayer, depth, bestMove, ctx);
      bestMove = result.move; // この深さは最後まで完了した
      if (result.score >= WIN_SCORE) break; // 必勝が見つかった
    } catch (e) {
      if (e === ABORT) break; // 時間切れ：前の深さの結果を採用
      throw e;
    }
  }
  return bestMove;
}

/** ルートで各手を評価し、最善手とスコアを返す（前回最善手を先頭にして枝刈り効率UP）。 */
function rootSearch(
  board: Board,
  piecesLeft: Record<Player, number>,
  aiPlayer: Player,
  depth: number,
  prevBest: number,
  ctx: SearchCtx,
): { move: number; score: number } {
  const moves = orderedMoves(board, legalMoves(piecesLeft[aiPlayer]));
  const ordered = [prevBest, ...moves.filter((m) => m !== prevBest)];

  let bestMove = ordered[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const move of ordered) {
    const next = applyMove(board, move, aiPlayer);
    const win = checkWinAt(next, move, aiPlayer);
    const score = win
      ? WIN_SCORE + depth
      : minimax(next, decrement(piecesLeft, aiPlayer), oppositeOf(aiPlayer), depth - 1, alpha, Infinity, ctx);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }
  return { move: bestMove, score: bestScore };
}

function minimax(
  board: Board,
  piecesLeft: Record<Player, number>,
  turn: Player,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
): number {
  checkTime();
  const moves = orderedMoves(board, legalMoves(piecesLeft[turn]));
  if (depth === 0 || moves.length === 0) {
    return evaluate(board, ctx.ai);
  }

  const maximizing = turn === ctx.ai;
  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const next = applyMove(board, move, turn);
    const win = checkWinAt(next, move, turn);
    let score: number;
    if (win) {
      // 浅い勝ち / 遅い負けを優先するため深さで微調整。
      score = turn === ctx.ai ? WIN_SCORE + depth : -(WIN_SCORE + depth);
    } else {
      score = minimax(next, decrement(piecesLeft, turn), oppositeOf(turn), depth - 1, alpha, beta, ctx);
    }

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * AI視点の3D盤面評価。全13方向の長さ4ウィンドウを走査し、
 * 相手に邪魔されていないラインを枚数に応じて加点（相手のラインは減点）。
 * 「今すぐ完成を狙える」ラインは IMMEDIATE_MULT 倍で重み付けし、攻防の即時性を反映する。
 */
function evaluate(board: Board, ai: Player): number {
  const heights = board.map((s) => s.length);
  let topLayer = -1;
  for (const h of heights) topLayer = Math.max(topLayer, h - 1);
  if (topLayer < 0) return 0;

  let score = 0;
  for (let r = 0; r < BOARD_DIM; r++) {
    for (let c = 0; c < BOARD_DIM; c++) {
      for (let L0 = 0; L0 <= topLayer; L0++) {
        for (const [dc, dr, dl] of DIRECTIONS) {
          let myCount = 0;
          let oppCount = 0;
          let immediate = true;
          let inBounds = true;

          for (let i = 0; i < WIN_LEN; i++) {
            const cc = c + i * dc;
            const rr = r + i * dr;
            const ll = L0 + i * dl;
            if (cc < 0 || cc >= BOARD_DIM || rr < 0 || rr >= BOARD_DIM || ll < 0) {
              inBounds = false;
              break;
            }
            const h = heights[rr * BOARD_DIM + cc];
            if (ll < h) {
              const p = board[rr * BOARD_DIM + cc][ll];
              if (p === ai) myCount++;
              else oppCount++;
            } else if (h !== ll) {
              // 空きだが、その層まで埋めるには下に詰め物が要る＝今すぐ完成できない。
              immediate = false;
            }
          }

          if (!inBounds) continue;
          if (myCount > 0 && oppCount > 0) continue; // 両者混在は死にライン
          if (myCount === 0 && oppCount === 0) continue; // 空ラインは無価値

          const count = myCount > 0 ? myCount : oppCount;
          let val = LINE_VALUE[count];
          if (immediate) val *= IMMEDIATE_MULT;
          score += myCount > 0 ? val : -val;
        }
      }
    }
  }
  return score;
}

function decrement(piecesLeft: Record<Player, number>, player: Player): Record<Player, number> {
  return { ...piecesLeft, [player]: piecesLeft[player] - 1 };
}

// 中央(5,6,9,10)に近いマスを優先する基準順。
const CENTER_ORDER = (() => {
  const center = (BOARD_DIM - 1) / 2;
  return Array.from({ length: BOARD_DIM * BOARD_DIM }, (_, i) => i).sort((a, b) => {
    const da = Math.abs((a % BOARD_DIM) - center) + Math.abs(Math.floor(a / BOARD_DIM) - center);
    const db = Math.abs((b % BOARD_DIM) - center) + Math.abs(Math.floor(b / BOARD_DIM) - center);
    return da - db;
  });
})();

/** 既にピースのあるマス（＝スタックが高い＝脅威が集まりやすい）を中央順より優先。 */
function orderedMoves(board: Board, moves: number[]): number[] {
  if (moves.length <= 1) return moves;
  const set = new Set(moves);
  return CENTER_ORDER.filter((m) => set.has(m)).sort((a, b) => board[b].length - board[a].length);
}
