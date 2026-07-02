// 対局開始前の3秒カウントダウン演出（3→2→1→onDone）フック。
// App.tsx から機械的に切り出したもの（ロジックは不変）。

import { useCallback, useRef, useState } from 'react';

export interface UseCountdownResult {
  /** 表示中の残り秒（null=非表示）。 */
  countdown: number | null;
  /** カウントダウン開始。0 到達で onDone を1回だけ呼ぶ。 */
  runCountdown: (onDone?: () => void) => void;
  /** 進行中のカウントダウンを止めて非表示に戻す（メニュー離脱・画面遷移用）。 */
  cancel: () => void;
}

/**
 * @param playCount 各秒の効果音。引数はラスト1秒か（ピッチを上げる）。
 */
export function useCountdown(playCount: (last?: boolean) => void): UseCountdownResult {
  const [countdown, setCountdown] = useState<number | null>(null);
  const cdTimer = useRef<number | undefined>(undefined);

  const runCountdown = useCallback(
    (onDone?: () => void) => {
      window.clearInterval(cdTimer.current);
      let n = 3;
      setCountdown(3);
      playCount(false);
      cdTimer.current = window.setInterval(() => {
        n -= 1;
        if (n <= 0) {
          window.clearInterval(cdTimer.current);
          setCountdown(null);
          onDone?.();
        } else {
          setCountdown(n);
          playCount(n === 1);
        }
      }, 1000);
    },
    [playCount],
  );

  const cancel = useCallback(() => {
    window.clearInterval(cdTimer.current);
    setCountdown(null);
  }, []);

  return { countdown, runCountdown, cancel };
}
