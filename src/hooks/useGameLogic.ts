// ローカル対戦 / AI対戦の権威状態。盤面・ターン・持ち時間・スコアを一括管理する。
// （オンラインは useFirebaseRoom が状態源になるため、このフックは使わない。）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, GameMode, Player, TimeControl, Trap, Winner, WinLine, Board } from '../types';
import {
  INITIAL_PIECES,
  MAX_STACK,
  FIRST_PLAYER,
  applyBlock,
  applyMove,
  checkWinAt,
  createEmptyBoard,
  oppositeOf,
  pickTraps,
  triggeredTrap,
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
  /** 落下ブロックの予告位置。対局中は不変。 */
  traps: Trap[];
}

export interface UseGameLogicOptions {
  mode: GameMode; // 'local' | 'ai' | 'watch'（'online' では使用しない）
  /** AIモードでAIが操作する側 */
  aiPlayer?: Player;
  /** AIの強さ（'ai' モードの aiPlayer 側） */
  aiLevel?: AiLevel;
  /** AI観戦（'watch'）での O 側の強さ */
  watchLevelO?: AiLevel;
  /** AI観戦（'watch'）での X 側の強さ */
  watchLevelX?: AiLevel;
  /** 持ち時間設定 */
  timeControl?: TimeControl;
  /** 落下ブロック（トラップ）の個数。対局開始時にランダム配置。 */
  trapCount?: number;
  onPlace?: () => void;
  onWin?: (winner: Winner) => void;
}

function freshState(running: boolean, tc: TimeControl, trapCount: number): LocalState {
  return {
    board: createEmptyBoard(),
    currentTurn: FIRST_PLAYER,
    piecesLeft: { o: INITIAL_PIECES, x: INITIAL_PIECES },
    winner: null,
    winLine: null,
    remaining: { o: tc.baseMs, x: tc.baseMs },
    turnStartedAt: running ? Date.now() : 0,
    traps: pickTraps(trapCount),
  };
}

export function useGameLogic({
  mode,
  aiPlayer = 'x',
  aiLevel = 'hard',
  watchLevelO = 'hard',
  watchLevelX = 'hard',
  timeControl = DEFAULT_TIME_CONTROL,
  trapCount = 0,
  onPlace,
  onWin,
}: UseGameLogicOptions) {
  const [s, setS] = useState<LocalState>(() => freshState(false, timeControl, trapCount));
  const tcRef = useRef(timeControl);
  tcRef.current = timeControl;
  const tcCountRef = useRef(trapCount);
  tcCountRef.current = trapCount;
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

  // AIが操作する側とその強さ。'ai'=片側のみ / 'watch'=両側 / それ以外=なし。
  const aiSides = useMemo<Partial<Record<Player, AiLevel>>>(() => {
    if (mode === 'ai') return { [aiPlayer]: aiLevel };
    if (mode === 'watch') return { o: watchLevelO, x: watchLevelX };
    return {};
  }, [mode, aiPlayer, aiLevel, watchLevelO, watchLevelX]);
  const aiSidesRef = useRef(aiSides);
  aiSidesRef.current = aiSides;

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
      if (prev.board[cell].length >= MAX_STACK) return; // 満杯マスには置けない

      const now = Date.now();
      const elapsed = now - prev.turnStartedAt;
      const tc = tcRef.current;
      const moverRemaining = isUnlimited(tc)
        ? prev.remaining[player]
        : prev.remaining[player] - elapsed + tc.incrementMs;

      let board = applyMove(prev.board, cell, player);
      const win = checkWinAt(board, cell, player);
      // 勝利手でなければ、この着手で発動するトラップの中立ブロックを落とす。
      if (!win && triggeredTrap(board, cell, prev.traps)) board = applyBlock(board, cell);
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
        traps: prev.traps,
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
    if (mode === 'watch') return false; // 観戦は手戻し不可
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
    setS(freshState(false, tcRef.current, tcCountRef.current));
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
    setS(freshState(false, tcRef.current, tcCountRef.current));
    setRunning(false);
    setScore({ o: 0, x: 0 });
    setHistory([]);
  }, []);

  // AI の自動着手: AIが操作する手番になったら 500〜900ms 後に最善手を置く。
  // 'watch'（AI vs AI）では両手番が AI なので、対局終了まで交互に自動進行する。
  useEffect(() => {
    if (!running || s.winner) return;
    if (!aiSides[s.currentTurn]) return;
    const delay = 500 + Math.random() * 400;
    const t = setTimeout(() => {
      const cur = sRef.current;
      const level = aiSidesRef.current[cur.currentTurn];
      if (cur.winner || !level) return;
      const move = getBestMove(cur.board, cur.piecesLeft, cur.currentTurn, level, cur.traps);
      if (move !== null) place(move);
    }, delay);
    return () => clearTimeout(t);
  }, [running, s.currentTurn, s.winner, s.turnStartedAt, aiSides, place]);

  const canHumanPlace = useMemo(
    // 'watch'（AI vs AI）は観戦のみ＝人間は着手できない。
    () =>
      running &&
      !s.winner &&
      (mode === 'local' || (mode === 'ai' && s.currentTurn === humanPlayer)),
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
