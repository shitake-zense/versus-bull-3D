# versus bull 3D (vsb3)

### ▶ いますぐプレイ: <https://shitake-zense.github.io/versus-bull-3D/>

選べる盤面（既定 4×4 のほか、八角形 / 菱形 / 十字の特殊形状）にO（マル）/X（バツ）のピースを積み上げ、**立体空間で縦・横・斜め・階段状いずれか4連**を作ると勝利する3D版まるばつゲーム。
React 18 + Three.js (@react-three/fiber) + Firebase Realtime Database + GitHub Pages。

- **オンライン対戦**: ルームを作成し、招待リンクを共有して友人と対戦。ロビーで盤面形状・持ち時間・先手・落下ブロック数・プレイヤー名を設定可能。**2vs2チーム戦**にも対応
- **ローカル対戦**: 同じ端末で2人が交互に操作
- **AI対戦**: Minimax + 反復深化 + α-β枝刈り。**難易度4段階**（やさしい / ふつう / つよい / 最強）
- **AI観戦**: AI同士の自動対局を眺めるモード
- **盤面形状**: 4×4 / 八角形 / 菱形 / 十字（すべて対称で公平）
- **落下ブロック（トラップ）**: 予告されたマスの1段下が埋まると、どちらの4連にも使えない中立ブロックが降る（0〜3個）
- **持ち時間**: 将棋式フィッシャークロック。プリセット（基本 1/3/5/10分 ＋ 加算 0/5/15/30秒）と**無制限**から選択
- **先攻/後攻**: オンラインはホストが先攻/後攻/ランダムを選択、AIは手番をランダムにも設定可
- **プレイ補助**: リーチ警告（相手が次に4連を作れるマスを赤リングで強調）／直前着手マーカー／2クリック仮置き／終局後の盤面確認とリプレイ／直前着手を追うカメラ
- **サウンド**: 効果音（Web Audio 合成）と BGM（既定オフ・切替可）

---

## ゲームルール

- ボードは **選択した形状**（既定は 4×4＝16マス。特殊形状は八角形 / 菱形 / 十字）。各マスは **最大10段**まで積める。
- プレイヤーは **ORIGIN（O・マル・白・先攻）** と **XENOGENESIS（X・バツ・黒・後攻）** の2チーム。手持ちのピース数は形状のマス数×2（4×4なら各32枚）。
- ターンごとに好きなマスへ1枚積む。
- **勝利条件**: 立体空間（盤面×高さ）で、自分のピースが**直線4連**になると勝利。
  - ヨコ（行・列・面内の斜め）／タテ（同じマスに4段）／ナナメ（階段状に1段ずつ上る斜めや、空間対角）すべてを判定。
  - 中立の落下ブロックや盤の穴（特殊形状のプレイ不可マス）はラインを断つ。
- 両者の手持ちを置ききって勝者がいなければ引き分け。
- 自分の手番で残り時間が0になると時間切れ負け（無制限設定を除く）。

操作:

| 操作 | 挙動 |
|------|------|
| マスをクリック / タップ（1回目） | 仮置き（自分だけに見えるゴースト。相手には未送信） |
| 同じマスをもう一度クリック / タップ | 着手を確定 |
| 別のマスをクリック / タップ | 仮置きをそのマスへ移動 |
| キー `1` / `2` / `3`、または右下ボタン | トップ / デフォルト / ドラマチック視点 |
| 右下「リーチ警告 ON/OFF」 | 相手の即勝ちマス表示の切替 |

> 視点は3つのプリセット切替に加え、ドラッグで自由回転・ホイールでズームできる（OrbitControls）。

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

公開URL: <https://shitake-zense.github.io/versus-bull-3D/>
配信先リポジトリ: <https://github.com/shitake-zense/versus-bull-3D>
（`vite.config.ts` の `base` と `package.json` の `homepage` はこのリポジトリ用に設定済み）

**デプロイ = `main` への push**。`.github/workflows/deploy.yml` が GitHub Actions でビルドし、Pages へ自動公開します。

```bash
git push        # main へ push すると Actions が build → Pages 公開を実行
```

初回のみ GitHub の **Settings → Pages** で Source が **「GitHub Actions」** になっていることを確認してください。
（`gh-pages` ブランチ方式の `npm run deploy` も残っていますが、非対話シェルでは認証が不安定なため Actions 経路を推奨）

### 招待して対戦するには

トップで「オンライン対戦」→ ルーム作成すると招待リンクが自動でクリップボードにコピーされます。
そのリンク（`https://shitake-zense.github.io/versus-bull-3D/?room=<roomId>`）を友人に送ると、双方がロビーに入り、**ホストの「対戦開始」**で始まります。
※ 公開サイトには Firebase 設定が同梱されているのでそのまま対戦できます。自分の Firebase で動かす場合のみ `.env` 設定が必要です（上記「セットアップ」参照）。

---

## 開発メモ

- `src/lib/gameLogic.ts` … 勝利判定・盤面操作の純粋関数（UI/AI/同期の共通基盤）
- `src/lib/ai.ts` … Minimax + 反復深化 + α-β（難易度 `LEVELS` で思考時間・読み深さ・ミス率を切替）
- `src/lib/timeControl.ts` … 持ち時間プリセットとヘルパー（無制限・正規化・表示整形）
- `src/hooks/useGameLogic.ts` … ローカル/AI の状態機械
- `src/hooks/useFirebaseRoom.ts` … オンライン同期（サーバー時刻補正・トランザクション勝敗確定・ルーム設定）
- `src/components/*3D.tsx` … Three.js 描画

詳しい設計指針は [CLAUDE.md](./CLAUDE.md)、今後の開発方針・優先度は [ROADMAP.md](./ROADMAP.md) を参照。

### 将来拡張
ヒント機能、AI思考の可視化、戦績・統計、Firebase ルール厳格化など。詳細と優先度（実装済み項目を含む）は [ROADMAP.md](./ROADMAP.md) にまとめています。
