import { beforeEach, describe, expect, it } from 'vitest';
import type { Board, Player, Trap, WinLine, Winner } from '../types';
import {
  applyBlock,
  applyMove,
  checkWinAt,
  createEmptyBoard,
  resolvePlacement,
  setBoardShape,
  triggeredTrap,
} from './gameLogic';

// 旧3実装（useGameLogic.place / useFirebaseRoom.place / boardFromMoves）が共有していた
// 着手解決ロジックの写経＝オラクル。resolvePlacement がこれと完全一致することを
// 「旧コードを消す前に」機械確認する（指示書 §7 D4 / Phase 3）。
function oracle(
  board: Board,
  cell: number,
  player: Player,
  traps: readonly Trap[],
  piecesLeft: Record<Player, number>,
): { board: Board; winLine: WinLine | null; winner: Winner; piecesLeft: Record<Player, number> } {
  let b = applyMove(board, cell, player);
  const win = checkWinAt(b, cell, player);
  if (!win && triggeredTrap(b, cell, traps)) b = applyBlock(b, cell);
  const left = { ...piecesLeft, [player]: piecesLeft[player] - 1 };
  let winner: Winner = null;
  if (win) winner = player;
  else if (left.o <= 0 && left.x <= 0) winner = 'draw';
  return { board: b, winLine: win, winner, piecesLeft: left };
}

interface Scenario {
  name: string;
  board: Board;
  cell: number;
  player: Player;
  traps: Trap[];
  piecesLeft: Record<Player, number>;
}

function scenarios(): Scenario[] {
  const full: Record<Player, number> = { o: 16, x: 16 };

  // 横3連の続き（勝利手）
  const nearWin = createEmptyBoard();
  nearWin[0] = ['o'];
  nearWin[1] = ['o'];
  nearWin[2] = ['o'];

  // トラップ発動（非勝利手）: cell5 高さ1 → 置くと高さ2 で layer2 発動
  const trapBoard = createEmptyBoard();
  trapBoard[5] = ['o'];

  // トラップが勝利層にある盤: cell6 に o を3段、4段目で縦勝ち。trap layer4 は発動しないはず
  const trapWin = createEmptyBoard();
  trapWin[6] = ['o', 'o', 'o'];

  // 引き分け（残り駒が両者0になる非勝利手）
  const drawBoard = createEmptyBoard();
  drawBoard[10] = ['x'];

  return [
    { name: '通常手（空盤）', board: createEmptyBoard(), cell: 5, player: 'o', traps: [], piecesLeft: full },
    { name: '勝利手（横4連）', board: nearWin, cell: 3, player: 'o', traps: [], piecesLeft: full },
    { name: 'トラップ発動（非勝利）', board: trapBoard, cell: 5, player: 'x', traps: [{ cell: 5, layer: 2 }], piecesLeft: full },
    { name: '勝利手ではトラップ非発動', board: trapWin, cell: 6, player: 'o', traps: [{ cell: 6, layer: 4 }], piecesLeft: full },
    { name: '引き分け（両者0）', board: drawBoard, cell: 11, player: 'o', traps: [], piecesLeft: { o: 1, x: 0 } },
  ];
}

beforeEach(() => setBoardShape('square'));

describe('resolvePlacement は旧3実装（オラクル）と一致する', () => {
  for (const sc of scenarios()) {
    it(sc.name, () => {
      setBoardShape('square');
      const got = resolvePlacement(sc.board, sc.cell, sc.player, sc.traps, sc.piecesLeft);
      const want = oracle(sc.board, sc.cell, sc.player, sc.traps, sc.piecesLeft);
      expect(got.board).toEqual(want.board);
      expect(got.winLine).toEqual(want.winLine);
      expect(got.winner).toBe(want.winner);
      expect(got.piecesLeft).toEqual(want.piecesLeft);
    });
  }

  it('入力盤面を破壊しない（イミュータブル）', () => {
    setBoardShape('square');
    const b = createEmptyBoard();
    b[5] = ['o'];
    const before = JSON.stringify(b);
    resolvePlacement(b, 5, 'x', [], { o: 16, x: 16 });
    expect(JSON.stringify(b)).toBe(before);
  });
});
