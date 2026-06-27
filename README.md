# versus bull 3D (vsb3)

4×4のボードにO（マル）/X（バツ）のピースを積み上げ、**立体空間で縦・横・斜め・階段状いずれか4連**を作ると勝利する3D版まるばつゲーム。
React 18 + Three.js (@react-three/fiber) + Firebase Realtime Database + GitHub Pages。

- **オンライン対戦**: ルームを作成し、招待リンクを共有して友人と対戦
- **ローカル対戦**: 同じ端末で2人が交互に操作
- **AI対戦**: Minimax（深さ3）+ α-β枝刈り
- **持ち時間**: 将棋式フィッシャークロック（初期5分・着手ごとに+15秒）

---

## ゲームルール

- ボードは **4×4（16マス）**。各マスの高さ制限はなく、何段でも積める。
- プレイヤーは **ORIGIN（O・マル・白・先攻）** と **XENOGENESIS（X・バツ・黒・後攻）** の2チーム。各32枚のピースを持つ。
- ターンごとに好きなマスへ1枚積む。
- **勝利条件**: 立体空間（4×4×高さ）で、自分のピースが**直線4連**になると勝利。
  - ヨコ（行・列・面内の斜め）／タテ（同じマスに4段）／ナナメ（階段状に1段ずつ上る斜めや、空間対角）すべてを判定。
- 64枚すべて置かれて勝者がいなければ引き分け。
- 自分の手番で残り時間が0になると時間切れ負け。

操作:

| 操作 | 挙動 |
|------|------|
| ドラッグ / スワイプ | 視点回転 |
| ホイール / ピンチ | ズーム |
| キー `1` / `2` / `3`、または右下ボタン | トップ / デフォルト / ドラマチック視点 |
| マスをクリック / タップ | 着手 |

---

## セットアップ

### 1. 依存をインストール

```bash
npm install
```

### 2. Firebase を準備（オンライン対戦を使う場合）

オンライン対戦には Firebase Realtime Database が必要です（ローカル / AI 対戦だけなら不要）。

1. <https://console.firebase.google.com/> でプロジェクトを作成
2. 左メニュー **Build → Realtime Database** を開き **データベースを作成**（ロケーションを選択）
3. **Build → Realtime Database → ルール** を開き、本リポジトリの `database.rules.json` の内容を貼り付けて公開
   （友人招待用の簡易ルールです。誰でも読み書きできる点に注意）
4. **プロジェクトの設定 → マイアプリ → ウェブアプリを追加** し、表示される `firebaseConfig` の値を控える

### 3. `.env` を作成

`.env.example` をコピーして値を埋めます。

```bash
cp .env.example .env
```

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=https://xxxx-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

> これらはクライアント公開前提の値で、ビルド成果物に含まれます。書き込み制御は Realtime Database のセキュリティルールで行います（本構成では簡易ルールのため、信頼できる相手との対戦を想定）。

### 4. ローカル起動

```bash
npm run dev
```

---

## GitHub Pages へデプロイ

配信先リポジトリ: <https://github.com/shitake-zense/versus-bull-3D>
（`vite.config.ts` の `base` と `package.json` の `homepage` はこのリポジトリ用に設定済み）

```bash
# 1. まだ push していなければ main を push
git push -u origin main

# 2. 本番ビルド + gh-pages ブランチへ公開（1コマンド）
npm run deploy
```

`predeploy` で本番ビルドが走り、`gh-pages` ブランチへ `dist/` が公開されます。
初回のみ GitHub の **Settings → Pages** で Source が `gh-pages` ブランチ（`/root`）になっていることを確認してください。

公開URL: <https://shitake-zense.github.io/versus-bull-3D/>

トップで「オンライン対戦」→ ルーム作成すると招待リンクが自動でクリップボードにコピーされます。
そのリンク（`https://shitake-zense.github.io/versus-bull-3D/?room=<roomId>`）を友人に送ると、相手がアクセスした時点で対戦が始まります。
※ オンライン対戦には別途 Firebase の設定（`.env`）が必要です（上記「セットアップ」参照）。

---

## 開発メモ

- `src/lib/gameLogic.ts` … 勝利判定・盤面操作の純粋関数（UI/AI/同期の共通基盤）
- `src/lib/ai.ts` … Minimax + α-β
- `src/hooks/useGameLogic.ts` … ローカル/AI の状態機械
- `src/hooks/useFirebaseRoom.ts` … オンライン同期（サーバー時刻補正・トランザクション勝敗確定）
- `src/components/*3D.tsx` … Three.js 描画

### 将来拡張 (TODO)
- ブロッカーピース（`gameLogic.ts` の `legalMoves` に除外ロジックを追加する想定）
- Firebase セキュリティルールの厳格化（手番・スキーマ検証）
- firebase / three の動的 import によるバンドル分割
