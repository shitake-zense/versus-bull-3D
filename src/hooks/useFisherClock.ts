// フィッシャークロックの表示計算。
// 「手番が始まった時刻(turnStartedAt)」を基準に、ローカルでelapsedを引いて表示する。
// オンラインでは serverOffset でクライアント時計のズレを補正する（local は 0）。

import { useEffect, useRef, useState } from 'react';
import type { Player } from '../types';

export interface FisherClockParams {
  /** タイマーを進めるか（playing 中のみ true） */
  running: boolean;
  /** 現在の手番 */
  activePlayer: Player;
  /** 各プレイヤーの「手番開始時点での残り時間(ms)」スナップショット */
  baseRemaining: Record<Player, number>;
  /** 現在の手番が始まった時刻(ms, epoch)。serverOffset 適用前の基準。 */
  turnStartedAt: number;
  /** Date.now() に加えるとサーバー時刻になる補正(ms)。local は 0。 */
  serverOffset?: number;
  /** 手番側の残り時間が 0 に到達したときに一度だけ呼ばれる */
  onTimeout?: (player: Player) => void;
}

export function useFisherClock({
  running,
  activePlayer,
  baseRemaining,
  turnStartedAt,
  serverOffset = 0,
  onTimeout,
}: FisherClockParams): Record<Player, number> {
  const [display, setDisplay] = useState<Record<Player, number>>(baseRemaining);
  const firedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  // 手番が変わったらタイムアウト発火フラグをリセット。
  useEffect(() => {
    firedRef.current = false;
  }, [activePlayer, turnStartedAt]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now() + serverOffset;
      const elapsed = Math.max(0, now - turnStartedAt);
      const next: Record<Player, number> = {
        o: baseRemaining.o,
        x: baseRemaining.x,
      };
      if (running) {
        next[activePlayer] = baseRemaining[activePlayer] - elapsed;
        if (next[activePlayer] <= 0 && !firedRef.current) {
          firedRef.current = true;
          next[activePlayer] = 0;
          onTimeoutRef.current?.(activePlayer);
        }
      }
      setDisplay(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, activePlayer, baseRemaining, turnStartedAt, serverOffset]);

  return display;
}
