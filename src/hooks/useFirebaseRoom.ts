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
  START_TIME_MS,
  FIRST_PLAYER,
  applyMove,
  checkWinAt,
  recordToBoard,
} from '../lib/gameLogic';
import { oppositeOf } from '../lib/gameLogic';
import type { Player, RoomData, Winner } from '../types';

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
  };
}

export interface UseFirebaseRoomResult {
  room: RoomData | null;
  myRole: Player | null;
  serverOffset: number;
  error: string | null;
  /** 新規ルームを作成して o として参加 */
  createRoom: () => Promise<void>;
  /** 既存ルームに参加（空きスロットを取得） */
  joinRoom: () => Promise<void>;
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

  // 自分のスロット(uid)から myRole を確定し、切断ハンドラを登録
  useEffect(() => {
    if (!roomId || !room) return;
    let role: Player | null = null;
    (['o', 'x'] as Player[]).forEach((p) => {
      if (room.players[p]?.uid === uidRef.current) role = p;
    });
    if (role && role !== myRoleRef.current) {
      setMyRole(role);
      const slotRef = ref(getDb(), `rooms/${roomId}/players/${role}`);
      // 切断時に connected=false。スロット自体は残して再戦を可能にする。
      onDisconnect(ref(getDb(), `rooms/${roomId}/players/${role}/connected`)).set(false);
      // 再接続時は connected=true に戻す。
      void update(slotRef, { connected: true });
    }
  }, [roomId, room]);

  const createRoom = useCallback(async () => {
    if (!roomId) return;
    setError(null);
    const base = initialRoom();
    base.players.o = {
      name: playerName || 'O',
      connected: true,
      timeRemaining: START_TIME_MS,
      uid: uidRef.current,
    };
    try {
      await set(dbRoom(), base);
    } catch (e) {
      setError(roomWriteError(e));
    }
  }, [roomId, playerName, dbRoom]);

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
          timeRemaining: START_TIME_MS,
          uid: uidRef.current,
        };
        data.players = players;
        if (players.o && players.x && data.status === 'waiting') {
          data.status = 'countdown';
        }
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
      void update(dbRoom(), {
        status: 'playing',
        turnStartedAt: serverTimestamp(),
        currentTurn: FIRST_PLAYER,
      });
    }, COUNTDOWN_MS);
    return () => clearTimeout(t);
  }, [roomId, room, myRole, dbRoom]);

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
      const moverRemaining = slot.timeRemaining - elapsed + 15_000;

      const board = applyMove(recordToBoard(cur.board), cell, role);
      const win = checkWinAt(board, cell, role);
      const piecesLeft = { ...cur.piecesLeft, [role]: cur.piecesLeft[role] - 1 };

      let winner: Winner = cur.winner;
      if (win) winner = role;
      else if (piecesLeft.o <= 0 && piecesLeft.x <= 0) winner = 'draw';

      const updates: Record<string, unknown> = {
        [`board/${cell}`]: board[cell],
        [`players/${role}/timeRemaining`]: moverRemaining,
        [`piecesLeft/${role}`]: piecesLeft[role],
        currentTurn: winner ? role : oppositeOf(role),
        turnStartedAt: serverTimestamp(),
        winner,
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
        data.board = null;
        data.piecesLeft = { o: INITIAL_PIECES, x: INITIAL_PIECES };
        data.winner = null;
        data.currentTurn = FIRST_PLAYER;
        data.turnStartedAt = 0;
        data.status = 'countdown';
        data.rematch = {};
        if (data.players.o) data.players.o.timeRemaining = START_TIME_MS;
        if (data.players.x) data.players.x.timeRemaining = START_TIME_MS;
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
