// 盤面のピース増減から「直前着手」と「棋譜」を蓄積するフック。
// App.tsx から機械的に切り出したもの（ロジックは不変）。ローカル/リモート/AI 共通で、
// 盤面差分だけを見るので状態源に依存しない。

import { useEffect, useRef, useState } from 'react';
import type { Board, Move, Player } from '../types';
import { isBlock } from '../lib/gameLogic';

export interface MoveHistoryResult {
  /** 直前に増えた駒の位置（強調表示用）。盤面が縮んだら null。 */
  lastMove: { cell: number; layer: number } | null;
  /** 蓄積した棋譜（プレイヤー駒のみ。中立ブロックは含まない）。 */
  moveHistory: Move[];
}

/**
 * @param board 現在の統合盤面。
 * @param playPlace 駒が増えたときに鳴らす効果音。
 * @param onBoardCleared 盤面が空にリセットされたとき（新規対局・再戦）に呼ばれる。
 *   App はこれでリプレイ状態を消す。
 *
 * 既知の限界（D8・容認済み）: オンラインでリロード/途中参加すると盤面が prevTotal=0 から
 * 一括到着し、増えた駒を「セル番号順」で拾うため棋譜が実際の着手順にならない。その結果その
 * クライアントのリプレイ表示（と縮小時の切り詰め整合）は崩れる。勝敗・盤面には影響しない。
 * RoomData.moves のスキーマ拡張はしない方針なので、ここは仕様として容認する。
 */
export function useMoveHistory(
  board: Board,
  playPlace: () => void,
  onBoardCleared: () => void,
): MoveHistoryResult {
  // 全ピース数（中立ブロック含む）＝増減の検知用。プレイヤー駒のみの数＝棋譜整合用。
  const totalPieces = board.reduce((a, c) => a + c.length, 0);
  const playerPieces = board.reduce((a, c) => a + c.reduce((n, p) => n + (isBlock(p) ? 0 : 1), 0), 0);
  const prevTotal = useRef(0);
  const prevBoard = useRef<Board>(board);
  const [lastMove, setLastMove] = useState<{ cell: number; layer: number } | null>(null);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  // onBoardCleared は毎レンダー変わりうるので ref 経由で参照し、effect の依存にしない
  // （盤面差分の検知条件を変えないため）。
  const clearedRef = useRef(onBoardCleared);
  clearedRef.current = onBoardCleared;

  useEffect(() => {
    const prev = prevBoard.current;
    if (totalPieces > prevTotal.current) {
      playPlace();
      // 増えたピースを着手順（下→上）に拾い、直前手の強調と棋譜へ反映する。
      // 中立ブロック（落下ブロック）は着手ではないので棋譜には入れない。
      const added: { cell: number; player: Player; layer: number }[] = [];
      for (let c = 0; c < board.length; c++) {
        const prevLen = prev[c]?.length ?? 0;
        for (let l = prevLen; l < board[c].length; l++) {
          const p = board[c][l];
          if (!isBlock(p)) added.push({ cell: c, player: p, layer: l });
        }
      }
      if (added.length > 0) {
        const last = added[added.length - 1];
        setLastMove({ cell: last.cell, layer: last.layer });
        setMoveHistory((h) => [...h, ...added.map((a) => ({ cell: a.cell, player: a.player }))]);
      }
    } else if (totalPieces < prevTotal.current) {
      setLastMove(null);
      if (totalPieces === 0) {
        // 新規対局・再戦などで盤面がリセットされたら棋譜・リプレイを消す。
        setMoveHistory([]);
        clearedRef.current();
      } else {
        // 待った（手戻し）: 棋譜はプレイヤー駒の残り手数まで切り詰める（プレフィックスなので安全）。
        setMoveHistory((h) => h.slice(0, playerPieces));
      }
    }
    prevTotal.current = totalPieces;
    prevBoard.current = board;
  }, [totalPieces, playerPieces, board, playPlace]);

  return { lastMove, moveHistory };
}
