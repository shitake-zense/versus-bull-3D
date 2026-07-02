import { describe, expect, it } from 'vitest';
import { nextSeat, prevSeat, requiredSeats, seatCycle, seatTeam, startingSeat } from './seats';

describe('seats', () => {
  it('席の巡回順（1vs1 は o→x、2vs2 は o→x→o2→x2）', () => {
    expect(seatCycle(false)).toEqual(['o', 'x']);
    expect(seatCycle(true)).toEqual(['o', 'x', 'o2', 'x2']);
  });

  it('nextSeat は巡回する', () => {
    expect(nextSeat('o', false)).toBe('x');
    expect(nextSeat('x', false)).toBe('o');
    expect(nextSeat('o', true)).toBe('x');
    expect(nextSeat('x', true)).toBe('o2');
    expect(nextSeat('o2', true)).toBe('x2');
    expect(nextSeat('x2', true)).toBe('o'); // 一周
  });

  it('prevSeat は巡回を逆にたどる', () => {
    expect(prevSeat('x', false)).toBe('o');
    expect(prevSeat('o', false)).toBe('x'); // 一周（逆）
    expect(prevSeat('o', true)).toBe('x2');
    expect(prevSeat('x2', true)).toBe('o2');
  });

  it('seatTeam は席をチーム（盤の記号）へ畳む', () => {
    expect(seatTeam('o')).toBe('o');
    expect(seatTeam('o2')).toBe('o');
    expect(seatTeam('x')).toBe('x');
    expect(seatTeam('x2')).toBe('x');
  });

  it('startingSeat / requiredSeats', () => {
    expect(startingSeat('o')).toBe('o');
    expect(startingSeat('x')).toBe('x');
    expect(requiredSeats(false)).toEqual(['o', 'x']);
    expect(requiredSeats(true)).toEqual(['o', 'x', 'o2', 'x2']);
  });
});
