// チーム（コンセプト）定義。O=ORIGIN / X=XENOGENESIS。
// ピース形状・色は O/X のまま、表示上の呼称をチーム名で統一する。

import type { Player } from '../types';

export const TEAM: Record<Player, { name: string; tag: string; reading: string }> = {
  o: { name: 'ORIGIN', tag: 'O', reading: 'オリジン' },
  x: { name: 'XENOGENESIS', tag: 'X', reading: 'ゼノジェネシス' },
};

export const teamName = (p: Player): string => TEAM[p].name;
export const teamTag = (p: Player): string => TEAM[p].tag;
