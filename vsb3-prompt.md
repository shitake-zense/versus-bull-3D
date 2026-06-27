# versus bull 3D (vsb3) — 実装プロンプト

> **対象モデル**: claude-opus-4-8  
> **スタック**: React 18 + Three.js + Firebase Realtime Database + GitHub Pages  
> **対戦形式**: 友人招待型（URLにroomIdを含む共有リンク）  
> **ゲームID**: `vsb3`

---

## あなたへの依頼

以下の仕様を満たす **versus bull 3D (vsb3)** のオンライン対戦Webアプリを実装してください。  
**すべてのファイルをコーディングし、デプロイ手順まで出力**することを期待します。

---

## ゲームルール

- ボードは **4×4 のグリッド（16マス）**
- 各マスの高さ制限は**なし**。ピースは何段でも積み重ねられる
- プレイヤーは **O（white・先攻）** と **X（black・後攻）** の2人
- 各プレイヤーのピース総数は **32枚**。手持ちがなくなった時点で置けない
- ターンごとに好きなマスへ1枚置く（スタックの上に重ねる）
- **勝利条件**: 水平方向（行・列・斜め）のいずれかに **自分のピースが4つ連続** で並んだら勝利  
  ※ 勝利判定は「同じ高さ層ごと」に行う。縦スタックは勝利にカウントしない
- 両プレイヤーの32枚が全て置かれ勝者がいない場合は**引き分け**
- ブロッカーピースは **未実装**（将来拡張として TODO コメントを残す）

### 持ち時間ルール（将棋式フィッシャークロック）

- 各プレイヤーに**初期持ち時間 5分（300秒）**
- ピースを置いた（着手確定した）タイミングで **+15秒** を自分の残り時間に加算
- 自分のターンに残り時間が 0 になった場合は**時間切れ負け**
- Firebase上で両プレイヤーの残り時間・タイマー開始時刻を同期する
- UIには残り時間をデジタル時計風で常時表示（赤くなる残り30秒）

---

## 3Dボード表示（重要・力を入れること）

### 使用ライブラリ

```
three           : Three.js 本体
@react-three/fiber  : React用バインディング
@react-three/drei   : OrbitControls、Text、useGLTF等のヘルパー
```

### カメラ・操作

| 操作 | 挙動 |
|------|------|
| マウスドラッグ / 指スワイプ | OrbitControls で水平・垂直回転 |
| ホイール / ピンチ | ズームイン・アウト |
| ダブルクリック / ダブルタップ | デフォルト俯瞰ビューにリセット |
| キーボード `1` | 真上（トップビュー） |
| キーボード `2` | 斜め上（デフォルトビュー, 仰角35°） |
| キーボード `3` | 水平視点（ドラマチックビュー） |

**カメラアニメーション**: ビュー切り替え時は `THREE.Vector3.lerp` で 600ms かけてスムーズに移動。

### ボード・ピースのジオメトリ

- **ボード面**: `PlaneGeometry` + グリッドライン（`GridHelper`）。マス境界を白い線で描画
- **ピース**: `CylinderGeometry`（半径0.38、高さ0.18）  
  - Bull: `#E84040`（赤）、メタリックマテリアル（`roughness: 0.3, metalness: 0.6`）  
  - Bear: `#3B82F6`（青）、同上
- **積み重ね**: y軸方向に `height * 0.2` ずつオフセット（隙間あり、物理的な積み上げ感）
- **ホバー**: マウスオーバーしたマスのピース置き場をシースルーの白リング（`TorusGeometry`）でプレビュー表示
- **クリック**: raycasting でマスを選択し着手
- **着手アニメーション**: ピースが上から落下してスタック上部に着地（y方向、300ms、イージング `easeOut`）

### 勝利エフェクト

- 勝利ライン上の4枚が金色に発光（`emissive: #FFD700, emissiveIntensity: 1.5`）
- `PointLight` をライン中央に生成して周囲を照らす

### ライティング

```
AmbientLight     intensity: 0.4
DirectionalLight intensity: 1.2, position: [5, 10, 5], castShadow: true
PointLight       intensity: 0.6, position: [-3, 6, -3]  ← 雰囲気用
```

---

## 機能要件

### ルームシステム

- トップページ: モード選択（オンライン / ローカル / AI）
- オンライン選択時: ルーム作成ボタン
- ルーム作成後: `https://[username].github.io/vsb3/?room=[roomId]` を**自動クリップボードコピー**してUIに表示
- 友人がリンクにアクセスすると自動でルームに参加し待機画面へ
- 2人揃ったらカウントダウン（3・2・1）後にゲーム開始
- ルームIDは `adjective-noun-3digit` 形式（例: `swift-bull-492`）
- 離脱検知: `onDisconnect` で相手に「切断されました」を通知

### 対戦モード

| モード | 概要 |
|--------|------|
| オンライン | Firebase Realtime Database でリアルタイム同期 |
| ローカル | 同一デバイスで2人が交互に操作（タイマーも動作） |
| AI | Minimax（深さ3）+ α-β 枝刈り。AIターン開始から 500〜900ms のランダム遅延後に着手 |

### HUD（2Dオーバーレイ、3Dキャンバスの上にReact DOMで重ねる）

- 各プレイヤーの残り時間（フィッシャークロック）
- 現在の手番インジケーター（点滅）
- 手持ちピース枚数（32枚から減る）
- セッション内スコア（Bull X勝 / Bear X勝）
- カメラビュー切り替えボタン（1 / 2 / 3）
- 「もう一度」ボタン（ゲーム終了後）

---

## 技術スタック

```
フレームワーク      : React 18 + Vite
3D                 : Three.js + @react-three/fiber + @react-three/drei
スタイリング        : Tailwind CSS
リアルタイムDB      : Firebase Realtime Database
ホスティング        : GitHub Pages（gh-pages）
言語               : TypeScript
```

---

## Firebaseデータ構造

```
/rooms/{roomId}/
  status       : "waiting" | "countdown" | "playing" | "finished"
  players:
    bull : { name, connected, timeRemaining: number }  // ミリ秒
    bear : { name, connected, timeRemaining: number }
  board        : { [cellIndex: 0-15]: string[] }       // 例: {"3": ["bull","bear","bull"]}
  currentTurn  : "bull" | "bear"
  turnStartedAt: number   // Unix timestamp (ms) — タイマー計算用
  piecesLeft   : { bull: number, bear: number }         // 各32枚からカウントダウン
  winner       : null | "bull" | "bear" | "draw" | "timeout_bull" | "timeout_bear"
  createdAt    : number
```

---

## デザイン方針（DESIGN.md）

**コンセプト**: 任せますが、牛の白vs黒対決のイメージ。ダークで緊張感があり、数字が動く。

**パレット**
| トークン | 値 | 用途 |
|----------|----|------|
| `bg-void` | `#080A0F` | キャンバス背景 |
| `bg-surface` | `#111318` | HUDカード背景 |
| `col-bull` | `#E84040` | Bullのピース・タイマー |
| `col-bear` | `#3B82F6` | Bearのピース・タイマー |
| `col-gold` | `#FFD700` | 勝利ライン発光 |
| `col-ui` | `#8B92A5` | テキスト・ラベル |
| `border` | `#1E2230` | HUD境界線 |

**タイポグラフィ**
- 時計表示: `DM Mono`（等幅、数字が飛ばない）
- 見出し・ロゴ: `Space Grotesk`
- UI全般: `Inter`

**シグネチャ要素**
- タイマーが残り30秒を切ると背景が `#E84040` に脈動（pulse アニメーション 1s）
- ピース着地時に短い「コン」音（Web Audio API で生成、500Hzサイン波 30ms）
- ゲーム開始カウントダウンのフォントサイズを画面全体に大きく表示

---

## ファイル構成

```
vsb3/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── Scene3D.tsx          # @react-three/fiber Canvas ラッパー
│   │   ├── Board3D.tsx          # ボード面・グリッド・ピース3Dオブジェクト
│   │   ├── Piece3D.tsx          # 1枚のピース（着地アニメ含む）
│   │   ├── CameraController.tsx # OrbitControls + ビュープリセット切り替え
│   │   ├── HUD.tsx              # 2Dオーバーレイ全体
│   │   ├── TimerDisplay.tsx     # フィッシャークロック表示
│   │   └── RoomLobby.tsx        # ルーム作成・参加画面
│   ├── hooks/
│   │   ├── useGameLogic.ts      # 盤面状態・勝利判定・ターン管理
│   │   ├── useFirebaseRoom.ts   # Firebase購読・書き込み
│   │   ├── useFisherClock.ts    # タイマーロジック
│   │   └── useSound.ts          # Web Audio API 効果音
│   ├── lib/
│   │   ├── gameLogic.ts         # 純粋関数: 勝利判定・合法手列挙
│   │   ├── ai.ts                # Minimax + α-β 枝刈り
│   │   ├── firebase.ts          # Firebase初期化
│   │   └── roomId.ts            # ルームID生成（adjective-noun-3digit）
│   └── types.ts                 # 共通型定義
├── public/
├── firebase.json
├── .env.example
├── vite.config.ts               # base: '/vsb3/'
├── package.json
└── README.md
```

---

## 実装上の重要な注意

### タイマーの同期

Firebase に `turnStartedAt` (サーバータイムスタンプ) を保存し、クライアント側で `Date.now() - turnStartedAt` を使って経過時間をローカル計算する。着手時に `timeRemaining - elapsed + 15000` を書き込む。サーバー時刻のズレ対策に `firebase.database.ServerValue.TIMESTAMP` を使用すること。

### raycasting とクリック判定

`useThree` フックで `raycaster` と `camera` を取得し、マスごとに invisible な `PlaneGeometry` を敷いてクリックを検知する。自分のターン以外はクリックを無効化する。

### パフォーマンス

ピースが積み上がるとオブジェクト数が増えるため、`instancedMesh` を使ってBull/Bearそれぞれ最大32個のインスタンスで描画する。

### セキュリティルール（firebase.json 内）

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

---

## README.md に含めること

1. Firebase プロジェクト作成〜Realtime Database 有効化（URL誘導のみ）
2. `.env` の設定方法（`.env.example` をコピーして値を埋める）
3. `npm run deploy` 1コマンドでGitHub Pagesへデプロイ完了
4. vsb3 ゲームルール要約（日本語）

---

## 出力フォーマット

各ファイルを以下の形式で**省略なく**出力してください：

```
=== src/components/Scene3D.tsx ===
（コード全文）
```

全ファイル出力後、最後に以下をまとめること：

```
## ユーザーがやること（手順）
1. ...
2. ...
```

---

## AI自律対応リスト（あなたが自分で判断・実装してよいこと）

- adjective/noun ワードリスト（ルームID生成用）の内容選定
- Web Audio API での効果音パラメーター調整
- OrbitControls の minDistance / maxDistance / minPolarAngle の値
- AI の評価関数のヒューリスティック詳細
- Tailwind のカスタムクラス定義
- ビルドスクリプト・依存関係のバージョン指定
- Three.js のマテリアル詳細パラメーター（roughness/metalness 等）
- エラーハンドリングのメッセージ文言
- カウントダウン演出の具体的アニメーション実装方法