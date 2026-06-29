// 着席（シート）ユーティリティ。1vs1=2席 / 2vs2チーム戦=4席。
// チーム戦でも盤の記号・勝敗はチーム（Player='o'|'x'）単位なので、ここで席⇄チームを橋渡しする。
// 手番は O₁→X₁→O₂→X₂（席の巡回）で、結果としてチームは毎手 o↔x で交互になる。

import type { Player, Seat } from '../types';

/** 席が属するチーム（盤の記号）。 */
export const seatTeam = (seat: Seat): Player => (seat === 'o' || seat === 'o2' ? 'o' : 'x');

/** その対戦で使う席の巡回順。 */
export const seatCycle = (teamMode: boolean | undefined): Seat[] =>
  teamMode ? ['o', 'x', 'o2', 'x2'] : ['o', 'x'];

/** 次に指す席。 */
export function nextSeat(seat: Seat, teamMode: boolean | undefined): Seat {
  const cycle = seatCycle(teamMode);
  return cycle[(cycle.indexOf(seat) + 1) % cycle.length];
}

/** ひとつ前に指した席（待った＝巻き戻し用）。 */
export function prevSeat(seat: Seat, teamMode: boolean | undefined): Seat {
  const cycle = seatCycle(teamMode);
  return cycle[(cycle.indexOf(seat) - 1 + cycle.length) % cycle.length];
}

/** 先攻チームの最初の席（= チーム1の席。o→'o' / x→'x'）。 */
export const startingSeat = (startingTeam: Player): Seat => startingTeam;

/** その対戦で埋まっている必要がある席（開始条件・在席判定用）。 */
export const requiredSeats = (teamMode: boolean | undefined): Seat[] => seatCycle(teamMode);

/** 表示用の席サフィックス（チーム内の何人目か）。 */
export const seatSuffix: Record<Seat, string> = { o: '①', x: '①', o2: '②', x2: '②' };
