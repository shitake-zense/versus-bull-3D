// 画面遷移と各モードの統合。menu ↔ game を切り替え、ローカル/AI と オンライン の状態源を束ねる。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, BoardShapeId, GameMode, Player, Seat, TimeControl, TurnPref } from './types';
import {
  isCellFull,
  applyMove,
  checkWinAt,
  initialPieces,
  isActiveCell,
  oppositeOf,
  recordToBoard,
  scanWin,
  setBoardShape,
} from './lib/gameLogic';
import { requiredSeats } from './lib/seats';
import { DEFAULT_TIME_CONTROL, isUnlimited, normalizeTimeControl } from './lib/timeControl';
import { generateRoomId } from './lib/roomId';
import { AI_LEVEL_LABEL, TEAM } from './lib/teams';
import { useGameLogic } from './hooks/useGameLogic';
import { useFirebaseRoom } from './hooks/useFirebaseRoom';
import { useFisherClock } from './hooks/useFisherClock';
import { useMoveHistory } from './hooks/useMoveHistory';
import { useReplay } from './hooks/useReplay';
import { useSound } from './hooks/useSound';
import { useBgm } from './hooks/useBgm';
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
  // AI観戦（AI vs AI）の両陣営の強さ。
  const [watchLevelO, setWatchLevelO] = useState<AiLevel>('hard');
  const [watchLevelX, setWatchLevelX] = useState<AiLevel>('hard');
  // AI対戦の手番希望（'o'|'x'|'random'）。再戦時の random 再抽選に使う。
  const [aiTurnPref, setAiTurnPref] = useState<TurnPref>('o');
  const [timeControl, setTimeControl] = useState<TimeControl>(DEFAULT_TIME_CONTROL);
  // 落下ブロック（トラップ）の個数。ローカル/AI/オンライン作成時の共通設定。
  const [trapCount, setTrapCount] = useState(0);
  // 盤の形状（ローカル/AI/オンライン作成時の共通設定）。
  const [boardShape, setBoardShapeState] = useState<BoardShapeId>('square');

  const [roomId, setRoomId] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [pendingTeamMode, setPendingTeamMode] = useState(false); // オンライン作成時の 2vs2 チーム戦フラグ

  const [pendingView, setPendingView] = useState<CameraView | null>(null);
  const [showThreats, setShowThreats] = useState(false);
  // 直前着手のカメラ自動追従。デフォルトOFF。設定は localStorage に保存。
  const [followCam, setFollowCam] = useState(() => {
    try {
      return localStorage.getItem('vsb3.followCam') === 'on';
    } catch {
      return false;
    }
  });
  const toggleFollowCam = useCallback(() => {
    setFollowCam((v) => {
      const next = !v;
      try {
        localStorage.setItem('vsb3.followCam', next ? 'on' : 'off');
      } catch {
        /* localStorage 不可環境は保存しないだけ */
      }
      return next;
    });
  }, []);
  // BGM（ループ音源）。デフォルトOFF。設定は localStorage に保存。
  const [bgmOn, setBgmOn] = useState(() => {
    try {
      return localStorage.getItem('vsb3.bgm') === 'on';
    } catch {
      return false;
    }
  });
  useBgm(bgmOn, 'bgm/ambient.wav');
  const toggleBgm = useCallback(() => {
    setBgmOn((v) => {
      const next = !v;
      try {
        localStorage.setItem('vsb3.bgm', next ? 'on' : 'off');
      } catch {
        /* localStorage 不可環境は保存しないだけ */
      }
      return next;
    });
  }, []);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [offlineCountingDown, setOfflineCountingDown] = useState(false);

  const offline = useGameLogic({
    mode: mode ?? 'local',
    aiPlayer,
    aiLevel,
    watchLevelO,
    watchLevelX,
    timeControl,
    trapCount,
  });
  const fb = useFirebaseRoom(mode === 'online' ? roomId : null, playerName);

  const isOnline = mode === 'online';
  const room = fb.room;

  // 有効な盤形状（オンラインはルーム値、ローカル/AI/観戦は App 状態）。
  // pure ロジック（recordToBoard・scanWin・threat 走査・AI）はモジュール状態 GEO を参照するため、
  // 盤面を導出する前にこのレンダーで確定させる。同一形状なら no-op。
  const activeShape: BoardShapeId = isOnline ? room?.boardShape ?? 'square' : boardShape;
  setBoardShape(activeShape);
  const piecesPerPlayer = initialPieces(activeShape);

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
    if (intent === 'create') void fb.createRoom(timeControl, 'o', pendingTeamMode, trapCount, boardShape);
    else void fb.joinRoom();
    setIntent(null);
  }, [isOnline, roomId, intent, fb, timeControl, pendingTeamMode, trapCount, boardShape]);

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
    ? room?.piecesLeft ?? { o: piecesPerPlayer, x: piecesPerPlayer }
    : offline.state.piecesLeft;

  // 落下ブロックの予告（トラップ）。オンラインはルーム値、ローカル/AI は offline 状態。
  const traps = useMemo(
    () => (isOnline ? room?.traps ?? [] : offline.state.traps),
    [isOnline, room?.traps, offline.state.traps],
  );

  // リーチ警告: 相手が「次に1手で4連を作れる」マス（＝今ブロックすべき脅威）。
  const threats = useMemo(() => {
    if (!running) return [];
    const opp = oppositeOf(activePlayer);
    if (piecesLeft[opp] <= 0) return [];
    const res: { cell: number; layer: number }[] = [];
    for (let c = 0; c < board.length; c++) {
      if (!isActiveCell(c)) continue; // 穴（プレイ不可）は脅威にならない
      if (isCellFull(board, c)) continue; // 満杯マスは着地不可＝脅威にならない
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
  // 盤面リセット時にリプレイ状態を消すが、リプレイフックは棋譜を必要とするため後で定義される。
  // 宣言順の都合で ref 経由でそのリセット関数を呼ぶ。
  const replayResetRef = useRef<() => void>(() => {});
  const { lastMove, moveHistory } = useMoveHistory(board, playPlace, () => replayResetRef.current());

  useEffect(() => {
    if (winner === 'o' || winner === 'x') playWin();
  }, [winner, playWin]);

  // ---- リプレイ（終局後の棋譜再現）。表示用の盤面・直前手・勝ちラインと操作一式を得る ----
  const replay = useReplay({ moveHistory, board, traps, lastMove, winLine });
  replayResetRef.current = replay.exit; // 盤面リセット時のリセットに使う
  const {
    isReplaying,
    replayIndex,
    replayPlaying,
    viewBoard,
    viewLastMove,
    viewWinLine,
    enter: enterReplay,
    exit: exitReplay,
    seek: replaySeek,
    step: replayStep,
    playToggle: replayPlayToggle,
  } = replay;
  const viewThreats = isReplaying ? [] : showThreats ? threats : [];

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
    // 盤形状(GEO)をイベントハンドラ内で確定させてから盤面を作り直す。
    // setBoardShape はレンダー時(下記)にも呼ぶが、形状選択の再レンダーがまだ
    // フラッシュされていないタイミングで newRound が走ると、GEO が旧形状のまま
    // 盤面が作られ、activeCells と board 長が食い違って Board3D がクラッシュ
    // （真っ暗）する。ここで明示設定してレンダー順に依存しないようにする。
    setBoardShape(boardShape);
    offline.newRound();
    setOfflineCountingDown(true);
    runCountdown(() => {
      setOfflineCountingDown(false);
      offline.start();
    });
  }, [offline, runCountdown, boardShape]);

  const beginLocal = useCallback(() => {
    setMode('local');
    setRoomId(null);
    // newRound を同じ更新バッチで実行し、盤面を現在の形状(GEO)に合わせて作り直す。
    // rAF で遅らせると mode='local' の初回描画が旧盤面(4×4)のまま走り、特殊形状で
    // activeCells が board 長を超えて Board3D がクラッシュ（真っ暗）する。
    startOfflineRound();
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
      startOfflineRound();
    },
    [startOfflineRound],
  );

  // AI観戦（AI vs AI）を開始。両陣営の強さを指定してカウントダウン→自動進行。
  const beginWatch = useCallback(
    (levelO: AiLevel, levelX: AiLevel) => {
      setWatchLevelO(levelO);
      setWatchLevelX(levelX);
      setMode('watch');
      setRoomId(null);
      startOfflineRound();
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
    if (mode === 'watch') {
      return {
        o: `${TEAM.o.name}（CPU・${AI_LEVEL_LABEL[watchLevelO]}）`,
        x: `${TEAM.x.name}（CPU・${AI_LEVEL_LABEL[watchLevelX]}）`,
      };
    }
    return { o: TEAM.o.name, x: TEAM.x.name };
  }, [isOnline, teamMode, room?.players, mode, playerName, aiLevel, watchLevelO, watchLevelX, offline.humanPlayer, offline.aiPlayer]);

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
        traps={traps}
        winLine={viewWinLine}
        canPlace={canPlace && !isReplaying}
        currentTurn={activePlayer}
        lastMove={viewLastMove}
        threats={viewThreats}
        pendingView={pendingView}
        onViewConsumed={() => setPendingView(null)}
        followCam={followCam}
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
          totalPieces={piecesPerPlayer}
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
          followCam={followCam}
          onToggleFollowCam={toggleFollowCam}
          bgmOn={bgmOn}
          onToggleBgm={toggleBgm}
          onSelectView={setPendingView}
          onRematch={handleRematch}
          onExit={exitToMenu}
          rematchPending={rematchPending}
          onReturnToLobby={isOnline && fb.myRole === 'o' ? fb.returnToLobby : null}
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
          trapCount={trapCount}
          setTrapCount={setTrapCount}
          boardShape={boardShape}
          setBoardShape={setBoardShapeState}
          onChangeSettings={fb.updateSettings}
          onLocal={beginLocal}
          onAI={beginAI}
          onWatch={beginWatch}
          onCreateRoom={createRoom}
          waiting={waiting}
          onStartGame={fb.startGame}
          onLeave={exitToMenu}
          bgmOn={bgmOn}
          onToggleBgm={toggleBgm}
        />
      )}
    </div>
  );
}
