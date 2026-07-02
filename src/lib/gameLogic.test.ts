import { beforeEach, describe, expect, it } from 'vitest';
import type { Move, Trap } from '../types';
import { BLOCK } from '../types';
import {
  applyMoveWithTrap,
  boardFromMoves,
  checkWinAt,
  createEmptyBoard,
  initialPieces,
  isActiveCell,
  legalMoves,
  pieceAt,
  pickTraps,
  scanWin,
  setBoardShape,
  triggeredTrap,
} from './gameLogic';

// GEO はモジュールレベル可変状態。各テストの冒頭で形状を明示し、
// ファイル間・テスト間の暗黙依存を作らない（指示書 §7 D13 の注意）。
beforeEach(() => setBoardShape('square'));

describe('勝利判定（4形状すべて square で検証）', () => {
  it('横一列（同一層・行方向）で4連', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[0] = ['o'];
    b[1] = ['o'];
    b[2] = ['o'];
    b[3] = ['o'];
    const win = checkWinAt(b, 3, 'o');
    expect(win).not.toBeNull();
    expect(win!.player).toBe('o');
    expect(win!.coords.map((c) => c.cell).sort((a, z) => a - z)).toEqual([0, 1, 2, 3]);
  });

  it('縦（同一マスに4段）で4連', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[5] = ['o', 'o', 'o', 'o'];
    const win = checkWinAt(b, 5, 'o');
    expect(win).not.toBeNull();
    expect(win!.coords.every((c) => c.cell === 5)).toBe(true);
    expect(win!.coords.map((c) => c.layer).sort((a, z) => a - z)).toEqual([0, 1, 2, 3]);
  });

  it('面内斜め（同一層の対角）で4連', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[0] = ['o']; // (c0,r0)
    b[5] = ['o']; // (c1,r1)
    b[10] = ['o']; // (c2,r2)
    b[15] = ['o']; // (c3,r3)
    const win = checkWinAt(b, 15, 'o');
    expect(win).not.toBeNull();
    expect(win!.coords.map((c) => c.cell).sort((a, z) => a - z)).toEqual([0, 5, 10, 15]);
  });

  it('階段状（行方向に進みつつ1段ずつ上る）で4連', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    // (c0,r0,L0),(c1,r0,L1),(c2,r0,L2),(c3,r0,L3) をすべて 'o'。下段は 'x' 詰め物。
    b[0] = ['o'];
    b[1] = ['x', 'o'];
    b[2] = ['x', 'x', 'o'];
    b[3] = ['x', 'x', 'x', 'o'];
    const win = checkWinAt(b, 3, 'o');
    expect(win).not.toBeNull();
    expect(win!.player).toBe('o');
    expect(win!.coords.map((c) => c.layer)).toEqual([0, 1, 2, 3]);
  });

  it('空間対角（col/row/layer すべて変化）で4連', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[0] = ['o']; // (c0,r0,L0)
    b[5] = ['x', 'o']; // (c1,r1,L1)
    b[10] = ['x', 'x', 'o']; // (c2,r2,L2)
    b[15] = ['x', 'x', 'x', 'o']; // (c3,r3,L3)
    const win = checkWinAt(b, 15, 'o');
    expect(win).not.toBeNull();
    expect(win!.player).toBe('o');
  });

  it('中立ブロック "b" はラインを断つ', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[0] = ['o'];
    b[1] = ['o'];
    b[2] = [BLOCK]; // 真ん中がブロック
    b[3] = ['o'];
    expect(checkWinAt(b, 3, 'o')).toBeNull();
    expect(scanWin(b)).toBeNull();
  });

  it('穴セルはラインを断つ（同一 index が square では勝ち・octagon では穴で不成立）', () => {
    // square: cells 0..3 の横一列は勝ち。
    setBoardShape('square');
    const sq = createEmptyBoard();
    sq[0] = ['o'];
    sq[1] = ['o'];
    sq[2] = ['o'];
    sq[3] = ['o'];
    expect(scanWin(sq)).not.toBeNull();

    // octagon: dim5, idx0(=r0,c0) と idx4(=r0,c4) は穴。row0 の横一列は穴で断たれる。
    setBoardShape('octagon');
    expect(isActiveCell(0)).toBe(false);
    const oc = createEmptyBoard();
    oc[0] = ['o']; // 穴（pieceAt は null を返す）
    oc[1] = ['o'];
    oc[2] = ['o'];
    oc[3] = ['o'];
    expect(pieceAt(oc, 0, 0, 0)).toBeNull(); // 穴は盤に値があっても null
    expect(scanWin(oc)).toBeNull();
  });

  it('checkWinAt と scanWin は一致する（勝ち／非勝ちとも）', () => {
    setBoardShape('square');
    const win = createEmptyBoard();
    win[0] = ['x'];
    win[1] = ['x'];
    win[2] = ['x'];
    win[3] = ['x'];
    const a = checkWinAt(win, 3, 'x');
    const s = scanWin(win);
    expect(a).not.toBeNull();
    expect(s).not.toBeNull();
    expect(s!.player).toBe(a!.player);

    const noWin = createEmptyBoard();
    noWin[0] = ['o'];
    noWin[1] = ['o'];
    noWin[2] = ['x'];
    expect(checkWinAt(noWin, 1, 'o')).toBeNull();
    expect(scanWin(noWin)).toBeNull();
  });
});

describe('トラップ（落下ブロック）', () => {
  it('triggeredTrap は「予告層＝現在の高さ」で発動、それ以外は発動しない', () => {
    setBoardShape('square');
    const traps: Trap[] = [{ cell: 5, layer: 1 }];
    const empty = createEmptyBoard();
    expect(triggeredTrap(empty, 5, traps)).toBeUndefined(); // 高さ0

    const h1 = createEmptyBoard();
    h1[5] = ['o']; // 高さ1
    expect(triggeredTrap(h1, 5, traps)).toEqual({ cell: 5, layer: 1 });

    const otherCell = createEmptyBoard();
    otherCell[6] = ['o'];
    expect(triggeredTrap(otherCell, 6, traps)).toBeUndefined(); // 別セル
  });

  it('applyMoveWithTrap は発動層に達すると中立ブロックを積む', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[5] = ['o']; // 高さ1
    const traps: Trap[] = [{ cell: 5, layer: 2 }];
    const next = applyMoveWithTrap(b, 5, 'x', traps); // 置くと高さ2 → 発動
    expect(next[5]).toEqual(['o', 'x', BLOCK]);
  });

  it('boardFromMoves: 非勝利手ではトラップ発動、勝利手では非発動', () => {
    setBoardShape('square');
    // 非勝利手で発動: 2手目で高さ2 → トラップ layer2 発動
    const moves2: Move[] = [
      { cell: 5, player: 'o' },
      { cell: 5, player: 'o' },
    ];
    const dropped = boardFromMoves(moves2, 2, [{ cell: 5, layer: 2 }]);
    expect(dropped[5]).toEqual(['o', 'o', BLOCK]);

    // 勝利手では非発動: 4手目（縦4連＝勝ち）でトラップ layer4 があっても降らない
    const moves4: Move[] = [
      { cell: 5, player: 'o' },
      { cell: 5, player: 'o' },
      { cell: 5, player: 'o' },
      { cell: 5, player: 'o' },
    ];
    const winBoard = boardFromMoves(moves4, 4, [{ cell: 5, layer: 4 }]);
    expect(winBoard[5]).toEqual(['o', 'o', 'o', 'o']); // ブロックは積まれない
  });

  it('pickTraps は穴に仕掛けず、要求個数を返す', () => {
    setBoardShape('octagon');
    const traps = pickTraps(3);
    expect(traps).toHaveLength(3);
    for (const t of traps) {
      expect(isActiveCell(t.cell)).toBe(true);
      expect(t.layer).toBeGreaterThanOrEqual(1);
      expect(t.layer).toBeLessThanOrEqual(3);
    }
    // セル重複なし
    const cells = traps.map((t) => t.cell);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('盤形状', () => {
  it('initialPieces は有効セル×2（square=32, octagon=42, diamond=26, plus=18）', () => {
    expect(initialPieces('square')).toBe(32);
    expect(initialPieces('octagon')).toBe(42);
    expect(initialPieces('diamond')).toBe(26);
    expect(initialPieces('plus')).toBe(18);
  });

  it('legalMoves は穴セルを含まない', () => {
    setBoardShape('plus'); // dim5 十字。row2 or col2 のみ有効。
    const moves = legalMoves(createEmptyBoard(), 18);
    expect(moves).toHaveLength(9); // 有効セル数
    for (const m of moves) expect(isActiveCell(m)).toBe(true);
    // idx0 (r0,c0) は穴
    expect(moves).not.toContain(0);
  });

  it('setBoardShape は形状（穴・有効セル数）を切り替える', () => {
    setBoardShape('square');
    expect(isActiveCell(0)).toBe(true);
    expect(legalMoves(createEmptyBoard(), 32)).toHaveLength(16);

    setBoardShape('diamond');
    expect(isActiveCell(0)).toBe(false); // 四隅は穴
    expect(legalMoves(createEmptyBoard(), 26)).toHaveLength(13);
  });
});
