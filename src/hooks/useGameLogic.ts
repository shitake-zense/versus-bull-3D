// ローカル対戦 / AI対戦の権威状態。盤面・ターン・持ち時間・スコアを一括管理する。
// （オンラインは useFirebaseRoom が状態源になるため、このフックは使わない。）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, GameMode, Player, Winner, WinLine, Board } from '../types';
import {
  INCREMENT_MS,
  INITIAL_PIECES,
  START_TIME_MS,
  FIRST_PLAYER,
  applyMove,
  checkWinAt,
  createEmptyBoard,
  oppositeOf,
} from '../lib/gameLogic';
import { getBestMove } from '../lib/ai';

interface LocalState {
  board: Board;
  currentTurn: Player;
  piecesLeft: Record<Player, number>;
  winner: Winner;
  winLine: WinLine | null;
  /** 各プレイヤーの手番開始時点の残り時間(ms) */
  remaining: Record<Player, number>;
  turnStartedAt: number;
}

export interface UseGameLogicOptions {
  mode: GameMode; // 'local' | 'ai'（'online' では使用しない）
  /** AIモードでAIが操作する側 */
  aiPlayer?: Player;
  /** AIの強さ */
  aiLevel?: AiLevel;
  onPlace?: () => void;
  onWin?: (winner: Winner) => void;
}

function freshState(running: boolean): LocalState {
  return {
    board: createEmptyBoard(),
    currentTurn: FIRST_PLAYER,
    piecesLeft: { o: INITIAL_PIECES, x: INITIAL_PIECES },
    winner: null,
    winLine: null,
    remaining: { o: START_TIME_MS, x: START_TIME_MS },
    turnStartedAt: running ? Date.now() : 0,
  };
}

export function useGameLogic({ mode, aiPlayer = 'x', aiLevel = 'hard', onPlace, onWin }: UseGameLogicOptions) {
  const [s, setS] = useState<LocalState>(() => freshState(false));
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState<Record<Player, number>>({ o: 0, x: 0 });

  const sRef = useRef(s);
  sRef.current = s;
  const cbRef = useRef({ onPlace, onWin });
  cbRef.current = { onPlace, onWin };

  const humanPlayer: Player = mode === 'ai' ? oppositeOf(aiPlayer) : FIRST_PLAYER;

  /** カウントダウン後に呼んでゲーム開始（タイマー始動） */
  const start = useCallback(() => {
    setS((prev) => ({ ...prev, turnStartedAt: Date.now() }));
    setRunning(true);
  }, []);

  const finish = useCallback((winner: Winner) => {
    setRunning(false);
    cbRef.current.onWin?.(winner);
    if (winner === 'o' || winner === 'x') {
      setScore((sc) => ({ ...sc, [winner]: sc[winner] + 1 }));
    } else if (winner === 'timeout_o') {
      setScore((sc) => ({ ...sc, x: sc.x + 1 }));
    } else if (winner === 'timeout_x') {
      setScore((sc) => ({ ...sc, o: sc.o + 1 }));
    }
  }, []);

  const place = useCallback(
    (cell: number) => {
      const prev = sRef.current;
      if (prev.winner || !running) return;
      const player = prev.currentTurn;
      if (prev.piecesLeft[player] <= 0) return;

      const now = Date.now();
      const elapsed = now - prev.turnStartedAt;
      const moverRemaining = prev.remaining[player] - elapsed + INCREMENT_MS;

      const board = applyMove(prev.board, cell, player);
      const win = checkWinAt(board, cell, player);
      const piecesLeft = { ...prev.piecesLeft, [player]: prev.piecesLeft[player] - 1 };

      let winner: Winner = null;
      let winLine: WinLine | null = null;
      if (win) {
        winner = player;
        winLine = win;
      } else if (piecesLeft.o <= 0 && piecesLeft.x <= 0) {
        winner = 'draw';
      }

      setS({
        board,
        piecesLeft,
        winner,
        winLine,
        currentTurn: winner ? player : oppositeOf(player),
        remaining: { ...prev.remaining, [player]: moverRemaining },
        turnStartedAt: now,
      });
      cbRef.current.onPlace?.();
      if (winner) finish(winner);
    },
    [running, finish],
  );

  const handleTimeout = useCallback(
    (player: Player) => {
      const prev = sRef.current;
      if (prev.winner) return;
      const winner: Winner = player === 'o' ? 'timeout_o' : 'timeout_x';
      setS({ ...prev, winner });
      finish(winner);
    },
    [finish],
  );

  /** スコア維持で次の対局を準備（running=false のままカウントダウンを挟む） */
  const newRound = useCallback(() => {
    setS(freshState(false));
    setRunning(false);
  }, []);

  /** スコアも含めて完全初期化（モード選択に戻る時など） */
  const reset = useCallback(() => {
    setS(freshState(false));
    setRunning(false);
    setScore({ o: 0, x: 0 });
  }, []);

  // AI の自動着手: AIの手番になったら 500〜900ms 後に最善手を置く。
  useEffect(() => {
    if (mode !== 'ai' || !running || s.winner) return;
    if (s.currentTurn !== aiPlayer) return;
    const delay = 500 + Math.random() * 400;
    const t = setTimeout(() => {
      const cur = sRef.current;
      if (cur.winner || cur.currentTurn !== aiPlayer) return;
      const move = getBestMove(cur.board, cur.piecesLeft, aiPlayer, aiLevel);
      if (move !== null) place(move);
    }, delay);
    return () => clearTimeout(t);
  }, [mode, running, s.currentTurn, s.winner, s.turnStartedAt, aiPlayer, aiLevel, place]);

  const canHumanPlace = useMemo(
    () => running && !s.winner && (mode === 'local' || s.currentTurn === humanPlayer),
    [running, s.winner, s.currentTurn, mode, humanPlayer],
  );

  return {
    state: s,
    running,
    score,
    humanPlayer,
    aiPlayer,
    canHumanPlace,
    start,
    place,
    handleTimeout,
    newRound,
    reset,
  };
}
