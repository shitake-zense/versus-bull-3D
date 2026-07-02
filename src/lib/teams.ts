// チーム（コンセプト）定義。O=ORIGIN / X=XENOGENESIS。
// ピース形状・色は O/X のまま、表示上の呼称をチーム名で統一する。

import type { AiLevel, Player } from '../types';

export const TEAM: Record<Player, { name: string; tag: string; reading: string }> = {
  o: { name: 'ORIGIN', tag: 'O', reading: 'オリジン' },
  x: { name: 'XENOGENESIS', tag: 'X', reading: 'ゼノジェネシス' },
};

/** AI 難易度の表示ラベル（UI / CPU名の表記に共用）。 */
export const AI_LEVEL_LABEL: Record<AiLevel, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'つよい',
  max: '最強',
};
