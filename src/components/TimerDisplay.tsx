// フィッシャークロック表示。残り30秒を切ると赤く脈動する。

import type { ReactNode } from 'react';

interface TimerDisplayProps {
  ms: number;
  label: string;
  player: 'o' | 'x';
  active: boolean;
  /** 持ち時間制か。false（無制限）なら ∞ を表示し赤脈動しない */
  timed?: boolean;
  /** タイマー下の補助表示（チーム戦のメンバー名簿など） */
  sub?: ReactNode;
}

const LOW_TIME_MS = 30_000;

function format(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  // 残り10秒未満は小数1桁まで出して緊張感を出す。
  if (clamped < 10_000) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TimerDisplay({ ms, label, player, active, timed = true, sub }: TimerDisplayProps) {
  const low = timed && ms < LOW_TIME_MS;
  // O=白, X=黒（UIでは視認性のため明スレートで表現）
  const accent = player === 'o' ? '#F2F2F2' : '#AEB6C6';

  return (
    <div
      className={[
        'relative rounded-lg border px-2.5 py-1.5 sm:px-4 sm:py-2 min-w-[104px] sm:min-w-[150px] max-w-[40vw] sm:max-w-[230px] transition-colors',
        active ? 'border-col-gold/60' : 'border-col-border',
        low ? 'animate-pulse-danger' : 'bg-bg-surface',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent, boxShadow: active ? `0 0 8px ${accent}` : 'none' }}
        />
        <span className="truncate font-display text-xs uppercase tracking-wider text-col-ui">{label}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-col-gold animate-blink" />}
      </div>
      <div
        className="font-mono text-2xl sm:text-3xl leading-tight tabular-nums"
        style={{ color: low ? '#E84040' : accent }}
      >
        {timed ? format(ms) : '∞'}
      </div>
      {sub}
    </div>
  );
}
