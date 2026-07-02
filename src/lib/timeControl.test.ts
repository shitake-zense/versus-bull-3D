import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_CONTROL,
  UNLIMITED,
  isUnlimited,
  normalizeTimeControl,
  resolveStartingPlayer,
} from './timeControl';

describe('timeControl', () => {
  it('normalizeTimeControl: undefined/null はデフォルト（5分+15秒）', () => {
    expect(normalizeTimeControl(undefined)).toEqual(DEFAULT_TIME_CONTROL);
    expect(normalizeTimeControl(null)).toEqual(DEFAULT_TIME_CONTROL);
    expect(DEFAULT_TIME_CONTROL).toEqual({ baseMs: 300_000, incrementMs: 15_000 });
  });

  it('normalizeTimeControl: baseMs<=0 は無制限', () => {
    expect(normalizeTimeControl({ baseMs: 0, incrementMs: 0 })).toEqual(UNLIMITED);
    expect(normalizeTimeControl({ baseMs: -100, incrementMs: 5_000 })).toEqual(UNLIMITED);
  });

  it('normalizeTimeControl: incrementMs 欠落/負値は 0 に矯正', () => {
    // 旧ルーム: incrementMs 未設定（undefined を型で潰して渡す）
    expect(normalizeTimeControl({ baseMs: 60_000 } as never)).toEqual({
      baseMs: 60_000,
      incrementMs: 0,
    });
    expect(normalizeTimeControl({ baseMs: 60_000, incrementMs: -1 })).toEqual({
      baseMs: 60_000,
      incrementMs: 0,
    });
  });

  it('normalizeTimeControl: baseMs が数値でない不正値はデフォルト', () => {
    expect(normalizeTimeControl({ baseMs: 'x' } as never)).toEqual(DEFAULT_TIME_CONTROL);
  });

  it('isUnlimited', () => {
    expect(isUnlimited({ baseMs: 0, incrementMs: 0 })).toBe(true);
    expect(isUnlimited({ baseMs: -1, incrementMs: 0 })).toBe(true);
    expect(isUnlimited(DEFAULT_TIME_CONTROL)).toBe(false);
  });

  it('resolveStartingPlayer: o/x はそのまま、未設定は o、random は o か x', () => {
    expect(resolveStartingPlayer('o')).toBe('o');
    expect(resolveStartingPlayer('x')).toBe('x');
    expect(resolveStartingPlayer(undefined)).toBe('o');
    for (let i = 0; i < 20; i++) {
      expect(['o', 'x']).toContain(resolveStartingPlayer('random'));
    }
  });
});
