// vsb3 純粋ゲームロジック
// 盤面は副作用なしのイミュータブル操作で扱う。UI / AI / Firebase 同期の全てがこれを基準にする。

import type { Board, Cell, Move, Player, WinLine } from '../types';

export const BOARD_DIM = 4; // 4×4
export const CELL_COUNT = BOARD_DIM * BOARD_DIM; // 16
export const INITIAL_PIECES = 32; // 各プレイヤーの総ピース数
export const START_TIME_MS = 300_000; // 初期持ち時間 5分
export const INCREMENT_MS = 15_000; // フィッシャー加算 +15秒
export const FIRST_PLAYER: Player = 'o';

/**
 * 同一層内の水平ライン（行4・列4・対角2 = 10本）。各要素は cellIndex の配列。
 * 正式な勝利判定は checkWinAt(3D) が行う。これは AI 評価関数のヒューリスティック用。
 */
export const WIN_LINES: number[][] = buildWinLines();

function buildWinLines(): number[][] {
  const lines: number[][] = [];
  // 行
  for (let r = 0; r < BOARD_DIM; r++) {
    lines.push([0, 1, 2, 3].map((c) => r * BOARD_DIM + c));
  }
  // 列
  for (let c = 0; c < BOARD_DIM; c++) {
    lines.push([0, 1, 2, 3].map((r) => r * BOARD_DIM + c));
  }
  // 対角
  lines.push([0, 1, 2, 3].map((i) => i * BOARD_DIM + i));
  lines.push([0, 1, 2, 3].map((i) => i * BOARD_DIM + (BOARD_DIM - 1 - i)));
  return lines;
}

export const WIN_LEN = 4;

// 盤面を 3D 格子 (x=列, y=高さ層, z=行) として扱い、全方向の直線4連を勝利とする。
// 横（行・列・面内の斜め）・縦（同一マスに4段）・階段状（行/列/斜めに沿って1段ずつ上る）を
// すべて含む。符号反転で重複する向きを除いた 13 方向を列挙する。
export type Dir = readonly [number, number, number]; // [dCol, dRow, dLayer]

export const DIRECTIONS: Dir[] = (() => {
  const dirs: Dir[] = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dl = -1; dl <= 1; dl++) {
        if (dc === 0 && dr === 0 && dl === 0) continue;
        const firstNonZero = [dc, dr, dl].find((v) => v !== 0);
        // 各直線は向きと逆向きで同一。最初の非ゼロ成分が +1 のものだけ採用して重複を除く。
        if (firstNonZero === 1) dirs.push([dc, dr, dl] as const);
      }
    }
  }
  return dirs; // 13 方向
})();

/** (col, row, layer) のピースを返す。範囲外・未配置なら null。 */
export function pieceAt(board: Board, c: number, r: number, layer: number): Player | null {
  if (c < 0 || c >= BOARD_DIM || r < 0 || r >= BOARD_DIM || layer < 0) return null;
  const stack = board[r * BOARD_DIM + c];
  return layer < stack.length ? stack[layer] : null;
}

export function createEmptyBoard(): Board {
  return Array.from({ length: CELL_COUNT }, () => [] as Cell);
}

export function cloneBoard(board: Board): Board {
  return board.map((cell) => cell.slice());
}

export const oppositeOf = (p: Player): Player => (p === 'o' ? 'x' : 'o');

export function rowCol(cellIndex: number): [number, number] {
  return [Math.floor(cellIndex / BOARD_DIM), cellIndex % BOARD_DIM];
}

/**
 * 合法手の列挙。高さ制限が無いため、手持ちが残っていれば全16マスが合法。
 * TODO(blocker): 将来ブロッカーピースを導入する場合はここで対象マスを除外する。
 */
export function legalMoves(piecesLeftForPlayer: number): number[] {
  if (piecesLeftForPlayer <= 0) return [];
  return Array.from({ length: CELL_COUNT }, (_, i) => i);
}

/** 着手を適用した新しい盤面を返す（元の board は変更しない）。 */
export function applyMove(board: Board, cellIndex: number, player: Player): Board {
  const next = cloneBoard(board);
  next[cellIndex] = [...next[cellIndex], player];
  return next;
}

/**
 * 直近に置いたマス起点で勝利判定（3D・全13方向）。
 * 横・縦・斜め・階段状のいずれかで同一プレイヤーが4連すると成立。
 */
export function checkWinAt(board: Board, cellIndex: number, player: Player): WinLine | null {
  const c = cellIndex % BOARD_DIM;
  const r = Math.floor(cellIndex / BOARD_DIM);
  const layer = board[cellIndex].length - 1; // たった今置いた最上段
  if (layer < 0) return null;

  for (const [dc, dr, dl] of DIRECTIONS) {
    // 置いたピースを長さ4の窓のどの位置(k)に置いても勝てるよう、窓の起点をずらして探す。
    for (let k = 0; k < WIN_LEN; k++) {
      const line = lineFrom(board, c - k * dc, r - k * dr, layer - k * dl, dc, dr, dl, player);
      if (line) return line;
    }
  }
  return null;
}

/** 盤面全体を走査して勝利ラインを探す（同期復元・保険用）。 */
export function scanWin(board: Board): WinLine | null {
  const maxLayer = board.reduce((m, cell) => Math.max(m, cell.length), 0);
  for (let r = 0; r < BOARD_DIM; r++) {
    for (let c = 0; c < BOARD_DIM; c++) {
      for (let layer = 0; layer < maxLayer; layer++) {
        const p = pieceAt(board, c, r, layer);
        if (!p) continue;
        for (const [dc, dr, dl] of DIRECTIONS) {
          const line = lineFrom(board, c, r, layer, dc, dr, dl, p);
          if (line) return line;
        }
      }
    }
  }
  return null;
}

/** 起点(c,r,layer)から方向(dc,dr,dl)へ4連が player で揃っていれば WinLine を返す。 */
function lineFrom(
  board: Board,
  c: number,
  r: number,
  layer: number,
  dc: number,
  dr: number,
  dl: number,
  player: Player,
): WinLine | null {
  const coords = [];
  for (let i = 0; i < WIN_LEN; i++) {
    const cc = c + i * dc;
    const rr = r + i * dr;
    const ll = layer + i * dl;
    if (pieceAt(board, cc, rr, ll) !== player) return null;
    coords.push({ cell: rr * BOARD_DIM + cc, layer: ll });
  }
  return { coords, player };
}

export function isBoardFull(piecesLeft: Record<Player, number>): boolean {
  return piecesLeft.o <= 0 && piecesLeft.x <= 0;
}

// ---- Firebase の board(Record<string,Player[]>) と Board(配列) の相互変換 ----

export function boardToRecord(board: Board): Record<string, Player[]> {
  const rec: Record<string, Player[]> = {};
  board.forEach((cell, i) => {
    if (cell.length > 0) rec[String(i)] = cell;
  });
  return rec;
}

export function recordToBoard(rec: Record<string, Player[]> | null | undefined): Board {
  const board = createEmptyBoard();
  if (!rec) return board;
  for (const [k, v] of Object.entries(rec)) {
    const idx = Number(k);
    if (idx >= 0 && idx < CELL_COUNT && Array.isArray(v)) board[idx] = v.slice();
  }
  return board;
}

/** 着手列を先頭から count 手だけ適用した盤面を返す（リプレイ用）。 */
export function boardFromMoves(moves: Move[], count: number): Board {
  let board = createEmptyBoard();
  const n = Math.max(0, Math.min(count, moves.length));
  for (let i = 0; i < n; i++) board = applyMove(board, moves[i].cell, moves[i].player);
  return board;
}
