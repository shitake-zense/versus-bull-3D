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
  initialPieces,
  MAX_STACK,
  FIRST_PLAYER,
  applyBlock,
  applyMove,
  checkWinAt,
  isBlock,
  pickTraps,
  recordToBoard,
  setBoardShape,
  triggeredTrap,
} from '../lib/gameLogic';
import {
  DEFAULT_TIME_CONTROL,
  isUnlimited,
  normalizeTimeControl,
  resolveStartingPlayer,
} from '../lib/timeControl';
import {
  nextSeat,
  prevSeat,
  requiredSeats,
  seatTeam,
  startingSeat,
} from '../lib/seats';
import type { BoardShapeId, Player, RoomData, Seat, TimeControl, TurnPref, Winner } from '../types';

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
    piecesLeft: { o: initialPieces('square'), x: initialPieces('square') },
    winner: null,
    createdAt: Date.now(),
    timeControl: DEFAULT_TIME_CONTROL,
    turnPref: 'o',
    trapCount: 0,
    boardShape: 'square',
    score: { o: 0, x: 0 },
    teamMode: false,
    currentSeat: FIRST_PLAYER,
  };
}

export interface UseFirebaseRoomResult {
  room: RoomData | null;
  /** 自分のチーム（盤の記号）。チーム戦では o2→'o' のように畳まれる。 */
  myRole: Player | null;
  /** 自分の席（o/x/o2/x2）。canPlace 判定に使う。 */
  mySeat: Seat | null;
  serverOffset: number;
  error: string | null;
  /** 新規ルームを作成して o（席1）として参加。teamMode=true で 2vs2 チーム戦。 */
  createRoom: (
    timeControl?: TimeControl,
    turnPref?: TurnPref,
    teamMode?: boolean,
    trapCount?: number,
    boardShape?: BoardShapeId,
  ) => Promise<void>;
  /** 既存ルームに参加（空きスロットを取得） */
  joinRoom: () => Promise<void>;
  /** ロビーから対戦開始（ホストのみ） */
  startGame: () => void;
  /** ルーム設定（持ち時間・先手・落下ブロック数・盤形状）を更新（ホストのみ・待機中） */
  updateSettings: (
    timeControl: TimeControl,
    turnPref: TurnPref,
    trapCount: number,
    boardShape: BoardShapeId,
  ) => void;
  /** 自分のスロットの表示名を更新（ロビーで参加側も変更可能） */
  updateName: (name: string) => void;
  place: (cell: number) => void;
  reportTimeout: (player: Player) => void;
  requestRematch: () => void;
  /** 設定を変えて再戦: ホストが終局後にロビー（waiting）へ戻す（スコア・参加者は保持） */
  returnToLobby: () => void;
  /** 待った（手戻し）を相手に申請する */
  requestUndo: () => void;
  /** 待った申請に応答する（true=承認で盤面を戻す / false=却下） */
  respondUndo: (accept: boolean) => void;
}

export function useFirebaseRoom(
  roomId: string | null,
  playerName: string,
): UseFirebaseRoomResult {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const myRole: Player | null = mySeat ? seatTeam(mySeat) : null;
  const [serverOffset, setServerOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uidRef = useRef<string>(makeUid());
  const roomRef = useRef(room);
  roomRef.current = room;
  const offsetRef = useRef(0);
  offsetRef.current = serverOffset;
  const mySeatRef = useRef(mySeat);
  mySeatRef.current = mySeat;
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

  // 自分のスロット(uid)から自席を確定する。
  useEffect(() => {
    if (!roomId || !room) return;
    let seat: Seat | null = null;
    (['o', 'x', 'o2', 'x2'] as Seat[]).forEach((s) => {
      if (room.players[s]?.uid === uidRef.current) seat = s;
    });
    if (seat && seat !== mySeatRef.current) setMySeat(seat);
  }, [roomId, room]);

  // プレゼンス管理: .info/connected を監視し、接続が確立するたびに
  // connected=true を書き、onDisconnect(connected=false) を再設定する。
  // これによりモバイル等で一時的に切断→再接続しても「切断」表示が残らない。
  useEffect(() => {
    if (!roomId || !mySeat) return;
    const connectedRef = ref(getDb(), '.info/connected');
    const slotConnRef = ref(getDb(), `rooms/${roomId}/players/${mySeat}/connected`);
    const unsub = onValue(connectedRef, (snap) => {
      if (snap.val() !== true) return; // 切断中。再接続時に再びここへ来る。
      // 切断時に connected=false（スロット自体は残し再接続/再戦を可能に）。
      void onDisconnect(slotConnRef).set(false);
      void set(slotConnRef, true);
    });
    return () => unsub();
  }, [roomId, myRole]);

  const createRoom = useCallback(
    async (
      timeControl: TimeControl = DEFAULT_TIME_CONTROL,
      turnPref: TurnPref = 'o',
      teamMode = false,
      trapCount = 0,
      boardShape: BoardShapeId = 'square',
    ) => {
      if (!roomId) return;
      setError(null);
      const tc = normalizeTimeControl(timeControl);
      const base = initialRoom();
      base.timeControl = tc;
      base.turnPref = turnPref;
      base.teamMode = teamMode;
      base.trapCount = trapCount;
      base.boardShape = boardShape;
      base.piecesLeft = { o: initialPieces(boardShape), x: initialPieces(boardShape) };
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
        const seats = requiredSeats(data.teamMode);
        // 既に自分のスロットがある（リロード等）なら何もしない。
        if (seats.some((s) => players[s]?.uid === uidRef.current)) return data;
        const slot = seats.find((s) => !players[s]) ?? null;
        if (!slot) return; // 満員 → abort
        players[slot] = {
          name: playerName || slot.toUpperCase(),
          connected: true,
          timeRemaining: normalizeTimeControl(data.timeControl).baseMs,
          uid: uidRef.current,
        };
        data.players = players;
        // 定員が揃っても自動開始せず 'waiting'(ロビー) のまま。ホストの開始操作を待つ。
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
      const startTeam = resolveStartingPlayer(cur.turnPref);
      // 予告抽選が正しい形状のセル上で行われるよう、ここでもジオメトリを確定。
      setBoardShape(cur.boardShape ?? 'square');
      void update(dbRoom(), {
        status: 'playing',
        turnStartedAt: serverTimestamp(),
        currentTurn: startTeam,
        currentSeat: startingSeat(startTeam),
        // 開始時に落下ブロックの予告をランダム抽選（両クライアントで同一になるようホストが確定）。
        traps: pickTraps(cur.trapCount ?? 0),
        // 開始時に両チームの持ち時間を確定（ロビーで設定変更されていても整合させる）。
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
    // 必要な席（1vs1=2 / 2vs2=4）が全部埋まるまで開始不可。
    if (requiredSeats(cur.teamMode).some((s) => !cur.players[s])) return;
    if (cur.status !== 'waiting') return;
    void update(dbRoom(), { status: 'countdown' });
  }, [roomId, dbRoom]);

  // ルーム設定（持ち時間・先手・落下数・盤形状）を更新。ホストのみ・待機中だけ許可。
  const updateSettings = useCallback(
    (timeControl: TimeControl, turnPref: TurnPref, trapCount: number, boardShape: BoardShapeId) => {
      const cur = roomRef.current;
      if (!roomId || !cur) return;
      if (myRoleRef.current !== 'o' || cur.status !== 'waiting') return;
      const tc = normalizeTimeControl(timeControl);
      const pieces = initialPieces(boardShape);
      const updates: Record<string, unknown> = {
        timeControl: tc,
        turnPref,
        trapCount,
        boardShape,
        // 形状で総ピース数が変わるので待機中に反映（表示・開始時の整合）。
        piecesLeft: { o: pieces, x: pieces },
      };
      // 待機中の両者の表示用持ち時間も即時反映。
      if (cur.players.o) updates['players/o/timeRemaining'] = tc.baseMs;
      if (cur.players.x) updates['players/x/timeRemaining'] = tc.baseMs;
      void update(dbRoom(), updates);
    },
    [roomId, dbRoom],
  );

  // 自分のスロットの表示名を更新（ロビー待機中に参加側/ホスト双方が変更可能）。
  // チーム戦では自席(o/x/o2/x2)へ書く。myRole はチームに畳まれ O₂→o になり①の枠を
  // 上書きしてしまうため、必ず mySeat を使う。
  const updateName = useCallback(
    (name: string) => {
      const seat = mySeatRef.current;
      if (!roomId || !seat) return;
      const fallback = seat.toUpperCase();
      void update(dbRoom(), { [`players/${seat}/name`]: name.trim() || fallback });
    },
    [roomId, dbRoom],
  );

  const place = useCallback(
    (cell: number) => {
      const cur = roomRef.current;
      const seat = mySeatRef.current;
      if (!roomId || !cur || !seat) return;
      const team = seatTeam(seat); // 盤に置く記号（チーム）
      const activeSeat: Seat = cur.currentSeat ?? cur.currentTurn; // 旧ルーム後方互換
      if (cur.status !== 'playing' || cur.winner || activeSeat !== seat) return;
      if (cur.piecesLeft[team] <= 0) return;
      if ((cur.board?.[cell]?.length ?? 0) >= MAX_STACK) return; // 満杯マスには置けない

      const now = Date.now() + offsetRef.current;
      const elapsed = Math.max(0, now - cur.turnStartedAt);
      // 持ち時間はチーム共有（o/x スロットの値を使う）。
      const teamSlot = cur.players[team];
      if (!teamSlot) return;
      const tc = normalizeTimeControl(cur.timeControl);
      const moverRemaining = isUnlimited(tc)
        ? teamSlot.timeRemaining
        : teamSlot.timeRemaining - elapsed + tc.incrementMs;

      let board = applyMove(recordToBoard(cur.board), cell, team);
      const win = checkWinAt(board, cell, team);
      // 勝利手でなければ、この着手で発動するトラップの中立ブロックを落とす。
      if (!win && triggeredTrap(board, cell, cur.traps ?? [])) board = applyBlock(board, cell);
      const piecesLeft = { ...cur.piecesLeft, [team]: cur.piecesLeft[team] - 1 };

      // RTDB は null を書かないため、読み戻すと winner が undefined になる。
      // update() は undefined を拒否するので null に正規化する。
      let winner: Winner = cur.winner ?? null;
      if (win) winner = team;
      else if (piecesLeft.o <= 0 && piecesLeft.x <= 0) winner = 'draw';

      const next = nextSeat(seat, cur.teamMode);
      const updates: Record<string, unknown> = {
        [`board/${cell}`]: board[cell],
        [`players/${team}/timeRemaining`]: moverRemaining,
        [`piecesLeft/${team}`]: piecesLeft[team],
        currentTurn: winner ? team : seatTeam(next),
        currentSeat: winner ? seat : next,
        turnStartedAt: serverTimestamp(),
        winner: winner ?? null,
        status: winner ? 'finished' : 'playing',
        lastMove: { cell, player: team }, // 待った用の巻き戻し情報
        undo: null, // 着手したら保留中の待った申請は無効化（暗黙の却下）
      };
      // 4連での勝利は room スコアを権威的に+1（引き分けは加算なし）。
      if (winner === 'o' || winner === 'x') {
        updates[`score/${winner}`] = (cur.score?.[winner] ?? 0) + 1;
      }
      void update(dbRoom(), updates);
    },
    [roomId, dbRoom],
  );

  // 待った（手戻し）を申請する。自分の直前手がある＝今は相手番のときのみ可。
  const requestUndo = useCallback(() => {
    const cur = roomRef.current;
    const role = myRoleRef.current;
    if (!roomId || !cur || !role) return;
    if (cur.status !== 'playing' || cur.winner) return;
    if (cur.currentTurn === role) return; // 自分の手番＝直前手はまだ無い
    if (!cur.lastMove || cur.lastMove.player !== role) return;
    if (cur.undo?.by) return; // 既に申請中
    void update(dbRoom(), { undo: { by: role } });
  }, [roomId, dbRoom]);

  // 待った申請への応答。承認なら直前手を盤面から取り除き、手番を申請者へ戻す。
  const respondUndo = useCallback(
    (accept: boolean) => {
      if (!roomId) return;
      const offset = offsetRef.current;
      void runTransaction(dbRoom(), (data: RoomData | null) => {
        if (!data || !data.undo) return data;
        const lm = data.lastMove;
        if (accept && lm && data.status === 'playing') {
          const board = { ...(data.board || {}) };
          const stack = (board[String(lm.cell)] || []).slice();
          // 直前手で落下ブロックが乗っていれば、それも一緒に取り除く。
          while (stack.length > 0 && isBlock(stack[stack.length - 1])) stack.pop();
          if (stack.length > 0 && stack[stack.length - 1] === lm.player) {
            stack.pop();
            if (stack.length > 0) board[String(lm.cell)] = stack;
            else delete board[String(lm.cell)];
            data.board = Object.keys(board).length > 0 ? board : null;
            data.piecesLeft[lm.player] = (data.piecesLeft[lm.player] ?? 0) + 1;
            // 手番を直前に指した席へ戻す（1vs1 は席=チーム。チーム戦も prevSeat で復元）。
            data.currentSeat = prevSeat((data.currentSeat ?? data.currentTurn) as Seat, data.teamMode);
            data.currentTurn = lm.player;
            data.turnStartedAt = Date.now() + offset; // 申請者の手番として時計を再始動
            data.winner = null;
            data.status = 'playing';
            data.lastMove = null; // 一手前は不明なのでマーカーは消す
          }
        }
        data.undo = null;
        return data;
      });
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
        // 時間切れの勝者（切れた側の相手）を room スコアに+1。
        const w: Player = player === 'o' ? 'x' : 'o';
        data.score = data.score || { o: 0, x: 0 };
        data.score[w] = (data.score[w] ?? 0) + 1;
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
        // 手番希望を解決し直す（turnPref='random' なら再戦のたびに先攻/後攻を再抽選）。
        const startTeam = resolveStartingPlayer(data.turnPref);
        const pieces = initialPieces(data.boardShape ?? 'square');
        data.board = null;
        data.piecesLeft = { o: pieces, x: pieces };
        data.winner = null;
        data.currentTurn = startTeam;
        data.currentSeat = startingSeat(startTeam);
        data.turnStartedAt = 0;
        data.status = 'countdown';
        data.rematch = {};
        data.lastMove = null;
        // 落下ブロックの予告は countdown→playing の host effect で再抽選する。ここでは前局分を消す。
        data.traps = null;
        if (data.players.o) data.players.o.timeRemaining = tc.baseMs;
        if (data.players.x) data.players.x.timeRemaining = tc.baseMs;
      }
      return data;
    });
  }, [roomId, dbRoom]);

  // 設定を変えて再戦: ホストが終局後にロビー（waiting）へ戻す。盤面・勝敗・再戦希望・
  // 予告を消し、スコアと参加者・設定は保持。ロビーでホストが持ち時間/先手/落下を変更→再開できる。
  const returnToLobby = useCallback(() => {
    if (myRoleRef.current !== 'o') return;
    if (!roomId) return;
    void runTransaction(dbRoom(), (data: RoomData | null) => {
      if (!data || !data.winner) return data;
      const tc = normalizeTimeControl(data.timeControl);
      const pieces = initialPieces(data.boardShape ?? 'square');
      data.board = null;
      data.piecesLeft = { o: pieces, x: pieces };
      data.winner = null;
      data.turnStartedAt = 0;
      data.status = 'waiting';
      data.rematch = {};
      data.lastMove = null;
      data.traps = null;
      if (data.players.o) data.players.o.timeRemaining = tc.baseMs;
      if (data.players.x) data.players.x.timeRemaining = tc.baseMs;
      return data;
    });
  }, [roomId, dbRoom]);

  return {
    room,
    myRole,
    mySeat,
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
    returnToLobby,
    requestUndo,
    respondUndo,
  };
}

function roomWriteError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission/i.test(msg)) return 'DBへの書き込みが拒否されました。Firebaseのルールを確認してください。';
  return `通信エラー: ${msg}`;
}
