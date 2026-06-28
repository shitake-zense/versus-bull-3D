// 画面遷移と各モードの統合。menu ↔ game を切り替え、ローカル/AI と オンライン の状態源を束ねる。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel, GameMode, Player, Winner } from './types';
import { START_TIME_MS, recordToBoard, scanWin } from './lib/gameLogic';
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

  const [roomId, setRoomId] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [isGuest, setIsGuest] = useState(false);

  const [pendingView, setPendingView] = useState<CameraView | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [offlineCountingDown, setOfflineCountingDown] = useState(false);

  const offline = useGameLogic({ mode: mode ?? 'local', aiPlayer, aiLevel });
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
    if (intent === 'create') void fb.createRoom();
    else void fb.joinRoom();
    setIntent(null);
  }, [isOnline, roomId, intent, fb]);

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

  const baseRemaining = isOnline
    ? {
        o: room?.players.o?.timeRemaining ?? START_TIME_MS,
        x: room?.players.x?.timeRemaining ?? START_TIME_MS,
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

  // ---- 効果音＋直前着手の検知（盤面のピース増加で検知＝ローカル/リモート/AI 共通） ----
  const totalPieces = board.reduce((a, c) => a + c.length, 0);
  const prevTotal = useRef(0);
  const prevBoard = useRef<typeof board>(board);
  const [lastMove, setLastMove] = useState<{ cell: number; layer: number } | null>(null);
  useEffect(() => {
    const prev = prevBoard.current;
    if (totalPieces > prevTotal.current) {
      playPlace();
      // 増えたマスを直前の着手として強調する。
      for (let c = 0; c < board.length; c++) {
        if (board[c].length > (prev[c]?.length ?? 0)) {
          setLastMove({ cell: c, layer: board[c].length - 1 });
          break;
        }
      }
    } else if (totalPieces < prevTotal.current) {
      // 新規対局・再戦などで盤面がリセットされたらマーカーを消す。
      setLastMove(null);
    }
    prevTotal.current = totalPieces;
    prevBoard.current = board;
  }, [totalPieces, board, playPlace]);

  useEffect(() => {
    if (winner === 'o' || winner === 'x') playWin();
  }, [winner, playWin]);

  // ---- オンラインのセッションスコア（offline.score はオフライン専用） ----
  const [onlineScore, setOnlineScore] = useState<Record<Player, number>>({ o: 0, x: 0 });
  const lastWinnerRef = useRef<Winner>(null);
  useEffect(() => {
    if (!isOnline) {
      lastWinnerRef.current = null;
      return;
    }
    if (winner && winner !== lastWinnerRef.current) {
      if (winner === 'o' || winner === 'timeout_x') {
        setOnlineScore((s) => ({ ...s, o: s.o + 1 }));
      } else if (winner === 'x' || winner === 'timeout_o') {
        setOnlineScore((s) => ({ ...s, x: s.x + 1 }));
      }
    }
    lastWinnerRef.current = winner;
  }, [isOnline, winner]);

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

  const beginAI = useCallback(
    (humanSide: Player, level: AiLevel) => {
      setAiPlayer(humanSide === 'o' ? 'x' : 'o');
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

  const createRoom = useCallback(() => {
    const id = generateRoomId();
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
    if (isOnline) fb.requestRematch();
    else startOfflineRound();
  }, [isOnline, fb, startOfflineRound]);

  const place = useCallback(
    (cell: number) => {
      if (isOnline) fb.place(cell);
      else offline.place(cell);
    },
    [isOnline, fb, offline],
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

  const names = useMemo(() => {
    if (isOnline) {
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
  }, [isOnline, room?.players, mode, playerName, aiLevel, offline.humanPlayer, offline.aiPlayer]);

  const canPlace = isOnline ? running && fb.myRole === activePlayer : offline.canHumanPlace;

  const disconnected = Boolean(
    isOnline &&
      room?.players.o &&
      room?.players.x &&
      ((fb.myRole === 'o' && room.players.x?.connected === false) ||
        (fb.myRole === 'x' && room.players.o?.connected === false)),
  );

  const rematchPending = Boolean(
    isOnline && winner && fb.myRole && room?.rematch?.[fb.myRole],
  );

  const waiting: WaitingState | null =
    isOnline && roomId
      ? { roomId, shareUrl, room, myRole: fb.myRole, error: fb.error, isGuest }
      : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg-void">
      <Scene3D
        board={board}
        winLine={winLine}
        canPlace={canPlace}
        currentTurn={activePlayer}
        lastMove={lastMove}
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
          currentTurn={activePlayer}
          piecesLeft={piecesLeft}
          score={isOnline ? onlineScore : offline.score}
          winner={winner}
          myRole={myRole}
          countdown={countdown}
          disconnected={disconnected}
          onSelectView={setPendingView}
          onRematch={handleRematch}
          onExit={exitToMenu}
          rematchPending={rematchPending}
        />
      )}

      {showLobby && (
        <RoomLobby
          playerName={playerName}
          setPlayerName={setPlayerName}
          onChangeName={handleChangeName}
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
