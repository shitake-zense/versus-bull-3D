// オンライン対戦の状態源。Firebase Realtime Database を購読し、着手・タイマー・再戦を同期する。
// 設計メモ:
//  - クライアント時計のズレは /.info/serverTimeOffset で補正する。
//  - 持ち時間は turnStartedAt(サーバー時刻) 起点でローカル計算し、着手時に確定値を書き込む。
//  - winner/timeout はトランザクションで「先勝ち・上書き防止」にする。
//  - countdown→playing への遷移と turnStartedAt の確定は o(作成者) 側だけが行う（書き込み競合回避）。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ref,
  onValue,
  onDisconnect,
  update,
  set,
  runTransaction,
  serverTimestamp,
  get,
} from 'firebase/database';
import { getDb } from '../lib/firebase';
import {
  INITIAL_PIECES,
  FIRST_PLAYER,
  applyMove,
  checkWinAt,
  recordToBoard,
} from '../lib/gameLogic';
import { oppositeOf } from '../lib/gameLogic';
import {
  DEFAULT_TIME_CONTROL,
  isUnlimited,
  normalizeTimeControl,
  resolveStartingPlayer,
} from '../lib/timeControl';
import type { Player, RoomData, TimeControl, TurnPref, Winner } from '../types';

const COUNTDOWN_MS = 3000;

function makeUid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function initialRoom(): RoomData {
  return {
    status: 'waiting',
    players: { o: null, x: null },
    board: null,
    currentTurn: FIRST_PLAYER,
    turnStartedAt: 0,
    piecesLeft: { o: INITIAL_PIECES, x: INITIAL_PIECES },
    winner: null,
    createdAt: Date.now(),
    timeControl: DEFAULT_TIME_CONTROL,
    turnPref: 'o',
  };
}

export interface UseFirebaseRoomResult {
  room: RoomData | null;
  myRole: Player | null;
  serverOffset: number;
  error: string | null;
  /** 新規ルームを作成して o として参加 */
  createRoom: (timeControl?: TimeControl, turnPref?: TurnPref) => Promise<void>;
  /** 既存ルームに参加（空きスロットを取得） */
  joinRoom: () => Promise<void>;
  /** ロビーから対戦開始（ホストのみ） */
  startGame: () => void;
  /** ルーム設定（持ち時間・先手）を更新（ホストのみ・待機中） */
  updateSettings: (timeControl: TimeControl, turnPref: TurnPref) => void;
  /** 自分のスロットの表示名を更新（ロビーで参加側も変更可能） */
  updateName: (name: string) => void;
  place: (cell: number) => void;
  reportTimeout: (player: Player) => void;
  requestRematch: () => void;
}

export function useFirebaseRoom(
  roomId: string | null,
  playerName: string,
): UseFirebaseRoomResult {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [myRole, setMyRole] = useState<Player | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uidRef = useRef<string>(makeUid());
  const roomRef = useRef(room);
  roomRef.current = room;
  const offsetRef = useRef(0);
  offsetRef.current = serverOffset;
  const myRoleRef = useRef(myRole);
  myRoleRef.current = myRole;

  const dbRoom = useCallback(() => ref(getDb(), `rooms/${roomId}`), [roomId]);

  // ルームごとに uid を sessionStorage で永続化。
  // sessionStorage はリロードでは残り（=同タブのリロード/再接続で同じスロットを取り戻せる）、
  // タブ/端末ごとに独立（=同一ブラウザの別タブや別端末は別プレイヤーになる）。
  useEffect(() => {
    if (!roomId) return;
    const key = `vsb3_uid_${roomId}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) uidRef.current = stored;
      else sessionStorage.setItem(key, uidRef.current);
    } catch {
      /* sessionStorage 不可（プライベートモード等）なら都度生成の uid を使う */
    }
  }, [roomId]);

  // サーバー時刻オフセット購読
  useEffect(() => {
    if (!roomId) return;
    const offRef = ref(getDb(), '.info/serverTimeOffset');
    return onValue(offRef, (snap) => setServerOffset(snap.val() ?? 0));
  }, [roomId]);

  // ルーム購読
  useEffect(() => {
    if (!roomId) return;
    const r = dbRoom();
    const unsub = onValue(r, (snap) => {
      const data = snap.val() as RoomData | null;
      setRoom(data);
    });
    return () => unsub();
  }, [roomId, dbRoom]);

  // 自分のスロット(uid)から myRole を確定する。
  useEffect(() => {
    if (!roomId || !room) return;
    let role: Player | null = null;
    (['o', 'x'] as Player[]).forEach((p) => {
      if (room.players[p]?.uid === uidRef.current) role = p;
    });
    if (role && role !== myRoleRef.current) setMyRole(role);
  }, [roomId, room]);

  // プレゼンス管理: .info/connected を監視し、接続が確立するたびに
  // connected=true を書き、onDisconnect(connected=false) を再設定する。
  // これによりモバイル等で一時的に切断→再接続しても「切断」表示が残らない。
  useEffect(() => {
    if (!roomId || !myRole) return;
    const connectedRef = ref(getDb(), '.info/connected');
    const slotConnRef = ref(getDb(), `rooms/${roomId}/players/${myRole}/connected`);
    const unsub = onValue(connectedRef, (snap) => {
      if (snap.val() !== true) return; // 切断中。再接続時に再びここへ来る。
      // 切断時に connected=false（スロット自体は残し再接続/再戦を可能に）。
      void onDisconnect(slotConnRef).set(false);
      void set(slotConnRef, true);
    });
    return () => unsub();
  }, [roomId, myRole]);

  const createRoom = useCallback(
    async (timeControl: TimeControl = DEFAULT_TIME_CONTROL, turnPref: TurnPref = 'o') => {
      if (!roomId) return;
      setError(null);
      const tc = normalizeTimeControl(timeControl);
      const base = initialRoom();
      base.timeControl = tc;
      base.turnPref = turnPref;
      base.players.o = {
        name: playerName || 'O',
        connected: true,
        timeRemaining: tc.baseMs,
        uid: uidRef.current,
      };
      try {
        await set(dbRoom(), base);
      } catch (e) {
        setError(roomWriteError(e));
      }
    },
    [roomId, playerName, dbRoom],
  );

  const joinRoom = useCallback(async () => {
    if (!roomId) return;
    setError(null);
    try {
      const snap = await get(dbRoom());
      if (!snap.exists()) {
        // 未作成のルームへのアクセス → 自分が作成者になる。
        await createRoom();
        return;
      }
      const result = await runTransaction(dbRoom(), (data: RoomData | null) => {
        if (!data) return data;
        const players = data.players || { o: null, x: null };
        // 既に自分のスロットがある（リロード等）なら何もしない。
        if (players.o?.uid === uidRef.current || players.x?.uid === uidRef.current) {
          return data;
        }
        const slot: Player | null = !players.o ? 'o' : !players.x ? 'x' : null;
        if (!slot) return; // 満員 → abort
        players[slot] = {
          name: playerName || (slot === 'o' ? 'O' : 'X'),
          connected: true,
          timeRemaining: normalizeTimeControl(data.timeControl).baseMs,
          uid: uidRef.current,
        };
        data.players = players;
        // 2人揃っても自動開始せず 'waiting'(ロビー) のまま。ホストの開始操作を待つ。
        return data;
      });
      if (!result.committed) {
        setError('このルームは満員です。');
      }
    } catch (e) {
      setError(roomWriteError(e));
    }
  }, [roomId, playerName, dbRoom, createRoom]);

  // o(作成者)が countdown→playing を確定。turnStartedAt はサーバー時刻で書く。
  useEffect(() => {
    if (!roomId || !room || myRole !== 'o') return;
    if (room.status !== 'countdown') return;
    const t = setTimeout(() => {
      const cur = roomRef.current;
      if (!cur || cur.status !== 'countdown') return;
      const tc = normalizeTimeControl(cur.timeControl);
      void update(dbRoom(), {
        status: 'playing',
        turnStartedAt: serverTimestamp(),
        currentTurn: resolveStartingPlayer(cur.turnPref),
        // 開始時に両者の持ち時間を確定（ロビーで設定変更されていても整合させる）。
        'players/o/timeRemaining': tc.baseMs,
        'players/x/timeRemaining': tc.baseMs,
      });
    }, COUNTDOWN_MS);
    return () => clearTimeout(t);
  }, [roomId, room, myRole, dbRoom]);

  // ロビーから対戦開始（ホストが押す）。countdown にすると上の effect が playing へ遷移。
  const startGame = useCallback(() => {
    const cur = roomRef.current;
    if (!roomId || !cur) return;
    if (!cur.players.o || !cur.players.x) return; // 2人揃うまで開始不可
    if (cur.status !== 'waiting') return;
    void update(dbRoom(), { status: 'countdown' });
  }, [roomId, dbRoom]);

  // ルーム設定（持ち時間・先手）を更新。ホストのみ・待機中だけ許可。
  const updateSettings = useCallback(
    (timeControl: TimeControl, turnPref: TurnPref) => {
      const cur = roomRef.current;
      if (!roomId || !cur) return;
      if (myRoleRef.current !== 'o' || cur.status !== 'waiting') return;
      const tc = normalizeTimeControl(timeControl);
      const updates: Record<string, unknown> = {
        timeControl: tc,
        turnPref,
      };
      // 待機中の両者の表示用持ち時間も即時反映。
      if (cur.players.o) updates['players/o/timeRemaining'] = tc.baseMs;
      if (cur.players.x) updates['players/x/timeRemaining'] = tc.baseMs;
      void update(dbRoom(), updates);
    },
    [roomId, dbRoom],
  );

  // 自分のスロットの表示名を更新（ロビー待機中に参加側/ホスト双方が変更可能）。
  const updateName = useCallback(
    (name: string) => {
      const role = myRoleRef.current;
      if (!roomId || !role) return;
      const fallback = role === 'o' ? 'O' : 'X';
      void update(dbRoom(), { [`players/${role}/name`]: name.trim() || fallback });
    },
    [roomId, dbRoom],
  );

  const place = useCallback(
    (cell: number) => {
      const cur = roomRef.current;
      const role = myRoleRef.current;
      if (!roomId || !cur || !role) return;
      if (cur.status !== 'playing' || cur.winner || cur.currentTurn !== role) return;
      if (cur.piecesLeft[role] <= 0) return;

      const now = Date.now() + offsetRef.current;
      const elapsed = Math.max(0, now - cur.turnStartedAt);
      const slot = cur.players[role];
      if (!slot) return;
      const tc = normalizeTimeControl(cur.timeControl);
      const moverRemaining = isUnlimited(tc)
        ? slot.timeRemaining
        : slot.timeRemaining - elapsed + tc.incrementMs;

      const board = applyMove(recordToBoard(cur.board), cell, role);
      const win = checkWinAt(board, cell, role);
      const piecesLeft = { ...cur.piecesLeft, [role]: cur.piecesLeft[role] - 1 };

      // RTDB は null を書かないため、読み戻すと winner が undefined になる。
      // update() は undefined を拒否するので null に正規化する。
      let winner: Winner = cur.winner ?? null;
      if (win) winner = role;
      else if (piecesLeft.o <= 0 && piecesLeft.x <= 0) winner = 'draw';

      const updates: Record<string, unknown> = {
        [`board/${cell}`]: board[cell],
        [`players/${role}/timeRemaining`]: moverRemaining,
        [`piecesLeft/${role}`]: piecesLeft[role],
        currentTurn: winner ? role : oppositeOf(role),
        turnStartedAt: serverTimestamp(),
        winner: winner ?? null,
        status: winner ? 'finished' : 'playing',
      };
      void update(dbRoom(), updates);
    },
    [roomId, dbRoom],
  );

  const reportTimeout = useCallback(
    (player: Player) => {
      if (!roomId) return;
      void runTransaction(dbRoom(), (data: RoomData | null) => {
        if (!data || data.winner || data.status === 'finished') return data;
        data.winner = player === 'o' ? 'timeout_o' : 'timeout_x';
        data.status = 'finished';
        return data;
      });
    },
    [roomId, dbRoom],
  );

  const requestRematch = useCallback(() => {
    const role = myRoleRef.current;
    if (!roomId || !role) return;
    void runTransaction(dbRoom(), (data: RoomData | null) => {
      if (!data) return data;
      const rematch = { ...(data.rematch || {}), [role]: true };
      data.rematch = rematch;
      // 両者が再戦を希望したら盤面をリセットして countdown へ。
      if (rematch.o && rematch.x) {
        const tc = normalizeTimeControl(data.timeControl);
        data.board = null;
        data.piecesLeft = { o: INITIAL_PIECES, x: INITIAL_PIECES };
        data.winner = null;
        data.currentTurn = FIRST_PLAYER;
        data.turnStartedAt = 0;
        data.status = 'countdown';
        data.rematch = {};
        if (data.players.o) data.players.o.timeRemaining = tc.baseMs;
        if (data.players.x) data.players.x.timeRemaining = tc.baseMs;
      }
      return data;
    });
  }, [roomId, dbRoom]);

  return {
    room,
    myRole,
    serverOffset,
    error,
    createRoom,
    joinRoom,
    startGame,
    updateSettings,
    updateName,
    place,
    reportTimeout,
    requestRematch,
  };
}

function roomWriteError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission/i.test(msg)) return 'DBへの書き込みが拒否されました。Firebaseのルールを確認してください。';
  return `通信エラー: ${msg}`;
}
