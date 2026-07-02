import { beforeEach, describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { getBestMove } from './ai';
import { createEmptyBoard, setBoardShape } from './gameLogic';

const FULL: Record<Player, number> = { o: 16, x: 16 };

// 時間予算に依存して flaky にならないよう、深さ2で確実に見える手だけを題材にする。
beforeEach(() => setBoardShape('square'));

describe('AI スモーク（hard, blunderRate=0）', () => {
  it('即勝ち手を取る（横3連の4つ目）', () => {
    const b = createEmptyBoard();
    b[0] = ['o'];
    b[1] = ['o'];
    b[2] = ['o']; // 0,1,2 に o。cell3 で 4連完成。
    expect(getBestMove(b, FULL, 'o', 'hard')).toBe(3);
  });

  it('相手の即勝ちを防ぐ（横3連を塞ぐ）', () => {
    const b = createEmptyBoard();
    b[0] = ['x'];
    b[1] = ['x'];
    b[2] = ['x']; // x が 0,1,2。o は cell3 を塞ぐしかない。
    expect(getBestMove(b, FULL, 'o', 'hard')).toBe(3);
  });

  it('合法手が無ければ null', () => {
    const b = createEmptyBoard();
    expect(getBestMove(b, { o: 0, x: 0 }, 'o', 'hard')).toBeNull();
  });
});
