# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**versus bull 3D (vsb3)** — a 3D "立体まるばつ" (3D tic-tac-toe) game. 4×4 board, pieces stack up to `MAX_STACK` (10) high, win by getting 4-in-a-row anywhere in the 3D lattice (horizontal / vertical / staircase diagonal / space diagonal). Modes: local hotseat, AI, and online (Firebase) with友人-invite links. React 18 + Three.js (@react-three/fiber) + Firebase Realtime Database, deployed to GitHub Pages.

Two players, referenced everywhere by the `Player` type `'o' | 'x'`. These are the Firebase keys too. Display names live in `src/lib/teams.ts`: **O = ORIGIN** (white, first), **X = XENOGENESIS** (black, second). The game name "versus bull" is a pun (ox → O); don't rename the `'o'`/`'x'` keys.

## Commands

```bash
npm run dev        # Vite dev server (reads .env). URL has base: http://localhost:5173/versus-bull-3D/
npm run build      # tsc -b && vite build  (always run before claiming a change compiles)
npm run typecheck  # tsc -b --noEmit
npm run preview    # serve the production build locally
```

There is **no test framework and no linter**. To sanity-check pure logic (e.g. the AI or `gameLogic`), bundle a throwaway script with esbuild (a transitive dep) and run it with node — bundling is required because source imports are extensionless:

```bash
npx esbuild scratch.ts --bundle --platform=node --format=esm --outfile=scratch.mjs && node scratch.mjs
```

`tsconfig` uses `noUnusedLocals`/`noUnusedParameters`, so unused imports fail the build.

## Architecture

### Single source of truth: pure game logic
`src/lib/gameLogic.ts` is the副作用-free core used by UI, AI, and Firebase sync alike. The board is `Cell[]` (length 16, `index = row*4 + col`); each `Cell` is a `Player[]` stack (bottom→top). Win detection (`checkWinAt`, `scanWin`) treats the board as a 3D lattice `(col, row, layer)` and scans the **13 canonical directions** in `DIRECTIONS`. `WinLine` carries `coords: {cell, layer}[]` so wins can span layers. `WIN_LINES` (per-layer horizontal lines only) exists **solely for the AI heuristic** — it is NOT the win rule. A cell may hold at most `MAX_STACK` (10) pieces: `legalMoves(board, piecesLeftForPlayer)` and `isCellFull` filter full cells, and all three placement paths (`useGameLogic.place`, `useFirebaseRoom.place`, App's threat scan) reject/skip them. **Falling blocks (落下ブロック/トラップ)**: a stack element is a `StackPiece = Player | 'b'` where `'b'` (`BLOCK`) is a neutral obstacle usable by neither side. `pickTraps(count)` picks 0–3 telegraphed `Trap {cell, layer}` (layers weighted low, 1–3); when a placement brings that cell's height to `trap.layer` (i.e. the slot directly beneath is filled), `place` drops a `'b'` there via `triggeredTrap`/`applyBlock` (skipped on a winning move). Blocks live in the stack so heights/stacking stay contiguous; `scanWin` skips `'b'` starts and `lineFrom` naturally breaks on them (win detection otherwise unchanged). The AI threads traps through `SearchCtx.traps` and applies moves with `applyMoveWithTrap`; `evaluate` treats any window containing a block as dead. Local/AI store `traps` in `useGameLogic` state (regenerated on `newRound`); online stores `RoomData.traps` (+`trapCount`) — the host re-rolls at the `countdown→playing` transition and each rematch. `boardFromMoves(moves, count, traps)` re-simulates block drops for replay; App's move-history diff excludes `'b'` and uses a player-only piece count for undo truncation; `useFirebaseRoom.respondUndo` pops trailing `'b'` before the player's piece.

### Two state sources, unified in App.tsx
This is the key thing to understand before editing gameplay. `src/App.tsx` always calls **both** hooks and switches on `isOnline = mode === 'online'`:
- `useGameLogic` (`src/hooks/`) — authoritative state for **local, AI & watch** (board/turn/timers/score in React state; runs AI moves via `setTimeout`). The `aiSides: Partial<Record<Player, AiLevel>>` map decides which sides are AI-controlled and at what level: `{}` (local), `{[aiPlayer]: aiLevel}` (`'ai'`), or `{o: watchLevelO, x: watchLevelX}` (`'watch'` = AI vs AI spectate). The auto-move effect fires whenever the side to move is in `aiSides`, so `'watch'` self-plays to the end. `'watch'` has no human: `canHumanPlace`/`canUndo` are false.
- `useFirebaseRoom` — authoritative state for **online**; the RTDB room is the source of truth and this hook only subscribes/writes.

App derives a single "view model" (`board`, `activePlayer`, `winner`, `displayRemaining`, `canPlace`, `names`, `myRole`, `lastMove`, `threats`, `activeTimeControl`/`timed`, …) from whichever source is active, then feeds `Scene3D` + `HUD`. `lastMove` and `threats` are computed in App by diffing/scanning the unified `board` (so they work identically across local/AI/online). When changing turn/timer/win behavior, update **both** paths or the derivation in App.

### Fisher clock
`useFisherClock` is mode-agnostic: given `baseRemaining` (snapshot at turn start), `turnStartedAt`, and `serverOffset`, it computes live remaining via `requestAnimationFrame` and fires `onTimeout` once. Online passes `serverOffset` from `/.info/serverTimeOffset`; local passes 0. On a move, the new remaining is written as `prevRemaining - elapsed + incrementMs` and `turnStartedAt` resets to server time. The increment is **not hardcoded** — it comes from the active `TimeControl` (see below). When `timed={false}` (unlimited), the clock neither counts down nor times out, and `TimerDisplay` shows `∞`.

### Time control (`src/lib/timeControl.ts`)
A `TimeControl = { baseMs, incrementMs }` (with `baseMs <= 0` meaning **unlimited**) parameterizes持ち時間 everywhere — `useGameLogic` (local/AI), `useFirebaseRoom` (stored as `RoomData.timeControl`), and `useFisherClock` (`timed` flag). Presets (`BASE_PRESETS`/`INCREMENT_PRESETS`), `normalizeTimeControl` (coalesces Firebase `undefined`/legacy rooms → default 5min+15s), `isUnlimited`, and `formatTimeControl` live here. The lobby picker sets it; **don't reintroduce the old `START_TIME_MS`/`INCREMENT_MS` hardcoding** (those constants still exist in `gameLogic.ts` only as the default values).

### AI (`src/lib/ai.ts`)
Iterative-deepening minimax + α-β, **time-budgeted** (aborts via a thrown sentinel checked every 1024 nodes) so a move never freezes the UI. `getBestMove(board, piecesLeft, player, level, traps)` takes the side to move and an `AiLevel` (`easy/normal/hard/max`) — it is called with `cur.currentTurn` so the same function drives one AI (`'ai'`) or both (`'watch'`); the `LEVELS` table maps each to `{ timeBudgetMs, maxDepth, blunderRate }`. `blunderRate` is the chance of returning a random legal move **before** the immediate-win shortcut, so `easy` (0.45) even misses forced wins — this is the "接待/ミス率" weak-AI. `evaluate()` is 3D-aware (scans all 13 directions, weights "immediately completable" lines higher). Branching is always 16, so depth is bounded by the time budget, not a fixed number.

### 3D rendering & interaction
Plain `<mesh>` per piece (max 64 — no `instancedMesh`). `Piece3D` builds **O = a square frame from 4 boxes**, **X = 2 boxes crossed at 45°**, animates a drop on mount, and lerps emissive to gold on win; `ghost` prop renders the semi-transparent tentative piece (no drop, cyan pulse). `Board3D` raycasts via invisible per-cell planes at ground level (works even under tall stacks) and hosts the on-board overlays:
- **Two-click placement**: 1st click sets a local-only `tentative` ghost (never written to Firebase, so opponents never see it); clicking the **same** cell confirms (calls `onCellClick`), a **different** cell moves the tentative. Tentative resets when `canPlace` flips or the board changes.
- **`LastMoveMarker`** (magenta ring + arrow) over the most-recent move; **`ThreatMarker`** (red rings) over every cell where the opponent could complete 4-in-a-row next (リーチ警告, toggle in HUD). Both hidden once `winLine` exists.

`CameraController` wraps drei `OrbitControls` (pan disabled, distance/polar clamped) and has 3 view presets (keys 1/2/3) lerped over 600ms. `autoRotate` prop drives a slow auto-orbit (HUD「↻ 自動回転」toggle, `localStorage: vsb3.autoRotate`, default OFF); it is force-disabled while a preset lerp runs (`animating` state) so the two don't fight. The background space color is `#1C4A6E` (deep blue, so white-O/black-X both pop).

### Audio
Two independent systems. **SFX** (`useSound`) synthesizes blips via Web Audio (no assets). **BGM** (`useBgm`) loops a real audio file (`public/bgm/ambient.wav`) generated by `scripts/gen-bgm.mjs` — a low, slow, slightly mysterious track in two layers: (1) a sustained sine pad + sub-bass drone whose partials are `seam()`-rounded to an integer number of cycles over the 32s loop (so it wraps with no click), and (2) an event-based half-time groove (deep pitch-drop kick, warm bass ostinato on a moving root Am→F→G→E, syncopated ghost pulses). Each groove event starts/ends at zero amplitude and none are placed near the loop boundary, so the buffer still wraps seamlessly. Regenerate with `node scripts/gen-bgm.mjs`. BGM defaults **OFF**, is persisted to `localStorage` (`vsb3.bgm`), toggled from both the lobby and the HUD, and `preload='none'` so the file isn't fetched until enabled. Always prefix `import.meta.env.BASE_URL` on the `src` (GitHub Pages serves under `/versus-bull-3D/`).

## Firebase / online specifics

- **Config is committed** in `src/lib/firebase.ts` (`DEFAULT_CONFIG`, overridable by `VITE_FIREBASE_*` env). Web config is public-by-design; write protection is the DB rules (`database.rules.json` — currently fully open `.read/.write: true`, intended for trusted friend games). Do not treat the config as secret.
- **RTDB strips `null` on write**, so reads return `undefined` for absent keys and `update()` rejects `undefined`. Always coalesce (`?? null`) before writing — this caused a hard online bug.
- **Presence**: subscribe to `.info/connected` and, on every (re)connect, re-set `connected: true` and re-arm `onDisconnect(...).set(false)`. A one-time setup breaks on the WebSocket flaps common on mobile.
- **Identity**: per-room `uid` stored in **`sessionStorage`** (survives reload → reconnect to same slot, but unique per tab/device so two players are distinct). `localStorage` would break same-browser testing and two-tab play.
- **Lobby flow**: joining via invite link does NOT auto-start. Both players land in the lobby (`status: 'waiting'`); the **host (`'o'`)** presses 対戦開始 → `status: 'countdown'`; the host-only effect then transitions to `'playing'` with a server timestamp.
- **Rematch**: two paths, both host-safe. `fb.requestRematch` = **same-settings quick rematch** (both players opt in via `RoomData.rematch {o,x}`; when both true, a transaction resets board→`countdown`, re-rolls `turnPref`/traps, restores clocks). `fb.returnToLobby` (**host-only**, end screen「設定を変えて再戦」) = resets board→`status:'waiting'` so everyone returns to the lobby and the host can re-edit settings before pressing 対戦開始 again. Both **keep `score`, `players`, and the invite link**; only board/winner/rematch/traps/lastMove are cleared. App's `showLobby` keys off `status==='waiting'`, so the existing lobby UI is reused verbatim.
- **Room settings**: while `waiting`, the host edits `timeControl` + `turnPref` + `trapCount` (`fb.updateSettings`, all three passed together); either player edits their own slot name (`fb.updateName`, including the link-joining guest). `turnPref` (`'o'|'x'|'random'`, host's "先攻/後攻/ランダム") is resolved to a concrete starting player via `resolveStartingPlayer` **at game start and on every rematch** (so `random` re-rolls each game) — the host transition and the rematch transaction both set `currentTurn` from it and reset both clocks to `baseMs`. Slot identity stays fixed (creator=`'o'`); only who moves first changes.
- **待った (undo)**: local/AI is **immediate** (`useGameLogic` keeps a snapshot stack `history`; `undo()` pops 1 ply for local, or back to the human's turn — AI move + your move — for AI; `canUndo` is true for AI only on your turn). Online is **opponent-approved**: `RoomData.undo {by}` + `RoomData.lastMove {cell,player}` (written on every `place`, which also sets `undo:null` = implicit decline). `fb.requestUndo` (only when your last move exists = it's the opponent's turn) → opponent's `fb.respondUndo(accept)` runs a transaction that pops the top piece at `lastMove.cell`, restores `piecesLeft`, sets `currentTurn` back to the requester, and clears `lastMove`. App truncates `moveHistory` to the new ply count when the board **shrinks but isn't empty** (keeps replay consistent after a takeback). Online undo is **disabled in 2vs2 team mode**.
- **Score is room-authoritative** for online: `RoomData.score {o,x}` is incremented once per game-end inside `place` (4-in-a-row → `score/<winner>`) and `reportTimeout` (transaction). App just reads `room.score` — never counts locally (an earlier per-client count desynced between host and guest).
- **2vs2 team mode** (`RoomData.teamMode`): teams are still the board symbols `'o'`/`'x'`, each with **2 players**, so board/win/piece logic is unchanged. `src/lib/seats.ts` owns the seat model: seats `o|x|o2|x2`, `seatTeam()` folds a seat to its team, and the turn cycle is `o→x→o2→x2` (so the team alternates every ply, just like 1v1). `RoomData.players` gains optional `o2`/`x2` slots; `RoomData.currentSeat` tracks which teammate moves (board uses `currentTurn`=team). The **clock is team-shared** — `timeRemaining` lives on the `o`/`x` slots only and `place` always updates `players/<team>/timeRemaining`, so the existing 2-clock Fisher logic is untouched. `useFirebaseRoom` exposes `mySeat` (4 seats) alongside `myRole` (=team); `canPlace` is `mySeat === currentSeat`. Lobby fills seats in join order `o→x→o2→x2` and needs all `requiredSeats(teamMode)` filled to start. AI does not play team mode.

## Deployment

Live at `https://shitake-zense.github.io/versus-bull-3D/`. `vite.config.ts` `base` and `package.json` `homepage` are pinned to `/versus-bull-3D/`.

**Deploy = push to `main`.** `.github/workflows/deploy.yml` builds and deploys to Pages via GitHub Actions (Pages source must be "GitHub Actions" in repo settings). The `gh-pages` npm script exists but its git auth is unreliable from a non-interactive shell — prefer the Actions path.

`origin` is **SSH** (`git@github.com:shitake-zense/versus-bull-3D.git`); `git push` completes without prompting, so push directly. (Historically the remote was HTTPS and stalled on Git Credential Manager re-auth — that's no longer the case.)
