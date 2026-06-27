// Web Audio API による効果音生成（アセット不要）。
// 着地音「コン」: 500Hzサイン波 30ms。勝利音: 軽い上昇アルペジオ。

import { useCallback, useRef } from 'react';

export function useSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ctx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AC();
    }
    // ユーザー操作前は suspended のことがある。
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const blip = useCallback(
    (freq: number, durMs: number, type: OscillatorType = 'sine', gain = 0.18) => {
      try {
        const ac = ctx();
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(gain, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durMs / 1000);
        osc.connect(g).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + durMs / 1000);
      } catch {
        /* オーディオ未許可などは無視 */
      }
    },
    [ctx],
  );

  /** ピース着地音 */
  const playPlace = useCallback(() => blip(500, 30, 'sine', 0.2), [blip]);

  /** 勝利ファンファーレ */
  const playWin = useCallback(() => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      setTimeout(() => blip(f, 160, 'triangle', 0.16), i * 90);
    });
  }, [blip]);

  /** カウントダウンのビープ */
  const playCount = useCallback((final = false) => blip(final ? 880 : 440, 120, 'square', 0.12), [blip]);

  return { playPlace, playWin, playCount };
}
