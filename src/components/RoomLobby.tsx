// モード選択と、オンライン対戦の待機ロビー。

import { useEffect, useRef, useState } from 'react';
import type { AiLevel, Player, RoomData, TimeControl, TurnPref } from '../types';
import { isFirebaseConfigured } from '../lib/firebase';
import { AI_LEVEL_LABEL } from '../lib/teams';
import {
  BASE_PRESETS,
  INCREMENT_PRESETS,
  UNLIMITED,
  formatTimeControl,
  isUnlimited,
  normalizeTimeControl,
} from '../lib/timeControl';

export interface WaitingState {
  roomId: string;
  shareUrl: string;
  room: RoomData | null;
  myRole: Player | null;
  error: string | null;
  /** リンク経由の参加者か（招待された側） */
  isGuest: boolean;
}

interface RoomLobbyProps {
  playerName: string;
  setPlayerName: (n: string) => void;
  /** ロビーでの名前変更（オンラインは自分のスロットへ即時反映） */
  onChangeName: (n: string) => void;
  /** ローカル/AI/オンライン作成に使う持ち時間設定 */
  timeControl: TimeControl;
  setTimeControl: (tc: TimeControl) => void;
  /** オンラインのロビーでホストが設定を変更（持ち時間・先手） */
  onChangeSettings: (tc: TimeControl, pref: TurnPref) => void;
  onLocal: () => void;
  onAI: (side: Player, level: AiLevel) => void;
  onCreateRoom: () => void;
  waiting: WaitingState | null;
  onStartGame: () => void;
  onLeave: () => void;
}

export function RoomLobby({
  playerName,
  setPlayerName,
  onChangeName,
  timeControl,
  setTimeControl,
  onChangeSettings,
  onLocal,
  onAI,
  onCreateRoom,
  waiting,
  onStartGame,
  onLeave,
}: RoomLobbyProps) {
  const [aiSide, setAiSide] = useState<TurnPref>('o');
  const [aiLevel, setAiLevel] = useState<AiLevel>('normal');
  const [copied, setCopied] = useState(false);

  // AI参戦時に side(先攻/後攻/ランダム)を実プレイヤーへ解決。
  const startAI = () => {
    const side: Player = aiSide === 'random' ? (Math.random() < 0.5 ? 'o' : 'x') : aiSide;
    onAI(side, aiLevel);
  };

  // 待機ロビーでの自分の表示名。Firebase 上のスロット名から一度だけ初期化する。
  const myRole = waiting?.myRole ?? null;
  const mySlotName = myRole ? waiting?.room?.players[myRole]?.name ?? '' : '';
  const [nameDraft, setNameDraft] = useState('');
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && myRole && mySlotName) {
      setNameDraft(mySlotName);
      seeded.current = true;
    }
  }, [myRole, mySlotName]);

  const copy = async () => {
    if (!waiting) return;
    try {
      await navigator.clipboard.writeText(waiting.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボード非対応環境は手動コピーに任せる */
    }
  };

  if (waiting) {
    const bothJoined = Boolean(waiting.room?.players.o && waiting.room?.players.x);
    const isHost = waiting.myRole === 'o';
    const roomTc = normalizeTimeControl(waiting.room?.timeControl);
    const roomPref: TurnPref = waiting.room?.turnPref ?? 'o';
    return (
      <Shell>
        <h2 className="font-display text-2xl text-white">
          {bothJoined ? '対戦ロビー' : '対戦相手を待っています'}
        </h2>
        <p className="text-sm text-col-ui">
          ルームID: <span className="font-mono text-white">{waiting.roomId}</span>
        </p>

        {waiting.myRole && (
          <div className="w-full">
            <label className="mb-1 block text-xs uppercase tracking-wider text-col-ui">
              あなたの名前（{waiting.myRole === 'o' ? 'ORIGIN・先攻' : 'XENOGENESIS・後攻'}）
            </label>
            <input
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                onChangeName(e.target.value);
              }}
              maxLength={16}
              placeholder={waiting.myRole === 'o' ? 'O' : 'X'}
              className="w-full rounded-md border border-col-border bg-bg-void px-3 py-2 text-white outline-none focus:border-col-gold/60"
            />
          </div>
        )}

        {!waiting.isGuest && (
          <div className="w-full">
            <label className="mb-1 block text-xs uppercase tracking-wider text-col-ui">招待リンク</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={waiting.shareUrl}
                className="flex-1 truncate rounded-md border border-col-border bg-bg-void px-3 py-2 font-mono text-xs text-col-ui"
              />
              <button
                onClick={copy}
                className="rounded-md border border-col-gold/60 bg-bg-surface px-4 py-2 text-sm text-white hover:bg-col-gold/10"
              >
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
          </div>
        )}

        <div className="flex w-full justify-between gap-3">
          <SlotCard label="ORIGIN（O・白・先攻）" name={waiting.room?.players.o?.name} ready={!!waiting.room?.players.o} />
          <SlotCard label="XENOGENESIS（X・黒・後攻）" name={waiting.room?.players.x?.name} ready={!!waiting.room?.players.x} />
        </div>

        {/* ルーム設定（ホストのみ編集可・待機中） */}
        <div className="w-full rounded-lg border border-col-border bg-bg-void/40 px-3 py-3 text-xs text-col-ui">
          <div>ルール: 4×4 立体・タテヨコナナメ4連</div>
          {isHost ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <TimeControlPicker
                value={roomTc}
                onChange={(tc) => onChangeSettings(tc, roomPref)}
              />
              <TurnOrderPicker value={roomPref} onChange={(p) => onChangeSettings(roomTc, p)} />
            </div>
          ) : (
            <div className="mt-2">
              持ち時間: <span className="text-white">{formatTimeControl(roomTc)}</span>
              <span className="mx-2 opacity-50">/</span>
              先手: <span className="text-white">{turnPrefLabel(roomPref)}</span>
            </div>
          )}
        </div>

        {bothJoined ? (
          isHost ? (
            <button
              onClick={onStartGame}
              className="w-full rounded-lg border border-col-gold/60 bg-bg-surface py-3 font-display text-lg text-white transition-colors hover:bg-col-gold/10"
            >
              対戦開始
            </button>
          ) : (
            <p className="animate-blink text-sm text-col-ui">ホストの開始を待っています…</p>
          )
        ) : (
          <p className="text-sm text-col-ui">相手がリンクを開くと、ここに表示されます。</p>
        )}
        {waiting.error && <p className="text-sm text-[#E84040]">{waiting.error}</p>}

        <button onClick={onLeave} className="text-xs text-col-ui underline hover:text-white">
          キャンセルしてメニューへ
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <h1 className="font-display text-4xl font-bold tracking-tight text-white">
          versus <span className="text-col-o">bull</span> 3D
        </h1>
        <p className="mt-2 font-display text-sm tracking-wide">
          <span className="text-col-o">ORIGIN</span>
          <span className="mx-2 text-col-ui">vs</span>
          <span className="text-col-x">XENOGENESIS</span>
        </p>
        <p className="mt-1 text-xs text-col-ui">4×4・積み上げ・タテヨコナナメ立体で4連</p>
      </div>

      <div className="w-full">
        <label className="mb-1 block text-xs uppercase tracking-wider text-col-ui">プレイヤー名</label>
        <input
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={16}
          placeholder="名無し"
          className="w-full rounded-md border border-col-border bg-bg-void px-3 py-2 text-white outline-none focus:border-col-gold/60"
        />
      </div>

      <div className="w-full">
        <label className="mb-1 block text-xs uppercase tracking-wider text-col-ui">
          持ち時間（ローカル / AI / オンライン作成時）
        </label>
        <div className="rounded-lg border border-col-border bg-bg-surface px-3 py-2">
          <TimeControlPicker value={timeControl} onChange={setTimeControl} />
        </div>
      </div>

      <div className="flex w-full flex-col gap-3">
        <button
          onClick={onCreateRoom}
          disabled={!isFirebaseConfigured}
          className="rounded-lg border border-col-gold/50 bg-bg-surface px-5 py-4 text-left transition-colors hover:bg-col-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div className="font-display text-lg text-white">オンライン対戦</div>
          <div className="text-xs text-col-ui">
            {isFirebaseConfigured
              ? 'ルームを作成して友人を招待'
              : 'Firebase未設定（.env を設定すると有効化）'}
          </div>
        </button>

        <button
          onClick={onLocal}
          className="rounded-lg border border-col-border bg-bg-surface px-5 py-4 text-left transition-colors hover:border-col-gold/40"
        >
          <div className="font-display text-lg text-white">ローカル対戦</div>
          <div className="text-xs text-col-ui">同じ端末で2人が交互に操作</div>
        </button>

        <div className="rounded-lg border border-col-border bg-bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg text-white">AI対戦</div>
              <div className="text-xs text-col-ui">Minimax + 反復深化（立体読み）</div>
            </div>
            <div className="flex overflow-hidden rounded-md border border-col-border text-xs">
              {(['o', 'x', 'random'] as TurnPref[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setAiSide(p)}
                  className={`px-3 py-1.5 ${aiSide === p ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
                >
                  {p === 'o' ? 'ORIGIN' : p === 'x' ? 'XENOGENESIS' : 'ランダム'}
                </button>
              ))}
            </div>
          </div>

          {/* 難易度選択 */}
          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-col-ui">難易度</div>
            <div className="grid grid-cols-4 overflow-hidden rounded-md border border-col-border text-xs">
              {(['easy', 'normal', 'hard', 'max'] as AiLevel[]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => setAiLevel(lv)}
                  className={`py-1.5 ${aiLevel === lv ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
                >
                  {AI_LEVEL_LABEL[lv]}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startAI}
            className="mt-3 w-full rounded-md border border-col-gold/50 bg-bg-void py-2 text-sm text-white hover:bg-col-gold/10"
          >
            {aiSide === 'o'
              ? 'ORIGIN（先攻・白）'
              : aiSide === 'x'
                ? 'XENOGENESIS（後攻・黒）'
                : 'ランダムな手番'}
            ・{AI_LEVEL_LABEL[aiLevel]}で参戦
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // 内容が画面より高いときはスクロールできるように overflow-y-auto。
  // min-h-full + my-auto で、収まる時は中央寄せ・あふれる時は上端から流す。
  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div className="flex min-h-full justify-center p-4">
        <div className="my-auto flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-col-border bg-bg-surface/90 p-6 shadow-2xl backdrop-blur">
          {children}
        </div>
      </div>
    </div>
  );
}

/** 持ち時間（基本＋加算）と無制限トグルのピッカー。 */
function TimeControlPicker({
  value,
  onChange,
}: {
  value: TimeControl;
  onChange: (tc: TimeControl) => void;
}) {
  const unlimited = isUnlimited(value);
  const rowCls = 'flex flex-1 overflow-hidden rounded-md border border-col-border';
  const cellCls = (on: boolean) =>
    `flex-1 py-1 ${on ? 'bg-col-gold/20 text-white' : 'text-col-ui'} disabled:opacity-30`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-col-ui">時間</span>
        <div className={rowCls}>
          {BASE_PRESETS.map((p) => (
            <button
              key={p.ms}
              disabled={unlimited}
              onClick={() => onChange({ baseMs: p.ms, incrementMs: value.incrementMs })}
              className={cellCls(!unlimited && value.baseMs === p.ms)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-col-ui">加算</span>
        <div className={rowCls}>
          {INCREMENT_PRESETS.map((p) => (
            <button
              key={p.ms}
              disabled={unlimited}
              onClick={() => onChange({ baseMs: value.baseMs, incrementMs: p.ms })}
              className={cellCls(!unlimited && value.incrementMs === p.ms)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => onChange(unlimited ? { baseMs: 300_000, incrementMs: 15_000 } : UNLIMITED)}
        className={`rounded-md border py-1 text-xs ${
          unlimited
            ? 'border-col-gold/60 bg-col-gold/20 text-white'
            : 'border-col-border text-col-ui'
        }`}
      >
        無制限{unlimited ? '（ON）' : ''}
      </button>
    </div>
  );
}

/** 先手（先攻/後攻/ランダム）のピッカー。ホスト視点。 */
function TurnOrderPicker({
  value,
  onChange,
}: {
  value: TurnPref;
  onChange: (p: TurnPref) => void;
}) {
  const opts: { v: TurnPref; label: string }[] = [
    { v: 'o', label: '自分が先攻' },
    { v: 'x', label: '自分が後攻' },
    { v: 'random', label: 'ランダム' },
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-col-ui">先手</span>
      <div className="flex flex-1 overflow-hidden rounded-md border border-col-border">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`flex-1 py-1 ${value === o.v ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 先手設定の表示ラベル（参加側向け）。 */
function turnPrefLabel(p: TurnPref): string {
  if (p === 'random') return 'ランダム';
  return p === 'o' ? 'ORIGIN が先手' : 'XENOGENESIS が先手';
}

function SlotCard({ label, name, ready }: { label: string; name?: string; ready: boolean }) {
  return (
    <div
      className={`flex-1 rounded-lg border px-3 py-3 text-center ${
        ready ? 'border-col-gold/50' : 'border-col-border border-dashed'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-col-ui">{label}</div>
      <div className="mt-1 truncate font-display text-white">{ready ? name || '—' : '待機中'}</div>
    </div>
  );
}
