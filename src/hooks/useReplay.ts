// 終局後のリプレイ（棋譜の1手ずつ再現・自動再生）フック。
// App.tsx から機械的に切り出したもの（ロジックは不変）。replayIndex/replayPlaying を
// 内部で持ち、表示用の盤面・直前手・勝ちラインと操作一式を返す。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Board, Move, Trap, WinLine } from '../types';
import { boardFromMoves } from '../lib/gameLogic';

interface UseReplayArgs {
  moveHistory: Move[];
  /** 通常表示（リプレイ外）の盤面。 */
  board: Board;
  traps: readonly Trap[];
  /** 通常表示（リプレイ外）の直前着手。 */
  lastMove: { cell: number; layer: number } | null;
  /** 通常表示（リプレイ外）の勝ちライン。 */
  winLine: WinLine | null;
}

export interface UseReplayResult {
  isReplaying: boolean;
  replayIndex: number | null;
  replayPlaying: boolean;
  /** 表示用盤面（リプレイ中は棋譜から再現）。 */
  viewBoard: Board;
  /** 表示用の直前手。 */
  viewLastMove: { cell: number; layer: number } | null;
  /** 表示用の勝ちライン（途中局面では非表示）。 */
  viewWinLine: WinLine | null;
  /** リプレイ開始（最終局面から）。 */
  enter: () => void;
  /** リプレイ終了（通常表示へ戻す）。盤面リセット時のリセットにも使う。 */
  exit: () => void;
  seek: (i: number) => void;
  step: (delta: number) => void;
  playToggle: () => void;
}

export function useReplay({ moveHistory, board, traps, lastMove, winLine }: UseReplayArgs): UseReplayResult {
  // replayIndex=null は通常表示。数値なら棋譜を先頭から replayIndex 手だけ再現する。
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const isReplaying = replayIndex !== null;
  const viewBoard = useMemo(
    () => (replayIndex !== null ? boardFromMoves(moveHistory, replayIndex, traps) : board),
    [replayIndex, moveHistory, board, traps],
  );
  const viewLastMove = useMemo(() => {
    if (replayIndex === null) return lastMove;
    if (replayIndex <= 0) return null;
    const m = moveHistory[replayIndex - 1];
    return { cell: m.cell, layer: viewBoard[m.cell].length - 1 };
  }, [replayIndex, moveHistory, viewBoard, lastMove]);
  // 勝利ラインは最終局面でのみ表示（途中局面ではまだ揃っていない）。
  const viewWinLine = isReplaying && replayIndex < moveHistory.length ? null : winLine;

  // リプレイ自動再生: 700ms ごとに1手進め、末尾で停止。
  useEffect(() => {
    if (!replayPlaying || replayIndex === null) return;
    if (replayIndex >= moveHistory.length) {
      setReplayPlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      setReplayIndex((i) => (i === null ? i : Math.min(moveHistory.length, i + 1)));
    }, 700);
    return () => window.clearTimeout(t);
  }, [replayPlaying, replayIndex, moveHistory.length]);

  const enter = useCallback(() => {
    setReplayIndex(moveHistory.length); // 最終局面から開始
    setReplayPlaying(false);
  }, [moveHistory.length]);
  const exit = useCallback(() => {
    setReplayIndex(null);
    setReplayPlaying(false);
  }, []);
  const seek = useCallback(
    (i: number) => {
      setReplayPlaying(false);
      setReplayIndex(Math.max(0, Math.min(moveHistory.length, i)));
    },
    [moveHistory.length],
  );
  const step = useCallback(
    (delta: number) => {
      setReplayPlaying(false);
      setReplayIndex((i) =>
        i === null ? i : Math.max(0, Math.min(moveHistory.length, i + delta)),
      );
    },
    [moveHistory.length],
  );
  const playToggle = useCallback(() => {
    if (replayPlaying) {
      setReplayPlaying(false);
      return;
    }
    // 末尾で再生を押したら先頭から再生し直す。
    if (replayIndex !== null && replayIndex >= moveHistory.length) setReplayIndex(0);
    setReplayPlaying(true);
  }, [replayPlaying, replayIndex, moveHistory.length]);

  return {
    isReplaying,
    replayIndex,
    replayPlaying,
    viewBoard,
    viewLastMove,
    viewWinLine,
    enter,
    exit,
    seek,
    step,
    playToggle,
  };
}
