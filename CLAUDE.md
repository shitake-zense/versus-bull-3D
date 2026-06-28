# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**versus bull 3D (vsb3)** — a 3D "立体まるばつ" (3D tic-tac-toe) game. 4×4 board, pieces stack to any height, win by getting 4-in-a-row anywhere in the 3D lattice (horizontal / vertical / staircase diagonal / space diagonal). Modes: local hotseat, AI, and online (Firebase) with友人-invite links. React 18 + Three.js (@react-three/fiber) + Firebase Realtime Database, deployed to GitHub Pages.

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
`src/lib/gameLogic.ts` is the副作用-free core used by UI, AI, and Firebase sync alike. The board is `Cell[]` (length 16, `index = row*4 + col`); each `Cell` is a `Player[]` stack (bottom→top). Win detection (`checkWinAt`, `scanWin`) treats the board as a 3D lattice `(col, row, layer)` and scans the **13 canonical directions** in `DIRECTIONS`. `WinLine` carries `coords: {cell, layer}[]` so wins can span layers. `WIN_LINES` (per-layer horizontal lines only) exists **solely for the AI heuristic** — it is NOT the win rule.

### Two state sources, unified in App.tsx
This is the key thing to understand before editing gameplay. `src/App.tsx` always calls **both** hooks and switches on `isOnline = mode === 'online'`:
- `useGameLogic` (`src/hooks/`) — authoritative state for **local & AI** (board/turn/timers/score in React state; runs the AI move via `setTimeout`).
- `useFirebaseRoom` — authoritative state for **online**; the RTDB room is the source of truth and this hook only subscribes/writes.

App derives a single "view model" (`board`, `activePlayer`, `winner`, `displayRemaining`, `canPlace`, `names`, `myRole`, `lastMove`, `threats`, `activeTimeControl`/`timed`, …) from whichever source is active, then feeds `Scene3D` + `HUD`. `lastMove` and `threats` are computed in App by diffing/scanning the unified `board` (so they work identically across local/AI/online). When changing turn/timer/win behavior, update **both** paths or the derivation in App.

### Fisher clock
`useFisherClock` is mode-agnostic: given `baseRemaining` (snapshot at turn start), `turnStartedAt`, and `serverOffset`, it computes live remaining via `requestAnimationFrame` and fires `onTimeout` once. Online passes `serverOffset` from `/.info/serverTimeOffset`; local passes 0. On a move, the new remaining is written as `prevRemaining - elapsed + incrementMs` and `turnStartedAt` resets to server time. The increment is **not hardcoded** — it comes from the active `TimeControl` (see below). When `timed={false}` (unlimited), the clock neither counts down nor times out, and `TimerDisplay` shows `∞`.

### Time control (`src/lib/timeControl.ts`)
A `TimeControl = { baseMs, incrementMs }` (with `baseMs <= 0` meaning **unlimited**) parameterizes持ち時間 everywhere — `useGameLogic` (local/AI), `useFirebaseRoom` (stored as `RoomData.timeControl`), and `useFisherClock` (`timed` flag). Presets (`BASE_PRESETS`/`INCREMENT_PRESETS`), `normalizeTimeControl` (coalesces Firebase `undefined`/legacy rooms → default 5min+15s), `isUnlimited`, and `formatTimeControl` live here. The lobby picker sets it; **don't reintroduce the old `START_TIME_MS`/`INCREMENT_MS` hardcoding** (those constants still exist in `gameLogic.ts` only as the default values).

### AI (`src/lib/ai.ts`)
Iterative-deepening minimax + α-β, **time-budgeted** (aborts via a thrown sentinel checked every 1024 nodes) so a move never freezes the UI. `getBestMove(board, piecesLeft, aiPlayer, level)` takes an `AiLevel` (`easy/normal/hard/max`); the `LEVELS` table maps each to `{ timeBudgetMs, maxDepth, blunderRate }`. `blunderRate` is the chance of returning a random legal move **before** the immediate-win shortcut, so `easy` (0.45) even misses forced wins — this is the "接待/ミス率" weak-AI. `evaluate()` is 3D-aware (scans all 13 directions, weights "immediately completable" lines higher). Branching is always 16, so depth is bounded by the time budget, not a fixed number.

### 3D rendering & interaction
Plain `<mesh>` per piece (max 64 — no `instancedMesh`). `Piece3D` builds **O = a square frame from 4 boxes**, **X = 2 boxes crossed at 45°**, animates a drop on mount, and lerps emissive to gold on win; `ghost` prop renders the semi-transparent tentative piece (no drop, cyan pulse). `Board3D` raycasts via invisible per-cell planes at ground level (works even under tall stacks) and hosts the on-board overlays:
- **Two-click placement**: 1st click sets a local-only `tentative` ghost (never written to Firebase, so opponents never see it); clicking the **same** cell confirms (calls `onCellClick`), a **different** cell moves the tentative. Tentative resets when `canPlace` flips or the board changes.
- **`LastMoveMarker`** (magenta ring + arrow) over the most-recent move; **`ThreatMarker`** (red rings) over every cell where the opponent could complete 4-in-a-row next (リーチ警告, toggle in HUD). Both hidden once `winLine` exists.

`CameraController` has 3 view presets (keys 1/2/3) lerped over 600ms. The background space color is `#1C4A6E` (deep blue, so white-O/black-X both pop).

## Firebase / online specifics

- **Config is committed** in `src/lib/firebase.ts` (`DEFAULT_CONFIG`, overridable by `VITE_FIREBASE_*` env). Web config is public-by-design; write protection is the DB rules (`database.rules.json` — currently fully open `.read/.write: true`, intended for trusted friend games). Do not treat the config as secret.
- **RTDB strips `null` on write**, so reads return `undefined` for absent keys and `update()` rejects `undefined`. Always coalesce (`?? null`) before writing — this caused a hard online bug.
- **Presence**: subscribe to `.info/connected` and, on every (re)connect, re-set `connected: true` and re-arm `onDisconnect(...).set(false)`. A one-time setup breaks on the WebSocket flaps common on mobile.
- **Identity**: per-room `uid` stored in **`sessionStorage`** (survives reload → reconnect to same slot, but unique per tab/device so two players are distinct). `localStorage` would break same-browser testing and two-tab play.
- **Lobby flow**: joining via invite link does NOT auto-start. Both players land in the lobby (`status: 'waiting'`); the **host (`'o'`)** presses 対戦開始 → `status: 'countdown'`; the host-only effect then transitions to `'playing'` with a server timestamp.
- **Room settings**: while `waiting`, the host edits `timeControl` + `turnPref` (`fb.updateSettings`); either player edits their own slot name (`fb.updateName`, including the link-joining guest). `turnPref` (`'o'|'x'|'random'`, host's "先攻/後攻/ランダム") is resolved to a concrete starting player via `resolveStartingPlayer` **at game start and on every rematch** (so `random` re-rolls each game) — the host transition and the rematch transaction both set `currentTurn` from it and reset both clocks to `baseMs`. Slot identity stays fixed (creator=`'o'`); only who moves first changes.

## Deployment

Live at `https://shitake-zense.github.io/versus-bull-3D/`. `vite.config.ts` `base` and `package.json` `homepage` are pinned to `/versus-bull-3D/`.

**Deploy = push to `main`.** `.github/workflows/deploy.yml` builds and deploys to Pages via GitHub Actions (Pages source must be "GitHub Actions" in repo settings). The `gh-pages` npm script exists but its git auth is unreliable from a non-interactive shell — prefer the Actions path.

`origin` is **SSH** (`git@github.com:shitake-zense/versus-bull-3D.git`); `git push` completes without prompting, so push directly. (Historically the remote was HTTPS and stalled on Git Credential Manager re-auth — that's no longer the case.)
