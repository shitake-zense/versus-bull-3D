// 3Dキャンバスの上に React DOM で重ねる2D HUD。
// タイマー・手番・残ピース・スコア・カメラ切替・結果/再戦を表示する。

import { useEffect, useState } from 'react';
import type { GameMode, Player, RoomStatus, Winner } from '../types';
import { INITIAL_PIECES } from '../lib/gameLogic';
import { TEAM } from '../lib/teams';
import type { CameraView } from './CameraController';
import { TimerDisplay } from './TimerDisplay';

interface HUDProps {
  mode: GameMode;
  status: RoomStatus;
  names: Record<Player, string>;
  displayRemaining: Record<Player, number>;
  timed: boolean;
  currentTurn: Player;
  piecesLeft: Record<Player, number>;
  score: Record<Player, number>;
  winner: Winner;
  myRole: Player | null;
  countdown: number | null;
  disconnected: boolean;
  showThreats: boolean;
  onToggleThreats: () => void;
  onSelectView: (v: CameraView) => void;
  onRematch: () => void;
  onExit: () => void;
  rematchPending?: boolean;
}

function resultText(winner: Winner): { title: string; sub: string } {
  switch (winner) {
    case 'o':
      return { title: `${TEAM.o.name} の勝ち`, sub: '立体4連達成' };
    case 'x':
      return { title: `${TEAM.x.name} の勝ち`, sub: '立体4連達成' };
    case 'draw':
      return { title: '引き分け', sub: '全ピース配置' };
    case 'timeout_o':
      return { title: `${TEAM.x.name} の勝ち`, sub: `${TEAM.o.name} 時間切れ` };
    case 'timeout_x':
      return { title: `${TEAM.o.name} の勝ち`, sub: `${TEAM.x.name} 時間切れ` };
    default:
      return { title: '', sub: '' };
  }
}

export function HUD(props: HUDProps) {
  const {
    mode,
    status,
    names,
    displayRemaining,
    timed,
    currentTurn,
    piecesLeft,
    score,
    winner,
    myRole,
    countdown,
    disconnected,
    showThreats,
    onToggleThreats,
    onSelectView,
    onRematch,
    onExit,
    rematchPending,
  } = props;

  const playing = status === 'playing' && !winner;

  // 対局終了後に結果オーバーレイを一時的に隠して盤面を確認できる。
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (!winner) setReviewing(false);
  }, [winner]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* 上部: タイマー */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3 sm:p-4">
        <TimerDisplay
          ms={displayRemaining.o}
          label={`${names.o}${myRole === 'o' ? '（あなた）' : ''}`}
          player="o"
          active={playing && currentTurn === 'o'}
          timed={timed}
        />
        <div className="mt-1 shrink-0 px-1 text-center font-display">
          <div className="hidden text-[10px] uppercase tracking-[0.3em] text-col-ui sm:block">
            versus bull 3D
          </div>
          <div className="font-mono text-sm text-col-ui">
            <span className="text-col-o">{score.o}</span>
            <span className="mx-1 opacity-50">-</span>
            <span className="text-col-x">{score.x}</span>
          </div>
        </div>
        <TimerDisplay
          ms={displayRemaining.x}
          label={`${names.x}${myRole === 'x' ? '（あなた）' : ''}`}
          player="x"
          active={playing && currentTurn === 'x'}
          timed={timed}
        />
      </div>

      {/* 残ピース表示 */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 font-mono text-xs sm:bottom-4 sm:left-4">
        <PieceCount player="o" left={piecesLeft.o} />
        <PieceCount player="x" left={piecesLeft.x} />
      </div>

      {/* リーチ表示トグル ＋ カメラビュー切替 */}
      <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4">
        <button
          onClick={onToggleThreats}
          className={[
            'rounded-md border px-2.5 py-1.5 font-display text-xs transition-colors',
            showThreats
              ? 'border-[#FF3B30]/70 bg-[#FF3B30]/15 text-white'
              : 'border-col-border bg-bg-surface text-col-ui hover:text-white',
          ].join(' ')}
          title="相手が次に4連を作れるマス（リーチ）を赤リングで警告"
        >
          リーチ警告 {showThreats ? 'ON' : 'OFF'}
        </button>
        <div className="flex gap-2">
          {([1, 2, 3] as CameraView[]).map((v) => (
            <button
              key={v}
              onClick={() => onSelectView(v)}
              className="h-9 w-9 rounded-md border border-col-border bg-bg-surface font-mono text-col-ui transition-colors hover:border-col-gold/60 hover:text-white"
              title={v === 1 ? 'トップ' : v === 2 ? 'デフォルト' : 'ドラマチック'}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* 手番インジケーター */}
      {playing && (
        <div className="absolute left-1/2 top-20 -translate-x-1/2 animate-blink font-display text-sm tracking-widest"
          style={{ color: currentTurn === 'o' ? '#F2F2F2' : '#AEB6C6' }}>
          {TEAM[currentTurn].name} の手番
          {mode !== 'local' && myRole === currentTurn ? ' — あなた' : ''}
        </div>
      )}

      {/* カウントダウン */}
      {countdown !== null && countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div key={countdown} className="animate-count-pop font-display text-[28vw] font-bold text-white/90">
            {countdown}
          </div>
        </div>
      )}

      {/* 切断通知 */}
      {disconnected && !winner && (
        <div className="absolute left-1/2 top-1/3 w-[90%] max-w-sm -translate-x-1/2 rounded-lg border border-[#E84040]/50 bg-bg-surface px-5 py-3 text-center text-sm text-col-ui">
          相手が切断されました。再接続を待っています…
        </div>
      )}

      {/* 結果オーバーレイ */}
      {winner && !reviewing && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-bg-void/70 px-5 backdrop-blur-sm">
          <div className="break-words text-center font-display text-3xl font-bold leading-tight text-col-gold drop-shadow-[0_0_18px_rgba(255,215,0,0.5)] sm:text-5xl">
            {resultText(winner).title}
          </div>
          <div className="mt-2 font-mono text-sm text-col-ui sm:text-base">{resultText(winner).sub}</div>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <button
              onClick={onRematch}
              disabled={rematchPending}
              className="rounded-lg border border-col-gold/60 bg-bg-surface px-6 py-3 font-display text-white transition-colors hover:bg-col-gold/10 disabled:opacity-50"
            >
              {rematchPending ? '相手を待っています…' : 'もう一度'}
            </button>
            <button
              onClick={onExit}
              className="rounded-lg border border-col-border bg-bg-surface px-6 py-3 font-display text-col-ui transition-colors hover:text-white"
            >
              メニューへ
            </button>
          </div>
          <button
            onClick={() => setReviewing(true)}
            className="mt-5 text-sm text-col-ui underline underline-offset-4 transition-colors hover:text-white"
          >
            盤面を確認する
          </button>
        </div>
      )}

      {/* 盤面確認モード: 結果を隠して盤面だけ表示（カメラ切替で観察可能） */}
      {winner && reviewing && (
        <div className="pointer-events-auto absolute bottom-16 left-1/2 -translate-x-1/2 sm:bottom-20">
          <button
            onClick={() => setReviewing(false)}
            className="rounded-full border border-col-gold/60 bg-bg-surface/90 px-5 py-2 font-display text-sm text-white shadow-lg backdrop-blur transition-colors hover:bg-col-gold/10"
          >
            結果へ戻る
          </button>
        </div>
      )}
    </div>
  );
}

function PieceCount({ player, left }: { player: Player; left: number }) {
  const color = player === 'o' ? '#F2F2F2' : '#AEB6C6';
  return (
    <div className="flex items-center gap-2 rounded-md border border-col-border bg-bg-surface/80 px-2 py-1">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-col-ui">
        <span style={{ color }}>{TEAM[player].tag}</span>
        <span className="ml-1 opacity-70">{TEAM[player].name}</span>
      </span>
      <span style={{ color }}>{left}</span>
      <span className="text-col-ui/50">/ {INITIAL_PIECES}</span>
    </div>
  );
}
