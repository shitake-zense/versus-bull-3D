// モード選択と、オンライン対戦の待機ロビー。

import { useState } from 'react';
import type { Player, RoomData } from '../types';
import { isFirebaseConfigured } from '../lib/firebase';

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
  onLocal: () => void;
  onAI: (side: Player) => void;
  onCreateRoom: () => void;
  waiting: WaitingState | null;
  onStartGame: () => void;
  onLeave: () => void;
}

export function RoomLobby({
  playerName,
  setPlayerName,
  onLocal,
  onAI,
  onCreateRoom,
  waiting,
  onStartGame,
  onLeave,
}: RoomLobbyProps) {
  const [aiSide, setAiSide] = useState<Player>('o');
  const [copied, setCopied] = useState(false);

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
    return (
      <Shell>
        <h2 className="font-display text-2xl text-white">
          {bothJoined ? '対戦ロビー' : '対戦相手を待っています'}
        </h2>
        <p className="text-sm text-col-ui">
          ルームID: <span className="font-mono text-white">{waiting.roomId}</span>
        </p>

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

        {/* ルーム設定（今後拡張予定のプレースホルダ） */}
        <div className="w-full rounded-lg border border-dashed border-col-border bg-bg-void/40 px-3 py-2 text-xs text-col-ui">
          ルール: 4×4 立体・タテヨコナナメ4連 / 持ち時間 5分＋15秒
          <span className="ml-1 opacity-60">（設定変更は今後追加予定）</span>
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
              {(['o', 'x'] as Player[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setAiSide(p)}
                  className={`px-3 py-1.5 ${aiSide === p ? 'bg-col-gold/20 text-white' : 'text-col-ui'}`}
                >
                  {p === 'o' ? 'ORIGIN' : 'XENOGENESIS'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onAI(aiSide)}
            className="mt-3 w-full rounded-md border border-col-gold/50 bg-bg-void py-2 text-sm text-white hover:bg-col-gold/10"
          >
            {aiSide === 'o' ? 'ORIGIN（先攻・白）' : 'XENOGENESIS（後攻・黒）'}で参戦
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-col-border bg-bg-surface/90 p-6 shadow-2xl backdrop-blur">
        {children}
      </div>
    </div>
  );
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
