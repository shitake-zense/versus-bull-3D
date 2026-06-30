// ローカル対戦 / AI対戦の権威状態。盤面・ターン・持ち時間・スコアを一括管理する。
// （オンラインは useFirebaseRoom が状態源になるため、このフックは使わない。）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, GameMode, Player, TimeControl, Winner, WinLine, Board } from '../types';
import {
  INITIAL_PIECES,
  FIRST_PLAYER,
  applyMove,
  checkWinAt,
  createEmptyBoard,
  oppositeOf,
} from '../lib/gameLogic';
import { DEFAULT_TIME_CONTROL, isUnlimited } from '../lib/timeControl';
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
  /** 持ち時間設定 */
  timeControl?: TimeControl;
  onPlace?: () => void;
  onWin?: (winner: Winner) => void;
}

function freshState(running: boolean, tc: TimeControl): LocalState {
  return {
    board: createEmptyBoard(),
    currentTurn: FIRST_PLAYER,
    piecesLeft: { o: INITIAL_PIECES, x: INITIAL_PIECES },
    winner: null,
    winLine: null,
    remaining: { o: tc.baseMs, x: tc.baseMs },
    turnStartedAt: running ? Date.now() : 0,
  };
}

export function useGameLogic({
  mode,
  aiPlayer = 'x',
  aiLevel = 'hard',
  timeControl = DEFAULT_TIME_CONTROL,
  onPlace,
  onWin,
}: UseGameLogicOptions) {
  const [s, setS] = useState<LocalState>(() => freshState(false, timeControl));
  const tcRef = useRef(timeControl);
  tcRef.current = timeControl;
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState<Record<Player, number>>({ o: 0, x: 0 });
  // 待った（手戻し）用: 各着手の「直前」の状態スナップショットを積む。
  const [history, setHistory] = useState<LocalState[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;

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
      const tc = tcRef.current;
      const moverRemaining = isUnlimited(tc)
        ? prev.remaining[player]
        : prev.remaining[player] - elapsed + tc.incrementMs;

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

      setHistory((h) => [...h, prev]); // 着手前の状態を保存（待った用）
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

  /**
   * 待った（手戻し）。ローカルは直前1手、AIは「自分（人間）の手番」まで巻き戻す
   * （AIの手＋自分の手の2手）。巻き戻し先の残り時間を復元し、手番を再開する。
   */
  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (hist.length === 0) return;
    let idx = hist.length - 1;
    if (mode === 'ai') {
      idx = -1;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].currentTurn === humanPlayer) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = 0;
    }
    const target = hist[idx];
    setHistory(hist.slice(0, idx));
    setS({ ...target, winner: null, winLine: null, turnStartedAt: Date.now() });
    setRunning(true);
  }, [mode, humanPlayer]);

  const canUndo = useMemo(() => {
    if (!running || s.winner) return false;
    if (mode === 'ai') {
      return s.currentTurn === humanPlayer && history.some((h) => h.currentTurn === humanPlayer);
    }
    return history.length >= 1;
  }, [running, s.winner, s.currentTurn, mode, humanPlayer, history]);

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
    setS(freshState(false, tcRef.current));
    setRunning(false);
    setHistory([]);
  }, []);

  /**
   * O/X の勝数を入れ替える。手番ランダムの再戦で人間とCPU（または席）が
   * 入れ替わったとき、勝数を「symbol ではなくユーザー」に追従させるために使う。
   */
  const swapScore = useCallback(() => {
    setScore((sc) => ({ o: sc.x, x: sc.o }));
  }, []);

  /** スコアも含めて完全初期化（モード選択に戻る時など） */
  const reset = useCallback(() => {
    setS(freshState(false, tcRef.current));
    setRunning(false);
    setScore({ o: 0, x: 0 });
    setHistory([]);
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
    canUndo,
    start,
    place,
    undo,
    handleTimeout,
    newRound,
    swapScore,
    reset,
  };
}
