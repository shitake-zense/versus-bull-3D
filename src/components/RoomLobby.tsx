// モード選択と、オンライン対戦の待機ロビー。

import { useEffect, useRef, useState } from 'react';
import type { AiLevel, Player, RoomData, Seat, TimeControl, TurnPref } from '../types';
import { isFirebaseConfigured } from '../lib/firebase';
import { AI_LEVEL_LABEL, TEAM } from '../lib/teams';
import { requiredSeats, seatTeam, seatSuffix } from '../lib/seats';
import { TRAP_PRESETS } from '../lib/gameLogic';
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
  /** 自分の席（o/x/o2/x2）。チーム戦の名前ラベル・ホスト判定に使う */
  mySeat: Seat | null;
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
  /** 落下ブロック（トラップ）の個数。ローカル/AI/オンライン作成の共通設定 */
  trapCount: number;
  setTrapCount: (n: number) => void;
  /** オンラインのロビーでホストが設定を変更（持ち時間・先手・落下ブロック数） */
  onChangeSettings: (tc: TimeControl, pref: TurnPref, trapCount: number) => void;
  onLocal: () => void;
  onAI: (pref: TurnPref, level: AiLevel) => void;
  /** オンラインルーム作成。teamMode=true で 2vs2 チーム戦 */
  onCreateRoom: (teamMode: boolean) => void;
  waiting: WaitingState | null;
  onStartGame: () => void;
  onLeave: () => void;
  /** BGM再生中か */
  bgmOn: boolean;
  onToggleBgm: () => void;
}

export function RoomLobby({
  playerName,
  setPlayerName,
  onChangeName,
  timeControl,
  setTimeControl,
  trapCount,
  setTrapCount,
  onChangeSettings,
  onLocal,
  onAI,
  onCreateRoom,
  waiting,
  onStartGame,
  onLeave,
  bgmOn,
  onToggleBgm,
}: RoomLobbyProps) {
  const [aiSide, setAiSide] = useState<TurnPref>('o');
  const [aiLevel, setAiLevel] = useState<AiLevel>('normal');
  const [copied, setCopied] = useState(false);
  const [createTeamMode, setCreateTeamMode] = useState(false); // 1vs1 / 2vs2 切替（作成時）

  // 手番希望(先攻/後攻/ランダム)はそのまま App へ渡す（randomの抽選・再戦時の再抽選は App 側）。
  const startAI = () => {
    onAI(aiSide, aiLevel);
  };

  // 待機ロビーでの自分の表示名。Firebase 上のスロット名から一度だけ初期化する。
  const mySeat = waiting?.mySeat ?? null;
  const mySlotName = mySeat ? waiting?.room?.players[mySeat]?.name ?? '' : '';
  const [nameDraft, setNameDraft] = useState('');
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && mySeat && mySlotName) {
      setNameDraft(mySlotName);
      seeded.current = true;
    }
  }, [mySeat, mySlotName]);

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
    const teamMode = Boolean(waiting.room?.teamMode);
    const need = requiredSeats(waiting.room?.teamMode);
    const allJoined = need.every((s) => waiting.room?.players[s]);
    const isHost = waiting.mySeat === 'o';
    const roomTc = normalizeTimeControl(waiting.room?.timeControl);
    const roomPref: TurnPref = waiting.room?.turnPref ?? 'o';
    const roomTrap = waiting.room?.trapCount ?? 0;
    const myTeam = mySeat ? seatTeam(mySeat) : null;
    const myLabel = mySeat
      ? teamMode
        ? `${TEAM[myTeam!].name} 陣営 ${seatSuffix[mySeat]}`
        : mySeat === 'o'
          ? 'ORIGIN・先攻'
          : 'XENOGENESIS・後攻'
      : '';
    return (
      <Shell>
        <h2 className="font-display text-2xl text-white">
          {allJoined ? '対戦ロビー' : `メンバーを待っています（${need.filter((s) => waiting.room?.players[s]).length}/${need.length}）`}
        </h2>
        <p className="text-sm text-col-ui">
          {teamMode ? '2vs2 チーム戦' : '1vs1'} ・ ルームID:{' '}
          <span className="font-mono text-white">{waiting.roomId}</span>
        </p>

        {mySeat && (
          <div className="w-full">
            <label className="mb-1 block text-xs uppercase tracking-wider text-col-ui">
              あなたの名前（{myLabel}）
            </label>
            <input
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                onChangeName(e.target.value);
              }}
              maxLength={16}
              placeholder={mySeat.toUpperCase()}
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

        {teamMode ? (
          <div className="flex w-full gap-3">
            <div className="flex-1 rounded-lg border border-col-o/30 p-2">
              <div className="mb-1.5 text-center text-[10px] uppercase tracking-wider text-col-o">
                ORIGIN 陣営
              </div>
              <div className="flex flex-col gap-2">
                <SlotCard label="①" name={waiting.room?.players.o?.name} ready={!!waiting.room?.players.o} />
                <SlotCard label="②" name={waiting.room?.players.o2?.name} ready={!!waiting.room?.players.o2} />
              </div>
            </div>
            <div className="flex-1 rounded-lg border border-col-x/30 p-2">
              <div className="mb-1.5 text-center text-[10px] uppercase tracking-wider text-col-x">
                XENOGENESIS 陣営
              </div>
              <div className="flex flex-col gap-2">
                <SlotCard label="①" name={waiting.room?.players.x?.name} ready={!!waiting.room?.players.x} />
                <SlotCard label="②" name={waiting.room?.players.x2?.name} ready={!!waiting.room?.players.x2} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full justify-between gap-3">
            <SlotCard label="ORIGIN（O・白・先攻）" name={waiting.room?.players.o?.name} ready={!!waiting.room?.players.o} />
            <SlotCard label="XENOGENESIS（X・黒・後攻）" name={waiting.room?.players.x?.name} ready={!!waiting.room?.players.x} />
          </div>
        )}

        {/* ルーム設定（ホストのみ編集可・待機中） */}
        <div className="w-full rounded-lg border border-col-border bg-bg-void/40 px-3 py-3 text-xs text-col-ui">
          <div>ルール: 4×4 立体・タテヨコナナメ4連</div>
          {isHost ? (
            <div className="mt-2.5 flex flex-col gap-2">
              <TimeControlPicker
                value={roomTc}
                onChange={(tc) => onChangeSettings(tc, roomPref, roomTrap)}
              />
              <TurnOrderPicker
                value={roomPref}
                onChange={(p) => onChangeSettings(roomTc, p, roomTrap)}
              />
              <TrapPicker
                value={roomTrap}
                onChange={(n) => onChangeSettings(roomTc, roomPref, n)}
              />
            </div>
          ) : (
            <div className="mt-2">
              持ち時間: <span className="text-white">{formatTimeControl(roomTc)}</span>
              <span className="mx-2 opacity-50">/</span>
              先手: <span className="text-white">{turnPrefLabel(roomPref)}</span>
              <span className="mx-2 opacity-50">/</span>
              落下ブロック: <span className="text-white">{roomTrap === 0 ? 'なし' : `${roomTrap}個`}</span>
            </div>
          )}
        </div>

        {allJoined ? (
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
          <p className="text-sm text-col-ui">
            {teamMode
              ? '招待リンクを3人に共有してください。4人揃うと開始できます。'
              : '相手がリンクを開くと、ここに表示されます。'}
          </p>
        )}
        {waiting.error && <p className="text-sm text-[#E84040]">{waiting.error}</p>}

        <BgmToggle on={bgmOn} onToggle={onToggleBgm} />

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
          <div className="mt-2 border-t border-col-border/60 pt-2">
            <TrapPicker value={trapCount} onChange={setTrapCount} />
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3">
        <div className="rounded-lg border border-col-gold/50 bg-bg-surface px-5 py-4">
          <div className="font-display text-lg text-white">オンライン対戦</div>
          <div className="text-xs text-col-ui">
            {isFirebaseConfigured
              ? 'ルームを作成して友人を招待'
              : 'Firebase未設定（.env を設定すると有効化）'}
          </div>
          {isFirebaseConfigured && (
            <>
              <div className="mt-3 flex overflow-hidden rounded-md border border-col-border text-xs">
                {([false, true] as const).map((tm) => (
                  <button
                    key={String(tm)}
                    onClick={() => setCreateTeamMode(tm)}
                    className={`flex-1 py-1.5 ${createTeamMode === tm ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
                  >
                    {tm ? '2vs2 チーム戦' : '1vs1'}
                  </button>
                ))}
              </div>
              <button
                onClick={() => onCreateRoom(createTeamMode)}
                className="mt-3 w-full rounded-md border border-col-gold/50 bg-bg-void py-2 text-sm text-white hover:bg-col-gold/10"
              >
                {createTeamMode ? '2vs2 ルームを作成（4人）' : 'ルームを作成して招待'}
              </button>
            </>
          )}
        </div>

        <button
          onClick={onLocal}
          className="rounded-lg border border-col-border bg-bg-surface px-5 py-4 text-left transition-colors hover:border-col-gold/40"
        >
          <div className="font-display text-lg text-white">ローカル対戦</div>
          <div className="text-xs text-col-ui">同じ端末で2人が交互に操作</div>
        </button>

        <div className="rounded-lg border border-col-border bg-bg-surface px-5 py-4">
          <div>
            <div className="font-display text-lg text-white">AI対戦</div>
            <div className="text-xs text-col-ui">Minimax + 反復深化（立体読み）</div>
          </div>

          {/* 手番選択（先攻/後攻/ランダム）。狭い画面でも潰れないよう独立した全幅グリッド。 */}
          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-col-ui">手番</div>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-col-border text-xs">
              {(['o', 'x', 'random'] as TurnPref[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setAiSide(p)}
                  className={`py-1.5 ${aiSide === p ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
                >
                  {p === 'o' ? '先攻（O）' : p === 'x' ? '後攻（X）' : 'ランダム'}
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

      <BgmToggle on={bgmOn} onToggle={onToggleBgm} />
    </Shell>
  );
}

/** BGM再生トグル（メニュー／待機ロビー共通）。 */
function BgmToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={[
        'rounded-full border px-4 py-1.5 font-display text-xs transition-colors',
        on
          ? 'border-col-gold/70 bg-col-gold/15 text-white'
          : 'border-col-border bg-bg-void text-col-ui hover:text-white',
      ].join(' ')}
      title="BGM（落ち着いたアンビエント）の再生切替"
    >
      ♪ BGM {on ? 'ON' : 'OFF'}
    </button>
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

/** 落下ブロック（トラップ）の個数ピッカー。予告位置の1個下が埋まると中立ブロックが降る。 */
function TrapPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-col-ui">落下</span>
      <div className="flex flex-1 overflow-hidden rounded-md border border-col-border">
        {TRAP_PRESETS.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 py-1 text-xs ${value === n ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
          >
            {n === 0 ? 'なし' : `${n}`}
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
