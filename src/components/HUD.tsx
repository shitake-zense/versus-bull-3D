// 3Dキャンバスの上に React DOM で重ねる2D HUD。
// タイマー・手番・残ピース・スコア・カメラ切替・結果/再戦を表示する。

import type { ReactNode } from 'react';
import type { GameMode, Player, RoomStatus, Seat, Winner } from '../types';
import { INITIAL_PIECES } from '../lib/gameLogic';
import { TEAM } from '../lib/teams';
import { seatSuffix } from '../lib/seats';
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
  /** 2vs2 チーム戦か */
  teamMode: boolean;
  /** チーム戦のメンバー名簿（o/x それぞれ [席1, 席2]）。1vs1 は null */
  roster: { o: string[]; x: string[] } | null;
  /** 今この手を指す人の表示名 */
  activeName: string;
  /** 手番の人が自分か（「あなた」表示用） */
  activeIsMe: boolean;
  /** 今この手を指す席（チーム戦のメンバーハイライト用） */
  activeSeat: Seat;
  countdown: number | null;
  disconnected: boolean;
  showThreats: boolean;
  onToggleThreats: () => void;
  /** BGM再生中か */
  bgmOn: boolean;
  onToggleBgm: () => void;
  onSelectView: (v: CameraView) => void;
  onRematch: () => void;
  onExit: () => void;
  rematchPending?: boolean;
  /** 設定を変えて再戦（オンライン・ホストのみ、ロビーへ戻す）。null なら非表示 */
  onReturnToLobby?: (() => void) | null;
  /** 待った（手戻し）が可能か */
  canTakeBack: boolean;
  onTakeBack: () => void;
  /** オンラインの待った申請（承認待ち）。なければ null */
  undoRequest: { by: Player } | null;
  onRespondUndo: (accept: boolean) => void;
  /** リプレイ／盤面確認モードか */
  reviewing: boolean;
  /** 表示中の手数（0〜replayTotal） */
  replayIndex: number;
  /** 総手数 */
  replayTotal: number;
  /** 自動再生中か */
  replayPlaying: boolean;
  onReviewEnter: () => void;
  onReviewExit: () => void;
  onReplaySeek: (i: number) => void;
  onReplayStep: (delta: number) => void;
  onReplayPlayToggle: () => void;
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
    teamMode,
    roster,
    activeName,
    activeIsMe,
    activeSeat,
    countdown,
    disconnected,
    showThreats,
    onToggleThreats,
    bgmOn,
    onToggleBgm,
    onSelectView,
    onRematch,
    onExit,
    rematchPending,
    onReturnToLobby,
    canTakeBack,
    onTakeBack,
    undoRequest,
    onRespondUndo,
    reviewing,
    replayIndex,
    replayTotal,
    replayPlaying,
    onReviewEnter,
    onReviewExit,
    onReplaySeek,
    onReplayStep,
    onReplayPlayToggle,
  } = props;

  const playing = status === 'playing' && !winner;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* 上部: タイマー */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3 sm:p-4">
        <TimerDisplay
          ms={displayRemaining.o}
          label={`${names.o}${!teamMode && myRole === 'o' ? '（あなた）' : ''}`}
          player="o"
          active={playing && currentTurn === 'o'}
          timed={timed}
          sub={
            teamMode && roster ? (
              <TeamRoster members={roster.o} seats={['o', 'o2']} activeSeat={activeSeat} />
            ) : undefined
          }
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
          label={`${names.x}${!teamMode && myRole === 'x' ? '（あなた）' : ''}`}
          player="x"
          active={playing && currentTurn === 'x'}
          timed={timed}
          sub={
            teamMode && roster ? (
              <TeamRoster members={roster.x} seats={['x', 'x2']} activeSeat={activeSeat} />
            ) : undefined
          }
        />
      </div>

      {/* 残ピース表示 */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 font-mono text-xs sm:bottom-4 sm:left-4">
        <PieceCount player="o" left={piecesLeft.o} />
        <PieceCount player="x" left={piecesLeft.x} />
      </div>

      {/* 待った ＋ リーチ表示トグル ＋ カメラビュー切替 */}
      <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4">
        {canTakeBack && (
          <button
            onClick={onTakeBack}
            className="rounded-md border border-col-gold/60 bg-bg-surface px-2.5 py-1.5 font-display text-xs text-white transition-colors hover:bg-col-gold/10"
            title={mode === 'online' ? '直前の自分の手を取り消す（相手の承認が必要）' : '直前の手を取り消す'}
          >
            待った{mode === 'online' ? '（申請）' : ''}
          </button>
        )}
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
        <button
          onClick={onToggleBgm}
          className={[
            'rounded-md border px-2.5 py-1.5 font-display text-xs transition-colors',
            bgmOn
              ? 'border-col-gold/70 bg-col-gold/15 text-white'
              : 'border-col-border bg-bg-surface text-col-ui hover:text-white',
          ].join(' ')}
          title="BGM（落ち着いたアンビエント）の再生切替"
        >
          ♪ BGM {bgmOn ? 'ON' : 'OFF'}
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
          {teamMode ? `${activeName}（${TEAM[currentTurn].name}）の手番` : `${activeName} の手番`}
          {activeIsMe ? ' — あなた' : ''}
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

      {/* 待った（手戻し）申請の通知 */}
      {undoRequest && !winner && (
        <div className="pointer-events-auto absolute left-1/2 top-1/3 w-[90%] max-w-sm -translate-x-1/2 rounded-lg border border-col-gold/50 bg-bg-surface px-5 py-4 text-center shadow-xl">
          {undoRequest.by === myRole ? (
            <div className="text-sm text-col-ui">待ったを申請中… 相手の承認を待っています</div>
          ) : (
            <>
              <div className="text-sm text-white">
                <span className="font-display">{names[undoRequest.by]}</span> が待ったを申請しています
              </div>
              <div className="mt-3 flex justify-center gap-3">
                <button
                  onClick={() => onRespondUndo(true)}
                  className="rounded-md border border-col-gold/60 bg-bg-surface px-5 py-2 font-display text-sm text-white transition-colors hover:bg-col-gold/10"
                >
                  承認
                </button>
                <button
                  onClick={() => onRespondUndo(false)}
                  className="rounded-md border border-col-border bg-bg-surface px-5 py-2 font-display text-sm text-col-ui transition-colors hover:text-white"
                >
                  却下
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 結果オーバーレイ */}
      {winner && !reviewing && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-bg-void/70 px-5 backdrop-blur-sm">
          <div className="break-words text-center font-display text-3xl font-bold leading-tight text-col-gold drop-shadow-[0_0_18px_rgba(255,215,0,0.5)] sm:text-5xl">
            {resultText(winner).title}
          </div>
          <div className="mt-2 font-mono text-sm text-col-ui sm:text-base">{resultText(winner).sub}</div>
          {/* 累計スコア（再戦のたびに伸びていく） */}
          <div className="mt-5 flex items-center gap-3 font-mono text-lg sm:text-2xl">
            <span style={{ color: '#F2F2F2' }}>{names.o}</span>
            <span className="text-col-o">{score.o}</span>
            <span className="opacity-40">-</span>
            <span className="text-col-x">{score.x}</span>
            <span style={{ color: '#AEB6C6' }}>{names.x}</span>
          </div>
          <div className="mt-7 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
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
          {onReturnToLobby && !rematchPending && (
            <button
              onClick={onReturnToLobby}
              className="mt-4 text-sm text-col-ui underline underline-offset-4 transition-colors hover:text-white"
            >
              設定を変えて再戦（ロビーへ）
            </button>
          )}
          <button
            onClick={onReviewEnter}
            className="mt-5 text-sm text-col-ui underline underline-offset-4 transition-colors hover:text-white"
          >
            リプレイ・盤面を確認する
          </button>
        </div>
      )}

      {/* リプレイ／盤面確認モード: 結果を隠し、棋譜を1手ずつ振り返る */}
      {winner && reviewing && (
        <div className="pointer-events-auto absolute bottom-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 sm:bottom-20">
          {replayTotal > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-col-border bg-bg-surface/90 px-3 py-2 shadow-lg backdrop-blur">
              <ReplayBtn title="最初へ" disabled={replayIndex <= 0} onClick={() => onReplaySeek(0)}>
                «
              </ReplayBtn>
              <ReplayBtn title="1手戻る" disabled={replayIndex <= 0} onClick={() => onReplayStep(-1)}>
                ‹
              </ReplayBtn>
              <ReplayBtn
                title={replayPlaying ? '一時停止' : '自動再生'}
                onClick={onReplayPlayToggle}
                accent
              >
                {replayPlaying ? '⏸' : '▶'}
              </ReplayBtn>
              <ReplayBtn
                title="1手進む"
                disabled={replayIndex >= replayTotal}
                onClick={() => onReplayStep(1)}
              >
                ›
              </ReplayBtn>
              <ReplayBtn
                title="最後へ"
                disabled={replayIndex >= replayTotal}
                onClick={() => onReplaySeek(replayTotal)}
              >
                »
              </ReplayBtn>
              <span className="ml-1.5 min-w-[3.75rem] text-center font-mono text-xs text-col-ui">
                {replayIndex} / {replayTotal} 手
              </span>
            </div>
          )}
          <button
            onClick={onReviewExit}
            className="rounded-full border border-col-gold/60 bg-bg-surface/90 px-5 py-2 font-display text-sm text-white shadow-lg backdrop-blur transition-colors hover:bg-col-gold/10"
          >
            結果へ戻る
          </button>
        </div>
      )}
    </div>
  );
}

function ReplayBtn({
  children,
  title,
  disabled,
  accent,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'flex h-9 w-9 items-center justify-center rounded-md border font-mono text-base transition-colors disabled:opacity-30',
        accent
          ? 'border-col-gold/60 bg-col-gold/10 text-white hover:bg-col-gold/20'
          : 'border-col-border bg-bg-surface text-col-ui hover:border-col-gold/60 hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** チーム戦のメンバー名簿（タイマー下に表示。手番のメンバーを強調）。 */
function TeamRoster({
  members,
  seats,
  activeSeat,
}: {
  members: string[];
  seats: Seat[];
  activeSeat: Seat;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] leading-tight">
      {members.map((name, i) => (
        <span
          key={seats[i]}
          className={seats[i] === activeSeat ? 'font-bold text-white' : 'text-col-ui/60'}
        >
          {seatSuffix[seats[i]]}
          {name}
        </span>
      ))}
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
