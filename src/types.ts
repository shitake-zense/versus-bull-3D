// vsb3 共通型定義
// プレイヤー: o(マル・白・先攻) / x(バツ・黒・後攻)。Firebase キーもこの語に統一する。

export type Player = 'o' | 'x';

/** 1マスのスタック。配列の先頭が最下層、末尾が最上層。 */
export type Cell = Player[];

/** 盤面。length 16（4×4）。index = row * 4 + col。 */
export type Board = Cell[];

/** 1手の記録（リプレイ・棋譜用）。どのマスへどちらが置いたか。 */
export interface Move {
  cell: number;
  player: Player;
}

export type GameMode = 'online' | 'local' | 'ai';

/** AI の強さ。easy=接待〜max=全力。useGameLogic / ai.ts で参照。 */
export type AiLevel = 'easy' | 'normal' | 'hard' | 'max';

/** 持ち時間設定。baseMs<=0 は「無制限」を表す（タイマーを動かさない）。 */
export interface TimeControl {
  /** 初期持ち時間(ms)。0 以下で無制限 */
  baseMs: number;
  /** フィッシャー加算(ms) */
  incrementMs: number;
}

/** 先手（最初に着手する側）の希望。'random' は対局開始時に o/x へ解決。 */
export type TurnPref = Player | 'random';

export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export type Winner =
  | null
  | 'o'
  | 'x'
  | 'draw'
  | 'timeout_o'
  | 'timeout_x';

/** 勝利を構成する1ピースの3D位置 */
export interface WinCoord {
  /** cellIndex（0-15） */
  cell: number;
  /** 高さ層（0 = 最下層） */
  layer: number;
}

/** 勝利ライン（3D空間の4連）。横・縦・斜め・階段状すべてを表現できる。 */
export interface WinLine {
  /** 構成する4ピースの座標 */
  coords: WinCoord[];
  player: Player;
}

/** 純粋なゲーム状態（描画・ロジック共通のスナップショット） */
export interface GameState {
  board: Board;
  currentTurn: Player;
  piecesLeft: Record<Player, number>;
  winner: Winner;
  winLine: WinLine | null;
}

/** Firebase /rooms/{roomId} のスキーマ */
export interface RoomData {
  status: RoomStatus;
  players: {
    o: PlayerSlot | null;
    x: PlayerSlot | null;
  };
  /** { [cellIndex]: Player[] }。空マスはキー自体が無い場合がある。 */
  board: Record<string, Player[]> | null;
  currentTurn: Player;
  /** 現在の手番が始まったサーバー時刻(ms)。タイマー計算の基準。 */
  turnStartedAt: number;
  piecesLeft: { o: number; x: number };
  winner: Winner;
  createdAt: number;
  /** 再戦リクエスト（両者 true で新ゲーム開始） */
  rematch?: { o?: boolean; x?: boolean };
  /** 持ち時間設定（ホストが設定。未設定の旧ルームはデフォルト 5分+15秒） */
  timeControl?: TimeControl;
  /** 先手の希望（ホスト視点。o=ホスト先攻 / x=ホスト後攻 / random）。開始時に解決 */
  turnPref?: TurnPref;
  /** 直前の着手（待った＝undo の巻き戻しに使用） */
  lastMove?: Move | null;
  /** 待った（手戻し）申請。承認制：by=申請者、相手の承認で成立する */
  undo?: { by: Player } | null;
}

export interface PlayerSlot {
  name: string;
  connected: boolean;
  /** 残り持ち時間(ms) */
  timeRemaining: number;
  /** セッション固有ID（自分のスロット特定用） */
  uid?: string;
}
