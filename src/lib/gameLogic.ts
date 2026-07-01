// vsb3 純粋ゲームロジック
// 盤面は副作用なしのイミュータブル操作で扱う。UI / AI / Firebase 同期の全てがこれを基準にする。

import type { Board, BoardShapeId, Cell, Move, Player, StackPiece, Trap, WinLine } from '../types';
import { BLOCK } from '../types';

export const MAX_STACK = 10; // 1マスに積める最大段数（これ以上は着手不可）
export const START_TIME_MS = 300_000; // 初期持ち時間 5分
export const INCREMENT_MS = 15_000; // フィッシャー加算 +15秒
export const FIRST_PLAYER: Player = 'o';
export const WIN_LEN = 4;

// ---- 盤形状（ジオメトリ）----
// 盤は「境界グリッド dim×dim ＋ 穴（プレイ不可セル）」で表現する。cellIndex = row*dim + col。
// 穴セルは常に空スタックのままなので、そこを通る4連は pieceAt=null で自然に断たれる
// （＝勝利判定ロジックは形状非依存のまま流用できる）。全形状は D4 対称で公平。

/** 形状の定義。dim=境界グリッド辺長、active(r,c)=そのマスがプレイ可能か。 */
interface ShapeSpec {
  dim: number;
  active: (r: number, c: number) => boolean;
}

const SHAPE_SPECS: Record<BoardShapeId, ShapeSpec> = {
  // 4×4 全面（既定・従来どおり）。
  square: { dim: 4, active: () => true },
  // 5×5 の四隅を落とした八角形。
  octagon: {
    dim: 5,
    active: (r, c) => !((r === 0 || r === 4) && (c === 0 || c === 4)),
  },
  // 5×5 の菱形（中心からのマンハッタン距離 ≤ 2）。
  diamond: { dim: 5, active: (r, c) => Math.abs(r - 2) + Math.abs(c - 2) <= 2 },
  // 5×5 の十字（中央の行・列のみ）。
  plus: { dim: 5, active: (r, c) => r === 2 || c === 2 },
};

export const BOARD_SHAPE_IDS: BoardShapeId[] = ['square', 'octagon', 'diamond', 'plus'];

export interface BoardGeometry {
  id: BoardShapeId;
  dim: number;
  cellCount: number;
  /** プレイ可能なセル index の昇順リスト。 */
  active: number[];
  /** 穴（プレイ不可）セル index の集合。 */
  holes: Set<number>;
  /** 同一層内の水平ライン（AI 評価ヒューリスティック用）。穴を含まない4連窓のみ。 */
  winLines: number[][];
}

function buildGeometry(id: BoardShapeId): BoardGeometry {
  const spec = SHAPE_SPECS[id];
  const { dim } = spec;
  const cellCount = dim * dim;
  const active: number[] = [];
  const holes = new Set<number>();
  for (let i = 0; i < cellCount; i++) {
    const r = Math.floor(i / dim);
    const c = i % dim;
    if (spec.active(r, c)) active.push(i);
    else holes.add(i);
  }
  return { id, dim, cellCount, active, holes, winLines: buildWinLines(dim, holes) };
}

/** 行・列・両対角に沿う長さ4の窓のうち、穴を含まないものだけを列挙（AI ヒューリスティック用）。 */
function buildWinLines(dim: number, holes: Set<number>): number[][] {
  const lines: number[][] = [];
  const ok = (idxs: number[]) => idxs.every((i) => !holes.has(i));
  const push = (idxs: number[]) => {
    if (ok(idxs)) lines.push(idxs);
  };
  const at = (r: number, c: number) => r * dim + c;
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c + WIN_LEN <= dim; c++) push([0, 1, 2, 3].map((k) => at(r, c + k)));
  }
  for (let c = 0; c < dim; c++) {
    for (let r = 0; r + WIN_LEN <= dim; r++) push([0, 1, 2, 3].map((k) => at(r + k, c)));
  }
  for (let r = 0; r + WIN_LEN <= dim; r++) {
    for (let c = 0; c + WIN_LEN <= dim; c++) {
      push([0, 1, 2, 3].map((k) => at(r + k, c + k)));
      push([0, 1, 2, 3].map((k) => at(r + k, c + WIN_LEN - 1 - k)));
    }
  }
  return lines;
}

// 現在アクティブなジオメトリ（モジュール状態）。1対局中は不変で、対局／ルーム開始時に確定する。
// App が毎レンダー冒頭で有効な形状に同期する（同一形状なら no-op）。
let GEO: BoardGeometry = buildGeometry('square');

/** 現在の盤形状を設定する（同一 id なら再計算しない）。 */
export function setBoardShape(id: BoardShapeId): void {
  if (GEO.id === id) return;
  GEO = buildGeometry(id);
}
export function boardGeometry(): BoardGeometry {
  return GEO;
}
export function boardDim(): number {
  return GEO.dim;
}
export function boardCellCount(): number {
  return GEO.cellCount;
}
/** そのセルがプレイ可能（穴でない）か。 */
export function isActiveCell(cellIndex: number): boolean {
  return cellIndex >= 0 && cellIndex < GEO.cellCount && !GEO.holes.has(cellIndex);
}
/** 各プレイヤーの総ピース数＝有効セル数×2（正方形=32 で従来どおり）。 */
export function initialPieces(shape: BoardShapeId = GEO.id): number {
  return buildGeometry(shape).active.length * 2;
}
/** AI 評価用の水平ライン（穴を含まない4連窓）。旧 WIN_LINES 相当。 */
export function winLines(): number[][] {
  return GEO.winLines;
}

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

/** (col, row, layer) のピースを返す（中立ブロック 'b' を含みうる）。範囲外・穴・未配置なら null。 */
export function pieceAt(board: Board, c: number, r: number, layer: number): StackPiece | null {
  const dim = GEO.dim;
  if (c < 0 || c >= dim || r < 0 || r >= dim || layer < 0) return null;
  const idx = r * dim + c;
  if (GEO.holes.has(idx)) return null; // 穴は常に空＝ラインを断つ
  const stack = board[idx];
  return stack && layer < stack.length ? stack[layer] : null;
}

export function createEmptyBoard(): Board {
  return Array.from({ length: GEO.cellCount }, () => [] as Cell);
}

export function cloneBoard(board: Board): Board {
  return board.map((cell) => cell.slice());
}

export const oppositeOf = (p: Player): Player => (p === 'o' ? 'x' : 'o');

export function rowCol(cellIndex: number): [number, number] {
  return [Math.floor(cellIndex / GEO.dim), cellIndex % GEO.dim];
}

/** そのマスが満杯（MAX_STACK 到達）で、これ以上積めないか。 */
export function isCellFull(board: Board, cellIndex: number): boolean {
  return board[cellIndex].length >= MAX_STACK;
}

/** その要素が中立の落下ブロックか（型ガード）。 */
export function isBlock(p: StackPiece | null): p is typeof BLOCK {
  return p === BLOCK;
}

/**
 * 合法手の列挙。手持ちが残っていて MAX_STACK 未満のマスが合法。
 * 落下ブロック（トラップ）は着手を禁止しない（その上に積めるので合法性には影響しない）。
 */
export function legalMoves(board: Board, piecesLeftForPlayer: number): number[] {
  if (piecesLeftForPlayer <= 0) return [];
  const moves: number[] = [];
  for (const i of GEO.active) {
    if (board[i].length >= MAX_STACK) continue;
    moves.push(i);
  }
  return moves;
}

// ---- 落下ブロック（トラップ）----

/** 落下ブロックの個数プリセット。対局開始時にこの個数の予告を配置する。 */
export const TRAP_PRESETS = [0, 1, 2, 3] as const;
/** 降ってくる層の重み付き候補（低層寄り＝発動しやすさ重視）。 */
const TRAP_LAYER_POOL = [1, 1, 2, 2, 2, 3];

/**
 * ランダムに count 個のトラップ（落下ブロックの予告）を作る。
 * セルは重複しない（＝1列に予告は1つ）ので連鎖発動は起きない。
 * 層は低め(1〜3)に寄せ、ゲーム中に発動しやすく・不意すぎないバランスにする。
 */
export function pickTraps(count: number): Trap[] {
  const pool = GEO.active.slice(); // 穴には仕掛けない
  const n = Math.max(0, Math.min(pool.length, Math.floor(count || 0)));
  if (n === 0) return [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((cell) => ({
    cell,
    layer: TRAP_LAYER_POOL[Math.floor(Math.random() * TRAP_LAYER_POOL.length)],
  }));
}

/** 中立の落下ブロックを1個積んだ新しい盤面を返す。 */
export function applyBlock(board: Board, cellIndex: number): Board {
  const next = cloneBoard(board);
  next[cellIndex] = [...next[cellIndex], BLOCK];
  return next;
}

/**
 * いま cell へ着手した直後、その列で発動するトラップを返す（無ければ undefined）。
 * 「予告位置の1個下が埋まった＝スタック高さがちょうど trap.layer になった」瞬間に発動する。
 * （かつ、まだそのマスがブロックで埋まっていない場合のみ。）
 */
export function triggeredTrap(board: Board, cellIndex: number, traps: readonly Trap[]): Trap | undefined {
  const h = board[cellIndex].length;
  return traps.find((t) => t.cell === cellIndex && t.layer === h);
}

/** 着手＋（発動すれば）落下ブロックまで適用した盤面を返す。AI 探索・リプレイ再現で使う。 */
export function applyMoveWithTrap(
  board: Board,
  cellIndex: number,
  player: Player,
  traps: readonly Trap[],
): Board {
  let next = applyMove(board, cellIndex, player);
  if (triggeredTrap(next, cellIndex, traps)) next = applyBlock(next, cellIndex);
  return next;
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
  const dim = GEO.dim;
  const c = cellIndex % dim;
  const r = Math.floor(cellIndex / dim);
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
  const dim = GEO.dim;
  const maxLayer = board.reduce((m, cell) => Math.max(m, cell.length), 0);
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      for (let layer = 0; layer < maxLayer; layer++) {
        const p = pieceAt(board, c, r, layer);
        if (!p || isBlock(p)) continue; // 空 or 中立ブロックは起点にしない
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
  const dim = GEO.dim;
  const coords = [];
  for (let i = 0; i < WIN_LEN; i++) {
    const cc = c + i * dc;
    const rr = r + i * dr;
    const ll = layer + i * dl;
    if (pieceAt(board, cc, rr, ll) !== player) return null;
    coords.push({ cell: rr * dim + cc, layer: ll });
  }
  return { coords, player };
}

export function isBoardFull(piecesLeft: Record<Player, number>): boolean {
  return piecesLeft.o <= 0 && piecesLeft.x <= 0;
}

// ---- Firebase の board(Record<string,Player[]>) と Board(配列) の相互変換 ----

export function boardToRecord(board: Board): Record<string, StackPiece[]> {
  const rec: Record<string, StackPiece[]> = {};
  board.forEach((cell, i) => {
    if (cell.length > 0) rec[String(i)] = cell;
  });
  return rec;
}

export function recordToBoard(rec: Record<string, StackPiece[]> | null | undefined): Board {
  const board = createEmptyBoard();
  if (!rec) return board;
  for (const [k, v] of Object.entries(rec)) {
    const idx = Number(k);
    if (idx >= 0 && idx < GEO.cellCount && Array.isArray(v)) board[idx] = v.slice();
  }
  return board;
}

/**
 * 着手列を先頭から count 手だけ適用した盤面を返す（リプレイ用）。
 * traps を渡すと、各手のあとに実戦と同じく落下ブロックを発動させて再現する
 * （勝利手のあとは発動させない＝実戦の place と同じ挙動）。
 */
export function boardFromMoves(moves: Move[], count: number, traps: readonly Trap[] = []): Board {
  let board = createEmptyBoard();
  const n = Math.max(0, Math.min(count, moves.length));
  for (let i = 0; i < n; i++) {
    const { cell, player } = moves[i];
    board = applyMove(board, cell, player);
    if (!checkWinAt(board, cell, player) && triggeredTrap(board, cell, traps)) {
      board = applyBlock(board, cell);
    }
  }
  return board;
}
