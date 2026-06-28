// 持ち時間プリセットと表示ヘルパー。ローカル/AI/オンライン共通で参照する。

import type { Player, TimeControl, TurnPref } from '../types';

export const DEFAULT_TIME_CONTROL: TimeControl = { baseMs: 300_000, incrementMs: 15_000 };
export const UNLIMITED: TimeControl = { baseMs: 0, incrementMs: 0 };

/** baseMs<=0 は無制限（タイマー非表示・タイムアウトしない）。 */
export const isUnlimited = (tc: TimeControl): boolean => tc.baseMs <= 0;

/** 初期持ち時間プリセット（無制限は別枠で扱う）。 */
export const BASE_PRESETS: { label: string; ms: number }[] = [
  { label: '1分', ms: 60_000 },
  { label: '3分', ms: 180_000 },
  { label: '5分', ms: 300_000 },
  { label: '10分', ms: 600_000 },
];

/** フィッシャー加算プリセット。 */
export const INCREMENT_PRESETS: { label: string; ms: number }[] = [
  { label: '+0秒', ms: 0 },
  { label: '+5秒', ms: 5_000 },
  { label: '+15秒', ms: 15_000 },
  { label: '+30秒', ms: 30_000 },
];

/** 設定の正規化（Firebase から読んだ undefined / 異常値をデフォルトへ寄せる）。 */
export function normalizeTimeControl(tc: TimeControl | null | undefined): TimeControl {
  if (!tc || typeof tc.baseMs !== 'number') return DEFAULT_TIME_CONTROL;
  if (tc.baseMs <= 0) return UNLIMITED;
  return { baseMs: tc.baseMs, incrementMs: Math.max(0, tc.incrementMs ?? 0) };
}

/** 「5分＋15秒」「無制限」のような表示文字列。 */
export function formatTimeControl(tc: TimeControl): string {
  if (isUnlimited(tc)) return '無制限';
  const min = tc.baseMs / 60_000;
  const baseLabel = Number.isInteger(min) ? `${min}分` : `${Math.round(tc.baseMs / 1000)}秒`;
  const inc = tc.incrementMs > 0 ? `＋${tc.incrementMs / 1000}秒` : '';
  return `${baseLabel}${inc}`;
}

/** turnPref を実際の先手（o/x）へ解決する。'random' は乱択。 */
export function resolveStartingPlayer(pref: TurnPref | undefined): Player {
  if (pref === 'random') return Math.random() < 0.5 ? 'o' : 'x';
  return pref ?? 'o';
}
