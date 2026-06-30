// 画面遷移と各モードの統合。menu ↔ game を切り替え、ローカル/AI と オンライン の状態源を束ねる。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, GameMode, Move, Player, Seat, TimeControl, TurnPref } from './types';
import {
  applyMove,
  boardFromMoves,
  checkWinAt,
  oppositeOf,
  recordToBoard,
  scanWin,
} from './lib/gameLogic';
import { requiredSeats } from './lib/seats';
import { DEFAULT_TIME_CONTROL, isUnlimited, normalizeTimeControl } from './lib/timeControl';
import { generateRoomId } from './lib/roomId';
import { AI_LEVEL_LABEL, TEAM } from './lib/teams';
import { useGameLogic } from './hooks/useGameLogic';
import { useFirebaseRoom } from './hooks/useFirebaseRoom';
import { useFisherClock } from './hooks/useFisherClock';
import { useSound } from './hooks/useSound';
import { Scene3D } from './components/Scene3D';
import { HUD } from './components/HUD';
import { RoomLobby, type WaitingState } from './components/RoomLobby';
import { type CameraView } from './components/CameraController';

type Intent = 'create' | 'join' | null;

export default function App() {
  const { playPlace, playWin, playCount } = useSound();

  const [mode, setMode] = useState<GameMode | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [aiPlayer, setAiPlayer] = useState<Player>('x');
  const [aiLevel, setAiLevel] = useState<AiLevel>('normal');
  // AI対戦の手番希望（'o'|'x'|'random'）。再戦時の random 再抽選に使う。
  const [aiTurnPref, setAiTurnPref] = useState<TurnPref>('o');
  const [timeControl, setTimeControl] = useState<TimeControl>(DEFAULT_TIME_CONTROL);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [pendingTeamMode, setPendingTeamMode] = useState(false); // オンライン作成時の 2vs2 チーム戦フラグ

  const [pendingView, setPendingView] = useState<CameraView | null>(null);
  const [showThreats, setShowThreats] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [offlineCountingDown, setOfflineCountingDown] = useState(false);

  // リプレイ: replayIndex=null は通常表示。数値なら棋譜を先頭から replayIndex 手だけ再現する。
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const offline = useGameLogic({ mode: mode ?? 'local', aiPlayer, aiLevel, timeControl });
  const fb = useFirebaseRoom(mode === 'online' ? roomId : null, playerName);

  const isOnline = mode === 'online';
  const room = fb.room;

  // ---- URL から初期ルームを取得（招待リンク） ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r) {
      setRoomId(r);
      setMode('online');
      setIsGuest(true);
      setIntent('join');
    }
  }, []);

  // ---- create / join の実行 ----
  useEffect(() => {
    if (!isOnline || !roomId || !intent) return;
    if (intent === 'create') void fb.createRoom(timeControl, 'o', pendingTeamMode);
    else void fb.joinRoom();
    setIntent(null);
  }, [isOnline, roomId, intent, fb, timeControl, pendingTeamMode]);

  // ---- 派生状態（モード非依存ビュー） ----
  const status = isOnline
    ? room?.status ?? 'waiting'
    : offline.state.winner
      ? 'finished'
      : offline.running
        ? 'playing'
        : offlineCountingDown
          ? 'countdown'
          : 'waiting';

  const winner = isOnline ? room?.winner ?? null : offline.state.winner;
  const activePlayer: Player = isOnline ? room?.currentTurn ?? 'o' : offline.state.currentTurn;
  const running = status === 'playing' && !winner;

  const board = useMemo(
    () => (isOnline ? recordToBoard(room?.board ?? null) : offline.state.board),
    [isOnline, room?.board, offline.state.board],
  );

  const winLine = useMemo(() => {
    if (isOnline) {
      if (winner === 'o' || winner === 'x') return scanWin(board);
      return null;
    }
    return offline.state.winLine;
  }, [isOnline, winner, board, offline.state.winLine]);

  const piecesLeft = isOnline
    ? room?.piecesLeft ?? { o: 32, x: 32 }
    : offline.state.piecesLeft;

  // リーチ警告: 相手が「次に1手で4連を作れる」マス（＝今ブロックすべき脅威）。
  const threats = useMemo(() => {
    if (!running) return [];
    const opp = oppositeOf(activePlayer);
    if (piecesLeft[opp] <= 0) return [];
    const res: { cell: number; layer: number }[] = [];
    for (let c = 0; c < board.length; c++) {
      const next = applyMove(board, c, opp);
      if (checkWinAt(next, c, opp)) res.push({ cell: c, layer: board[c].length });
    }
    return res;
  }, [running, board, activePlayer, piecesLeft]);

  // 有効な持ち時間設定（オンラインはルーム値、ローカル/AI は App 状態）。
  const activeTimeControl = useMemo(
    () => (isOnline ? normalizeTimeControl(room?.timeControl) : timeControl),
    [isOnline, room?.timeControl, timeControl],
  );
  const timed = !isUnlimited(activeTimeControl);

  const baseRemaining = isOnline
    ? {
        o: room?.players.o?.timeRemaining ?? activeTimeControl.baseMs,
        x: room?.players.x?.timeRemaining ?? activeTimeControl.baseMs,
      }
    : offline.state.remaining;

  const turnStartedAt = isOnline ? room?.turnStartedAt ?? 0 : offline.state.turnStartedAt;
  const serverOffset = isOnline ? fb.serverOffset : 0;

  const onTimeout = useCallback(
    (p: Player) => {
      if (isOnline) fb.reportTimeout(p);
      else offline.handleTimeout(p);
    },
    [isOnline, fb, offline],
  );

  const displayRemaining = useFisherClock({
    running,
    timed,
    activePlayer,
    baseRemaining,
    turnStartedAt,
    serverOffset,
    onTimeout,
  });

  // ---- カウントダウン演出 ----
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

  // オンライン: status が countdown の間だけ表示用カウントダウン（開始は host が確定）
  useEffect(() => {
    if (isOnline && status === 'countdown') {
      runCountdown();
      return () => window.clearInterval(cdTimer.current);
    }
  }, [isOnline, status, runCountdown]);

  // ---- 効果音＋直前着手の検知＋棋譜蓄積（盤面のピース増加で検知＝ローカル/リモート/AI 共通） ----
  const totalPieces = board.reduce((a, c) => a + c.length, 0);
  const prevTotal = useRef(0);
  const prevBoard = useRef<typeof board>(board);
  const [lastMove, setLastMove] = useState<{ cell: number; layer: number } | null>(null);
  const [moveHistory, setMoveHistory] = useState<Move[]>([]);
  useEffect(() => {
    const prev = prevBoard.current;
    if (totalPieces > prevTotal.current) {
      playPlace();
      // 増えたピースを着手順（下→上）に拾い、直前手の強調と棋譜へ反映する。
      const added: Move[] = [];
      for (let c = 0; c < board.length; c++) {
        const prevLen = prev[c]?.length ?? 0;
        for (let l = prevLen; l < board[c].length; l++) added.push({ cell: c, player: board[c][l] });
      }
      if (added.length > 0) {
        const last = added[added.length - 1];
        setLastMove({ cell: last.cell, layer: board[last.cell].length - 1 });
        setMoveHistory((h) => [...h, ...added]);
      }
    } else if (totalPieces < prevTotal.current) {
      setLastMove(null);
      if (totalPieces === 0) {
        // 新規対局・再戦などで盤面がリセットされたら棋譜・リプレイを消す。
        setMoveHistory([]);
        setReplayIndex(null);
        setReplayPlaying(false);
      } else {
        // 待った（手戻し）: 棋譜は残った手数まで切り詰める（プレフィックスなので安全）。
        setMoveHistory((h) => h.slice(0, totalPieces));
      }
    }
    prevTotal.current = totalPieces;
    prevBoard.current = board;
  }, [totalPieces, board, playPlace]);

  useEffect(() => {
    if (winner === 'o' || winner === 'x') playWin();
  }, [winner, playWin]);

  // ---- リプレイの表示用ビュー（replayIndex が立っている間は棋譜から盤面を再現） ----
  const isReplaying = replayIndex !== null;
  const viewBoard = useMemo(
    () => (replayIndex !== null ? boardFromMoves(moveHistory, replayIndex) : board),
    [replayIndex, moveHistory, board],
  );
  const viewLastMove = useMemo(() => {
    if (replayIndex === null) return lastMove;
    if (replayIndex <= 0) return null;
    const m = moveHistory[replayIndex - 1];
    return { cell: m.cell, layer: viewBoard[m.cell].length - 1 };
  }, [replayIndex, moveHistory, viewBoard, lastMove]);
  // 勝利ラインは最終局面でのみ表示（途中局面ではまだ揃っていない）。
  const viewWinLine = isReplaying && replayIndex < moveHistory.length ? null : winLine;
  const viewThreats = isReplaying ? [] : showThreats ? threats : [];

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

  const enterReplay = useCallback(() => {
    setReplayIndex(moveHistory.length); // 最終局面から開始
    setReplayPlaying(false);
  }, [moveHistory.length]);
  const exitReplay = useCallback(() => {
    setReplayIndex(null);
    setReplayPlaying(false);
  }, []);
  const replaySeek = useCallback(
    (i: number) => {
      setReplayPlaying(false);
      setReplayIndex(Math.max(0, Math.min(moveHistory.length, i)));
    },
    [moveHistory.length],
  );
  const replayStep = useCallback(
    (delta: number) => {
      setReplayPlaying(false);
      setReplayIndex((i) =>
        i === null ? i : Math.max(0, Math.min(moveHistory.length, i + delta)),
      );
    },
    [moveHistory.length],
  );
  const replayPlayToggle = useCallback(() => {
    if (replayPlaying) {
      setReplayPlaying(false);
      return;
    }
    // 末尾で再生を押したら先頭から再生し直す。
    if (replayIndex !== null && replayIndex >= moveHistory.length) setReplayIndex(0);
    setReplayPlaying(true);
  }, [replayPlaying, replayIndex, moveHistory.length]);

  // ---- オンラインのセッションスコア（room で一元管理＝両クライアントで一致） ----
  // 旧: 各クライアントが winner からローカル集計 → 再接続/観測漏れでホストとゲストがズレた。
  // 新: useFirebaseRoom が勝利確定時に room.score を権威的に+1し、ここは購読するだけ。
  const onlineScore = useMemo<Record<Player, number>>(
    () => ({ o: room?.score?.o ?? 0, x: room?.score?.x ?? 0 }),
    [room?.score?.o, room?.score?.x],
  );

  // ---- キーボード（カメラ 1/2/3） & ダブルクリックでデフォルト視点 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') setPendingView(1);
      else if (e.key === '2') setPendingView(2);
      else if (e.key === '3') setPendingView(3);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- アクション ----
  const startOfflineRound = useCallback(() => {
    offline.newRound();
    setOfflineCountingDown(true);
    runCountdown(() => {
      setOfflineCountingDown(false);
      offline.start();
    });
  }, [offline, runCountdown]);

  const beginLocal = useCallback(() => {
    setMode('local');
    setRoomId(null);
    requestAnimationFrame(startOfflineRound);
  }, [startOfflineRound]);

  // 手番希望を実プレイヤー（人間側）へ解決。random は毎回抽選。
  const resolveHumanSide = (pref: TurnPref): Player =>
    pref === 'random' ? (Math.random() < 0.5 ? 'o' : 'x') : pref;

  const beginAI = useCallback(
    (pref: TurnPref, level: AiLevel) => {
      const humanSide = resolveHumanSide(pref);
      setAiPlayer(humanSide === 'o' ? 'x' : 'o');
      setAiTurnPref(pref);
      setAiLevel(level);
      setMode('ai');
      setRoomId(null);
      requestAnimationFrame(startOfflineRound);
    },
    [startOfflineRound],
  );

  const shareUrl = useMemo(() => {
    if (!roomId) return '';
    const { origin, pathname } = window.location;
    return `${origin}${pathname}?room=${roomId}`;
  }, [roomId]);

  const createRoom = useCallback((team = false) => {
    const id = generateRoomId();
    setPendingTeamMode(team);
    setRoomId(id);
    setMode('online');
    setIsGuest(false);
    setIntent('create');
    const url = `${window.location.origin}${window.location.pathname}?room=${id}`;
    window.history.replaceState(null, '', url);
    void navigator.clipboard?.writeText(url).catch(() => {});
  }, []);

  const exitToMenu = useCallback(() => {
    window.clearInterval(cdTimer.current);
    setCountdown(null);
    setOfflineCountingDown(false);
    setMode(null);
    setRoomId(null);
    setIntent(null);
    setIsGuest(false);
    offline.reset();
    window.history.replaceState(null, '', window.location.pathname);
  }, [offline]);

  const handleRematch = useCallback(() => {
    if (isOnline) {
      fb.requestRematch();
      return;
    }
    // AI対戦で手番ランダムなら、再戦のたびに先攻/後攻を抽選し直す。
    if (mode === 'ai' && aiTurnPref === 'random') {
      const humanSide = resolveHumanSide('random');
      const nextAi: Player = humanSide === 'o' ? 'x' : 'o';
      // 手番が実際に入れ替わるときは勝数も入れ替えて、スコアを symbol ではなく
      // ユーザー（人間/CPU）に追従させる。
      if (nextAi !== aiPlayer) {
        setAiPlayer(nextAi);
        offline.swapScore();
      }
    }
    startOfflineRound();
  }, [isOnline, fb, startOfflineRound, mode, aiTurnPref, aiPlayer, offline]);

  const place = useCallback(
    (cell: number) => {
      if (isOnline) fb.place(cell);
      else offline.place(cell);
    },
    [isOnline, fb, offline],
  );

  // ---- 待った（手戻し）----
  const undoRequest = isOnline ? room?.undo ?? null : null;
  // 待った可否: ローカル/AI は即時、オンラインは「自分の直前手がある（＝今は相手番）」かつ申請が無いとき。
  // チーム戦(2vs2)は巻き戻し席の特定が複雑なため当面オフ。
  const canTakeBack = isOnline
    ? Boolean(
        running &&
          !room?.teamMode &&
          fb.myRole &&
          room?.lastMove?.player === fb.myRole &&
          room?.currentTurn !== fb.myRole &&
          !undoRequest,
      )
    : offline.canUndo;

  const takeBack = useCallback(() => {
    if (isOnline) fb.requestUndo();
    else offline.undo();
  }, [isOnline, fb, offline]);

  const respondUndo = useCallback(
    (accept: boolean) => {
      if (isOnline) fb.respondUndo(accept);
    },
    [isOnline, fb],
  );

  // ロビーでの名前変更（オンラインは自分のスロットへ即時反映）。
  const handleChangeName = useCallback(
    (name: string) => {
      setPlayerName(name);
      if (isOnline) fb.updateName(name);
    },
    [isOnline, fb],
  );

  // ---- 表示判定 ----
  const showLobby = mode === null || (isOnline && (!room || room.status === 'waiting'));

  const myRole: Player | null = isOnline ? fb.myRole : mode === 'ai' ? offline.humanPlayer : null;
  const teamMode = isOnline && Boolean(room?.teamMode);
  // 今この手を指す席（チーム戦のどちらが指すか）。旧ルーム/1vs1 は currentTurn と同じ。
  const activeSeat: Seat = isOnline ? room?.currentSeat ?? activePlayer : activePlayer;

  // 席→表示名（チーム戦のメンバー名・「あなた」判定に使う）。
  const seatName = useCallback(
    (seat: Seat): string => room?.players[seat]?.name || seat.toUpperCase(),
    [room?.players],
  );

  const names = useMemo(() => {
    if (isOnline) {
      // チーム戦はタイマー等の見出しをチーム名にする（メンバーは roster で別途表示）。
      if (teamMode) return { o: TEAM.o.name, x: TEAM.x.name };
      return {
        o: room?.players.o?.name || TEAM.o.name,
        x: room?.players.x?.name || TEAM.x.name,
      };
    }
    if (mode === 'ai') {
      const ai = offline.aiPlayer;
      const human = offline.humanPlayer;
      const youName = playerName || TEAM[human].name;
      const cpuName = `${TEAM[ai].name}（CPU・${AI_LEVEL_LABEL[aiLevel]}）`;
      return human === 'o' ? { o: youName, x: cpuName } : { o: cpuName, x: youName };
    }
    return { o: TEAM.o.name, x: TEAM.x.name };
  }, [isOnline, teamMode, room?.players, mode, playerName, aiLevel, offline.humanPlayer, offline.aiPlayer]);

  // チーム戦のメンバー名簿（手番ハイライト用）。
  const roster = useMemo(
    () =>
      teamMode
        ? { o: [seatName('o'), seatName('o2')], x: [seatName('x'), seatName('x2')] }
        : null,
    [teamMode, seatName],
  );

  // 手番の人の表示名と、それが自分か。
  const activeName = isOnline
    ? teamMode
      ? seatName(activeSeat)
      : room?.players[activePlayer]?.name || TEAM[activePlayer].name
    : names[activePlayer];
  const activeIsMe = isOnline
    ? teamMode
      ? fb.mySeat === activeSeat
      : fb.myRole === activePlayer
    : mode === 'ai' && offline.humanPlayer === activePlayer;

  const canPlace = isOnline ? running && fb.mySeat === activeSeat : offline.canHumanPlace;

  // 自分以外の必要席のいずれかが切断していれば「切断」表示（チーム戦も対応）。
  const disconnected = Boolean(
    isOnline &&
      requiredSeats(room?.teamMode).every((s) => room?.players[s]) &&
      requiredSeats(room?.teamMode).some(
        (s) => s !== fb.mySeat && room?.players[s]?.connected === false,
      ),
  );

  const rematchPending = Boolean(
    isOnline && winner && fb.myRole && room?.rematch?.[fb.myRole],
  );

  const waiting: WaitingState | null =
    isOnline && roomId
      ? { roomId, shareUrl, room, myRole: fb.myRole, mySeat: fb.mySeat, error: fb.error, isGuest }
      : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg-void">
      <Scene3D
        board={viewBoard}
        winLine={viewWinLine}
        canPlace={canPlace && !isReplaying}
        currentTurn={activePlayer}
        lastMove={viewLastMove}
        threats={viewThreats}
        pendingView={pendingView}
        onViewConsumed={() => setPendingView(null)}
        onCellClick={place}
      />

      {!showLobby && (
        <HUD
          mode={mode ?? 'local'}
          status={status}
          names={names}
          displayRemaining={displayRemaining}
          timed={timed}
          currentTurn={activePlayer}
          piecesLeft={piecesLeft}
          score={isOnline ? onlineScore : offline.score}
          winner={winner}
          myRole={myRole}
          teamMode={teamMode}
          roster={roster}
          activeName={activeName}
          activeIsMe={activeIsMe}
          activeSeat={activeSeat}
          countdown={countdown}
          disconnected={disconnected}
          showThreats={showThreats}
          onToggleThreats={() => setShowThreats((v) => !v)}
          onSelectView={setPendingView}
          onRematch={handleRematch}
          onExit={exitToMenu}
          rematchPending={rematchPending}
          canTakeBack={canTakeBack}
          onTakeBack={takeBack}
          undoRequest={undoRequest}
          onRespondUndo={respondUndo}
          reviewing={isReplaying}
          replayIndex={replayIndex ?? 0}
          replayTotal={moveHistory.length}
          replayPlaying={replayPlaying}
          onReviewEnter={enterReplay}
          onReviewExit={exitReplay}
          onReplaySeek={replaySeek}
          onReplayStep={replayStep}
          onReplayPlayToggle={replayPlayToggle}
        />
      )}

      {showLobby && (
        <RoomLobby
          playerName={playerName}
          setPlayerName={setPlayerName}
          onChangeName={handleChangeName}
          timeControl={timeControl}
          setTimeControl={setTimeControl}
          onChangeSettings={fb.updateSettings}
          onLocal={beginLocal}
          onAI={beginAI}
          onCreateRoom={createRoom}
          waiting={waiting}
          onStartGame={fb.startGame}
          onLeave={exitToMenu}
        />
      )}
    </div>
  );
}
