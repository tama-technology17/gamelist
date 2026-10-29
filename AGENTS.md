# AGENTS.md

Static site + small JSON-backed API. Browser code is vanilla ES Modules with no build step; the server is CommonJS Node with exactly **one** runtime dependency (`bcryptjs`). All UI copy and code comments are in **Indonesian** — match that when adding user-facing text.

## Run

```bash
npm install        # once, fetches bcryptjs
node server.js     # -> http://localhost:8080/?api=/api
```

- `npm start` is an alias for the same thing. Port defaults to 8080, override with `PORT`.
- ES modules do not work over `file://` — always use this server.
- There is no bundler and nothing to compile. Editing a file is the whole workflow.

## `package.json` must stay `"type": "commonjs"`

`server.js`, `db.js`, and `auth.js` use `require()`. Switching to `"type": "module"` breaks the entire backend. Browser files are the opposite (`.js` ESM) and rely on **no** package.json `"type"` field applying to them — which is why they are plain `.js`, never `.mjs`.

## Server-side vs browser-side files

The `*.js` names are easy to confuse. Three of them exist on **both** sides:

| Browser (ESM, sent to client) | Server (CommonJS, never sent) |
|---|---|
| `auth.js` → **doesn't exist** | `auth.js` (passwords, tokens) |
| `account.js` (account API client) | — |
| `comment.js` (comment API client + emoji data) | `comments.js` (note the `s`, comment storage) |
| `vote.js` (vote API client + score state) | `votes.js` (note the `s`, vote storage) |
| — | `jwt.js` (HS256 sign/verify) |
| `db.js` → **doesn't exist** | `db.js` (JSON store) |

`server.js` gates this with the `CLIENT_JS` **allowlist** in `server.js`, not a denylist: any `.js` not listed there 404s. That is what keeps `auth.js`, `db.js`, `comments.js`, `votes.js`, and `jwt.js` from being downloaded — they hold password hashes, session tokens, storage logic, and the JWT signing secret. When you add a browser module, add it to `CLIENT_JS` or it will silently 404 and the app will fail to boot entirely.

`account.js` and `comment.js` must never use `BASE` from `api.js`

`api.js` has a `BASE` that can point at FreeToGame directly or through the local proxy (and can be flipped by `?api=`). Account and comment endpoints only exist on this server, so both clients use hardcoded same-origin paths like `/api/me` and `/api/comments`. Mixing the two means those features silently break whenever the user changes `?api=`.

**404 from any call in `account.js`/`comment.js` means the server isn't `server.js`** (e.g. the user is on `python -m http.server`). That's translated into a friendly hint, not a raw error.

## Comments rules

The product decision, so it doesn't get accidentally "improved" away:

- **Anyone can post**, logged in or not. Anonymous requires a display name (2–24 chars); a logged-in user's name comes from their profile and cannot be spoofed.
- **Only the owner can edit or delete.** `owns()` compares `entry.author` (a username, or `null` for anonymous) — anonymous comments therefore have no owner and can never be edited by anyone.
- **Only registered users can like.** One like per username, stored as an array of usernames on the entry.
- **Text and emoji only.** No links, no images, no HTML. Rendered via `textContent`, so a URL in a comment stays plain text.

**`cleanText()` must preserve `\n` and `\t`.** They are `\p{Cc}` control characters, but stripping them collapses multi-line comments onto one line. They are kept explicitly via `KEEP_WHITESPACE`; everything else in `\p{Cc}`/`\p{Cf}` (zero-width chars, variation selectors) is dropped.

**Rate limiting happens after validation on comment POSTs.** If it ran first, a few invalid submissions would lock a legitimate user out. Related: `throttle()` no longer increments its counter once the bucket is already full, so a long blocked burst can't push the window arbitrarily far into the future.

**Never spread a single element into `replaceChildren(...)`.** `replaceChildren(...el)` throws `TypeError` even in a real browser. Always spread an array, or `append` the element separately. This bit the emoji picker's "no results" branch and the empty-comment state — and the latter was *masked* because `paint()` runs inside `load()`'s `try`, so it silently rendered an error box instead of the intended empty state.

## Token model (JWT access + opaque refresh)

Deliberate decision, don't "simplify" it away:

- **Access token is a JWT (HS256, 15 min), refresh token is opaque (30 days).** If both were JWTs, the only way to revoke is a denylist — making JWTs *weaker* than the opaque server-side sessions this replaced. The hybrid gives a short exposure window *and* real revocation.
- **`jwt.js` is hand-rolled on `node:crypto`, intentionally.** HS256 is exactly HMAC-SHA256 over `base64url(header).base64url(payload)`; a dependency buys nothing here. If you ever need JWK/RS256, revisit.
- **`jwt.verify()` must reject `alg !== 'HS256'`** — that check is what blocks `alg:none` and HS256-as-RSA-public-key attacks. Keep it before any signature work.
- **Refresh tokens are stored as SHA-256 hashes**; the raw value only ever exists in the cookie.
- **The `fid` claim is what makes logout instant.** Access tokens are stateless, so a valid signature alone would keep working for up to 15 minutes after logout. `isFamilyLive(payload.fid)` re-checks the rotation chain on every request. Any new session type must carry `fid` or it won't be revocable.
- **Rotation rows are kept, not deleted.** `rotateRefreshToken()` revokes the old row instead of removing it, because a revoked row's presence is exactly how reuse (token theft) is detected. `sweepSessions()` therefore only drops rows that are *both* expired and revoked.
- **Reuse revokes the whole family.** A rotated-then-replayed refresh token means two parties hold the same token; the server kills the entire chain rather than just that token.
- **The refresh cookie is `Path=/api/auth`.** It is not sent on `/api/me`, `/api/votes`, etc. Don't widen the path.
- **Tokens never enter JS.** Both cookies are `HttpOnly`; nothing is put in `localStorage` or in a JSON response body.

`account.js:call()` owns auto-refresh: on a 401 it runs `refreshOnce()` (deduped via a shared promise, cleared on the next macrotask) and replays the original request once. `comment.js` and `vote.js` must import `call()` from `account.js` rather than re-implementing it — duplicated fetch helpers silently lose the refresh behaviour.

`login`, `register`, `logout`, and `refresh` are excluded from auto-refresh by the `guarded` regex in `call()`; otherwise a bad password would loop.

## Security invariants worth not breaking

- **`publicUser()` is the only way user data leaves the server.** It whitelists fields; `password_hash` must never appear in a response.
- **Login is constant-time for unknown usernames** — `checkPassword()` compares against a dummy hash so response timing doesn't reveal which usernames exist. Don't "optimize" that away.
- **Session tokens are stored as SHA-256 hashes**, never raw. The raw token only ever exists in the cookie.
- **The JWT secret lives in `data/secret.key` (0600)** and is gitignored. It must survive restarts, or every access token dies each time you redeploy. Set `JWT_SECRET` to manage it externally.
- **Avatar uploads are validated by magic bytes** (`sniffImage`), not `Content-Type`. SVG is intentionally unsupported. Don't add it without thinking about stored XSS.
- **Rate limiting is per-IP+username in memory.** Register and login each get their own bucket. It resets on restart, which is fine at this scale but means it is not multi-process safe.
- `data/` is `0700` and its files are `0600`. Both are gitignored — **never** commit them.

## The `?api=` override is sticky (biggest gotcha)

`api.js` reads `?api=` at **module import time** and writes it to `localStorage` under `gamelist:api`. Consequences:

- Once someone opens `/?api=/api`, the proxy setting persists for the whole browser. Switching to a plain `python -m http.server` then produces **404s on every request** with no obvious cause.
- Reset with `http://localhost:8080/?api=` (empty value = direct API). Omitting `?api=` does not clear it; only an explicitly empty value does.
- Empty string falls back to the direct `https://www.freetogame.com/api` base, which likely fails with CORS.

## Data flow

`app.js` is the only entry point (`index.html` loads it with `type="module"`). It owns all state and renders everything.

- `api.js` — FreeToGame requests + cache. `account.js` / `comment.js` — internal API clients. Nothing else calls `fetch`.
- `router.js` — hash routing (`#/`, `#/games?...`, `#/game/ID`, `#/favorites`, `#/masuk`, `#/daftar`, `#/profil`).
- `components.js` — pure render functions returning DOM nodes.
- `utils.js` — `h()`, `image()`, `store`, `debounce`, `safeUrl`, `icon`, `KEY_THEME`.

`index.html` and `app.js` are a contract: `app.js` grabs `#view`, `#menu`, `#burger`, `#to-top`, `#nav`, `#progress`, `#theme`, `#account-nav`, `.brand`, `#fav-count` at module load with no null guards. Removing or renaming any of those breaks the app at import time. Everything inside `#view` is replaced wholesale via `replaceChildren`.

**Adding an icon:** add a path to `PATHS` in `utils.js` (Lucide-style, 24×24, `stroke="currentColor"`), then call `icon('name')`. That map is the only sanctioned `innerHTML`. If `PATHS[name]` is missing, `icon()` silently returns an **empty** `<svg>` — it does not throw — so a wrong icon name is easy to miss.

**The theme has two sources of truth.** `index.html` has an inline `<script>` in `<head>` that sets `documentElement.dataset.theme` from `localStorage` before first paint; `app.js:paintTheme()` only syncs the button icon, the `theme-color` meta tag, and re-applies the choice. The inline script reads **raw** `localStorage` while `app.js` writes via `store.set` (JSON) — it must keep the `JSON.parse` fallback or the anti-flash silently stops working.

**The intro runs once per session, not per page view.** The same inline script sets `documentElement.dataset.intro` and writes `gamelist:seen` to `sessionStorage`. CSS keys the curtain off `html[data-intro]`, and `.boot` defaults to `display:none` so a missing attribute can never leave the curtain covering the page.

**Any new render path must call `reveal()` and `stage()`.** `reveal(root)` observes `.card:not(.in), .sec:not(.in)` for scroll reveals; `stage()` sets the per-child `--d` stagger delay and re-arms the `.intro` class on `#view`. Miss `reveal()` and cards stay at `opacity:0`; miss `stage()` and the page pops in with no transition.

**Scroll effects own `transform` on `.hero-media`, not the `<img>`.** Ken Burns is a CSS `animation` on `.hero-media > img`; animations beat inline styles, so parallax must target the wrapper.

## Account state machine

- `user` (object or `null`) and `userKnown` (session check finished) are separate — `user === null` while still checking is *not* the same as logged out. `renderProfile()` branches on `userKnown`, not `user`.
- `setUser()` swaps the favorites source of truth: server when logged in, `localStorage` otherwise. It always mirrors to `localStorage` so the cache survives logout.
- `migrateFavorites()` runs once after login and only pushes favorites the server doesn't already have. It's guarded by a `migrating` flag because both `refreshUser()` and `afterLogin()` can reach it.
- `pushFavorites` is debounced and fire-and-forget; local state is already updated by then.
- Client-side size/type checks in `account.js` (`checkAvatar`) exist only to save a round-trip — `auth.js` re-validates. Both caps must stay equal (2 MB).

## Conventions that are easy to break

**Every color goes through a CSS variable.** Tokens live in `:root` (dark default) with overrides in `[data-theme=light]`. Never hardcode a hex/rgba in a component rule — it silently breaks the other theme. The hero is the deliberate exception: dark scrims plus its own `--hero-ink` in both themes so photo contrast holds.

**Adding an icon:** add a path to `PATHS` in `utils.js` (Lucide-style, 24×24, `stroke="currentColor"`), then call `icon('name')`. That map is the only sanctioned `innerHTML`.

**No `innerHTML` for API or user data.** Everything goes through `h()`, which uses `textContent`/`setAttribute`. Every URL from the API passes through `safeUrl()`; images go through `image()`, which applies `safeUrl` and falls back to a placeholder on `error`. This applies to bio and display name too.

**Don't put `novalidate` on the auth form.** Its `pattern`/`minlength` attributes are the instant-feedback layer; the custom submit handler only covers what native validation misses.

**Stale-response guard.** `requestId` is bumped by `guarded()`, `refresh()`, and `route()`. Async render paths must capture it and check `id === requestId` before touching the DOM.

**Router navigation is two different operations.** `setParams()` uses `history.replaceState` (URL only, no re-render); `navigate()` sets `location.hash` (fires `hashchange`, full re-render).

**Update state before triggering a fetch.** `dropFilter()` mutates `s` and the matching control *before* calling `refresh()`, otherwise the request goes out with the stale value.

**Favorites are stored trimmed.** `SUMMARY` (app.js) is the whitelist for localStorage; the server has its own whitelist in the `PUT /api/me/favorites` handler. Keep them aligned. `toggleFav` silently no-ops unless the game is in the `known` map.

## FreeToGame API constraints (easy to violate)

- **No title search on the server.** Search is always local, over an already-fetched list (`paint()`).
- **No pagination.** "Muat lebih banyak" only slices the client-side array (`PAGE = 24`).
- `platform` ∈ `windows | browser | all`; `sort-by` ∈ `popularity | release-date | alphabetical | relevance`.
- `category` takes a tag or a genre; the app's **Genre** dropdown is separate and purely local.
- Rate limit ~10 req/s. `api.js` caches in a `Map` + `sessionStorage` (key `gl:<url>`), per-tab. Empty arrays are deliberately **not** cached so a retry can refetch.
- Only `/api/games` and `/api/game` are proxied to FreeToGame. Anything else under `/api/` must 404 as JSON, never be forwarded upstream.
- FreeToGame attribution in the footer is required by their terms.

## Testing

There is no automated suite in the repo. The test plan is the manual checklist at the bottom of `README.md` — use it when verifying changes, and check 360px / 768px / 1280px widths.

When debugging, the error text already encodes the usual cause; check the Network tab before changing code. Common causes: CORS (no proxy / no `?api=/api`), `file://` (blank page, module error), a stale `?api=/api` override, or the account API 404ing because a plain static server is running.