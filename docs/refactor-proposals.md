# リファクタリング提案書（実装保留分）

> `refactor-instructions.md` の Phase 6 成果物。**この文書の項目は未実装**。ユーザーが読んだ上で
> 実装可否を判断するためのもの。根拠はすべて `ファイル:行` 付き（行番号は 2026-07-02 時点）。
> 本体リファクタ（Phase 1〜5）で D1/D2/D4/D5/D6/D7/D8/D10 は実装済み・push 済み。
> ここに残すのは **D3・D9・D11・D12**。

---

## D3. モジュールグローバル `GEO` の明示引数化（最重要・要判断）

### 現状と問題
- `src/lib/gameLogic.ts:97` に `let GEO: BoardGeometry = buildGeometry('square')` というモジュールレベル
  可変状態がある。`setBoardShape(id)`（`gameLogic.ts:100`）で差し替え、以下の純関数群が**暗黙に**これを読む:
  `boardGeometry`/`boardDim`/`boardCellCount`/`isActiveCell`/`initialPieces`/`winLines`/`pieceAt`/
  `createEmptyBoard`/`legalMoves`/`pickTraps`/`checkWinAt`/`scanWin`/`lineFrom`/`recordToBoard`
  （＝gameLogic のほぼ全 API）。さらに `ai.ts` の `evaluate`/`orderedMoves` が `boardDim`/`isActiveCell` を、
  両フックと App がこれらを間接利用する。
- **レンダー時副作用**: `App.tsx:120` が**レンダー本文中**に `setBoardShape(activeShape)` を呼ぶ。純関数が
  GEO を読む前に形状を確定させる必要があるため。React のレンダー純粋性違反（StrictMode では冪等なので
  顕在化していないだけ）。
- **呼び出し順依存**: ハンドラ内でも明示的に呼ぶ箇所がある（`App.tsx:294` `startOfflineRound`、
  `useFirebaseRoom.ts:275` の countdown→playing effect）。この順序依存が過去に実バグ（画面が真っ暗）を
  起こし、修正コミット 5e3baee で `Board3D.tsx:148-155` に**過渡フレーム用の防御コード**が入った
  （`board[cell]` が undefined になり得る1フレームを読み飛ばす）。

### なぜ負債か
全純関数が「純」ではなく暗黙のグローバルに依存する。テストは形状ごとに `setBoardShape` を明示する必要が
あり（実際 Phase 1 のテストはそうしている）、ファイル間の実行順に暗黙依存するリスクがある。呼び出し順の
正しさに正しさが依存し、既に一度クラッシュした。

### リスク
**高**。`BoardGeometry` を明示引数化すると gameLogic のほぼ全 API シグネチャが変わり、AI 探索ホット
パス（`checkWinAt`/`evaluate`/`legalMoves` は1手あたり数万〜数十万回呼ばれる）の性能・全モードの挙動に
波及する。

### 段階移行プラン（各ステップ単独でビルド・テストが通る）

**方針**: 一気に全シグネチャを変えず、「geo を明示的に受ける内部実装」を作り、現行のグローバル版を
その薄いラッパとして残す。呼び出し側を末端から順に geo 明示へ移し、最後にグローバルを消す。

- **Step 0（準備・低リスク）**: `BoardGeometry` を受け取る内部関数を新設する。例:
  `checkWinAtGeo(geo, board, cell, player)`。既存の `checkWinAt(board, cell, player)` は
  `checkWinAtGeo(GEO, board, cell, player)` を呼ぶだけのラッパにする。同様に `pieceAt`/`legalMoves`/
  `scanWin`/`lineFrom`/`createEmptyBoard`/`recordToBoard` にも geo 版を用意。
  - 変更: `gameLogic.ts` のみ。概算 +120〜160行（各関数のラッパ化）。
  - 検証: 既存の `*.test.ts` がそのまま緑（外部シグネチャ不変）。単独でビルド可。revert 容易（1ファイル）。

- **Step 1（AI ホットパス）**: `ai.ts` の探索は1局面で geo が不変なので、`getBestMove` の冒頭で
  `const geo = boardGeometry()` を1回取得し、`SearchCtx.geo` に載せ、`evaluate`/`orderedMoves`/内部の
  `checkWinAtGeo`/`legalMovesGeo` へ geo を明示的に渡す。**グローバル読みをホットパスから消す**のが目的。
  - 変更: `ai.ts` のみ。概算 ±60行。
  - 性能: 下記「性能計測」で before/after を比較。ホットパスの `boardDim()`/`isActiveCell()` のプロパティ
    アクセスが引数参照に変わるだけなので**改善または不変**が見込み。
  - 検証: `ai.test.ts`（即勝ち・受け）緑。単独ビルド可。revert 容易。

- **Step 2（着手経路）**: `resolvePlacement`/`boardFromMoves` に geo を通す geo 版を追加し、
  `useGameLogic.place`/`useFirebaseRoom.place` は自分が持つ形状（App の `activeShape` /
  `room.boardShape`）から geo を解決して渡す。`createEmptyBoard`/`recordToBoard` も同様。
  - 変更: `gameLogic.ts`＋両フック。概算 ±80行。
  - 検証: `resolvePlacement.test.ts`＋4形状の手動スモーク。

- **Step 3（App のビュー導出）**: `App.tsx` の `board`/`threats`/`winLine` 導出を geo 明示版に切替え、
  **`App.tsx:120` のレンダー時 `setBoardShape` を削除**。`useFirebaseRoom.ts:275`・`App.tsx:294` の
  ハンドラ内 `setBoardShape` も削除。
  - 変更: `App.tsx`＋`useFirebaseRoom.ts`。概算 ±40行。
  - **この段階で Board3D の防御コードを外せる**（下記条件参照）。

- **Step 4（グローバル撤去）**: `GEO`/`setBoardShape`/`boardGeometry` と全ラッパを削除。geo 版を正式名に
  リネーム。
  - 変更: 全 gameLogic 利用箇所。概算 ±100行（機械的リネーム）。
  - 検証: 全テスト＋4形状×全モードの手動スモーク。

### 変更対象ファイルと概算行数（合計）
`gameLogic.ts`（中核・±300行）、`ai.ts`（±60）、`useGameLogic.ts`（±30）、`useFirebaseRoom.ts`（±40）、
`App.tsx`（±40）、`Board3D.tsx`（-8：防御コード撤去）、テスト（setBoardShape を geo 引数へ置換、±60）。
**総計 ±500行規模**。ただし大半は機械的置換で、Step ごとに分割コミット可能。

### AI 探索ホットパスへの性能影響の見立てと計測方法
- 見立て: グローバル `GEO` へのプロパティアクセス（`GEO.dim`, `GEO.holes.has(...)`）が、引数で渡した
  `geo.dim`/`geo.holes` に変わるだけ。V8 では両者ほぼ同等、むしろ引数のほうがモノモーフィックで有利な
  可能性。**性能劣化は考えにくい**が、ホットパスなので実測必須。
- 計測方法（既存規約の esbuild+node で可能）:
  ```bash
  # before（現行）と after（Step1適用ブランチ）で同一シードの局面を N 回探索し ms を比較
  npx esbuild bench.ts --bundle --platform=node --format=esm --outfile=bench.mjs && node bench.mjs
  ```
  `bench.ts` は固定局面（例: 中盤の 4×4 と octagon）に対し `getBestMove(..., 'max')` を 50 回回し、
  `performance.now()` 合計と1手あたり平均を出す。**5%以上の劣化があれば Step1 を見直す**（geo を
  クロージャに閉じ込める等）。

### リスクと退路
- 各 Step は**単独でビルド・テストが緑**になるよう設計。問題が出た Step だけを `git revert` すれば
  前の緑状態へ戻れる（グローバル版ラッパを残す限り、途中状態も常に動く）。
- 最大の危険は Step3（レンダー時副作用の撤去）。ここで形状切替の初回フレームに board 長と activeCells が
  食い違うと再び真っ暗になる。**Board3D の防御コードは Step3 が完全に検証できるまで残す**。

### Board3D の防御コード（`Board3D.tsx:148-155`）を除去できる条件
以下がすべて満たされたとき:
1. `App.tsx` が Board3D へ渡す `board`（=`viewBoard`）と `activeCells`（=GEO 由来）が**常に同一形状から
   導出**され、レンダー中に形状が切り替わっても両者が同一フレームで整合する
   （geo を props で一貫して流す形になっている）。
2. レンダー時 `setBoardShape` を撤去済み（Step3 完了）で、`board[cell]` が undefined になる過渡フレームが
   構造的に発生しないことを、4形状×（ローカル開始／オンライン形状変更→開始／再戦）で確認済み。
3. 上記を確認する手動スモーク手順が README か本書に記録されている。

---

## D9. AI のモジュールグローバル `deadline` / `nodeCounter`（低優先）

### 現状
`ai.ts:53-54` の `let deadline = 0` / `let nodeCounter = 0` はモジュールグローバル。`getBestMove`
（`ai.ts:87-88`）で初期化し、`checkTime`（`ai.ts:58`）が全ノードでインクリメント・比較する。

### なぜ負債か
単一スレッド・同期実行なので**実害はない**が、再入不可（探索中に別探索を始められない）・テスト間干渉の芽。

### 改善案
`SearchCtx`（`ai.ts:46`）へ `deadline`/`nodeCounter` を移す。**D3 の Step1（SearchCtx へ geo を載せる）と
同時に実施するのが効率的**（どちらも SearchCtx の拡張＋ホットパス）。

### リスク・計測
`checkTime` は全ノードで呼ばれるホットパス。オブジェクトプロパティのインクリメント
（`ctx.nodeCounter++`）はローカル変数より僅かに遅い可能性があるため、D3 と同じ bench で計測する。
劣化が出るなら `checkTime` にカウンタをローカルで持ち回る形にする退路あり。

### 実装可否
提案のみ。D3 と抱き合わせで判断。

---

## D11. HUD の props 過多と AI 設定 state の二重持ち（費用対効果低）

### 現状
- `HUD.tsx:11-69` はフラットな props を 40 個超受け取る（`countdown`/`score`/`replayIndex`/各トグル/
  各コールバック…）。変更のたびに App→HUD の props バケツリレーが伸びる。
- `App.tsx:40-43` の `aiLevel`/`watchLevelO`/`watchLevelX` と `RoomLobby.tsx` 側の同種 state が別々に
  存在し、対局開始時にコールバック（`onAI`/`onWatch`）で App 側へ写している。

### なぜ負債か
現状**バグはない**。グルーピングは見た目・可読性の問題に近く、機能的必然性は薄い。

### 改善案（軽い整理のみ）
- HUD の props を意味単位でオブジェクトに束ねる: `replay: { index, total, playing, onSeek, onStep,
  onPlayToggle, onEnter, onExit }`、`toggles: { showThreats, followCam, bgmOn, onToggle... }`、
  `undo: { canTakeBack, request, onTakeBack, onRespond }` の3グループ程度。
- AI 設定 state はどちらか一方（App 側）に集約し、RoomLobby は制御コンポーネント化（値と setter を
  props で受ける）。

### 実装可否
**提案のみ**。費用対効果が低いので無理にやらない。着手するなら HUD の props グルーピングだけを1コミットで
（挙動不変・型で担保）。

---

## D12. rAF ベース時計はバックグラウンドタブで停止する（仕様確認要）

### 現状
`useFisherClock.ts` は `requestAnimationFrame`（`tick`）で残時間を表示計算し、0 到達で `onTimeout` を
一度だけ発火する。タブが非表示の間は rAF が止まるため、**復帰するまで `onTimeout` が発火しない**。
- オンラインでは相手クライアントが動いていれば `reportTimeout`（`useFirebaseRoom` のトランザクション、
  先勝ち）で裁定されるため実害は限定的。
- ローカル/AI では自分のタブが非表示＝そもそも操作していないので影響は小さい。

### 改善案（緩和）
`document` の `visibilitychange` を購読し、タブ復帰時に即時 tick（1回 `now` を読んで残時間を再計算し、
0 以下なら `onTimeout`）する。あるいは `setInterval`(1s) を rAF と併用して非表示中もチェックする。

### なぜ「仕様確認要」か
これは**タイムアウト裁定のタイミングを変える＝観測可能な挙動変更**。特にオンラインで「非表示にしていた
側が復帰した瞬間に自分の時間切れが確定する」挙動になる。現行（相手が裁定）とどちらが望ましいかは設計判断
なので、実装前にユーザー確認が必要。

### 実装可否
**提案のみ**。挙動変更を伴うため Stop And Ask 相当。

---

## まとめ（優先度）

| 項目 | 価値 | リスク | 推奨 |
|------|------|--------|------|
| D3 | 高（設計健全化・テスト容易化） | 高（全 API・ホットパス） | 段階移行するなら Step0→1 で性能確認してから継続判断 |
| D9 | 低 | 低〜中（ホットパス） | D3 Step1 と抱き合わせ |
| D11 | 低 | 低 | 気が向いたら HUD props グルーピングのみ |
| D12 | 中 | 中（挙動変更） | 仕様を決めてから |

D3 は Step0（ラッパ導入・外部シグネチャ不変・1ファイル・全テスト緑）だけでも「純関数が geo を明示的に
受けられる」土台になり、以降を止めても損はない。**まず Step0＋Step1 の性能計測**を回し、劣化がないことを
確認してから Step2 以降へ進むのが安全。
