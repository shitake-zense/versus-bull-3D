// ループBGMの再生制御。public/bgm のループ音源を <audio loop> で鳴らす。
// enabled が true の間だけ再生。開始/停止はゆるやかにフェードして唐突さを消す。
// 自動再生ポリシー対策: 再生はユーザー操作（トグル押下）後に呼ばれる前提で play() を試み、
// ブロックされても握りつぶす。

import { useEffect, useRef } from 'react';

const FADE_MS = 1200;
const TARGET_VOLUME = 0.32;

export function useBgm(enabled: boolean, src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      // GitHub Pages の base(/versus-bull-3D/) を前置しないと 404 になる。
      const a = new Audio(import.meta.env.BASE_URL + src);
      a.loop = true;
      // デフォルトOFF。使わないユーザーに音源(数MB)を先読みさせない。
      a.preload = 'none';
      a.volume = 0;
      audioRef.current = a;
    }
    const a = audioRef.current;

    const clearFade = () => {
      if (fadeRef.current !== null) {
        window.clearInterval(fadeRef.current);
        fadeRef.current = null;
      }
    };

    // from→to へ FADE_MS かけて音量を補間。終了時 onDone を呼ぶ。
    const fadeTo = (to: number, onDone?: () => void) => {
      clearFade();
      const from = a.volume;
      const start = performance.now();
      fadeRef.current = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - start) / FADE_MS);
        a.volume = from + (to - from) * k;
        if (k >= 1) {
          clearFade();
          onDone?.();
        }
      }, 50);
    };

    if (enabled) {
      void a.play().then(() => fadeTo(TARGET_VOLUME)).catch(() => {
        /* 自動再生ブロック等は無視（次のユーザー操作で再試行される） */
      });
    } else {
      fadeTo(0, () => a.pause());
    }

    return clearFade;
  }, [enabled, src]);

  // アンマウント時に確実に停止。
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);
}
