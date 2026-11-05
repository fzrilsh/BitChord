---
name: bitchord-pure-web-ios-revised
overview: "Revised after an on-device spike. The original plan's Worker-only architecture fails on two measured facts: googlevideo URLs are IP-bound, and youtubei rejects unknown Origins with 403. The working approach is a sandboxed iframe (opaque origin, which YouTube answers) for anonymous InnerTube + direct audio from the device, with a small Worker only for the two assets that carry no ACAO."
supersedes: bitchord-pure-web-ios.md
measured: 2026-11-05
status: VERIFIED ON A REAL iPHONE (Safari, iOS 17.5) — anonymous playback, seek, and bookmarklet capture all pass
---

## What the spike proved (and disproved)

Every claim below was measured with curl / a real browser, not assumed. The spike
itself lives at `https://bitchord-spike.ink-hope.workers.dev` (temporary Cloudflare
account; source snapshot in `/tmp/bitchord-spike-src`).

### 1. googlevideo URLs are bound to the requester's IP

`videoplayback` URLs carry `ip=<requester>` **and** list `ip` in the signed
`sparams`. Changing or removing it is refused.

| Fetch | Result |
|---|---|
| URL minted for 114.8.197.56, fetched from that IP | `206` |
| Same URL with `ip=8.8.8.8` | `403` |
| Same URL with `ip` removed | `403` |
| Same URL via a different egress (r.jina.ai) | `403 Forbidden` |
| URL minted **by the Worker**, fetched by the phone | `403` |
| URL minted **by the Worker**, fetched by the Worker | `206` |

**Consequence:** the original plan's premise — "Worker proxies JSON only, audio
stays direct from the CDN" — is only possible if the *device* mints the URL.
A Worker-minted URL is useless to the phone.

### 2. youtubei answers 403 to any normal page Origin

| Request | Result |
|---|---|
| `POST /youtubei/v1/browse`, `Origin: http://localhost:5173` | `403` (Google "Sorry…" page) |
| `Origin: https://bitchord.in`, `https://example.com`, any site | `403` |
| `Origin: https://www.youtube.com` / `music.youtube.com` | `200` + ACAO |
| **`Origin: null`** (opaque origin) | **`200` + `ACAO: null`** |
| No Origin header at all | `200` (no ACAO, so a browser can't read it) |

**Consequence:** the extension's DNR rule is not merely a CORS workaround — YouTube
also *rejects* the request itself. A Worker must rewrite Origin (it can). But a
**sandboxed iframe needs no Worker at all** for anonymous calls.

### 3. A sandboxed iframe is the clean anonymous path

An iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) has an opaque
origin, `self.origin === "null"`. Measured in Chromium and re-verified on the
deployed Worker:

```
browse        HTTP 200 · home feed ok
player        HTTP 200 · OK · 5 audio formats
aac 140       audio/mp4; codecs="mp4a.40.2"
opus 251      audio/webm; codecs="opus"
sandbox origin null
sw.js_data    BLOCKED (no ACAO)
```

Because the request leaves from the *device*, the audio URL it gets back carries
the device's IP and **plays directly** — `<audio src=…>` reached `canplay` with a
281.6 s duration, and seeking to 120 s resumed playback ("advanced 2.4 s").

### 4. Client choice decides whether the whole track is reachable

Measured per client on the same video:

| Client | bytes 0–1 KB | byte 2,000,000 | byte 4,000,000 |
|---|---|---|---|
| **VISIONOS** | 206 | **206** | **206** |
| IOS | 206 | 403 | 403 |
| ANDROID | 206 | 403 | 403 |
| ANDROID_VR | 206 | 403 | 403 |

VISIONOS also serves full open-ended ranges (`bytes=N-`), which is what media
elements send. IOS/ANDROID URLs stop around 1.2 MB (~70 s) — the same wall the
project already documented in `web/docs/youtube-playback.md`. VISIONOS offers
AAC 140 as well as Opus, so Safari's media element has a codec it can decode.

From a Cloudflare datacenter IP, VISIONOS/ANDROID_VR/TV get
`LOGIN_REQUIRED: Sign in to confirm you're not a bot`, while **IOS** and **ANDROID**
still answer `OK` — but their URLs are then bound to the Worker's IP. So the Worker
cannot mint playable audio at all; it can only serve browsing.

### 5. Two assets still need a proxy

`sw.js_data` (the YouTube.js session bootstrap) and `/s/player/…/base.js` (the
signature decipher) return **no `Access-Control-Allow-Origin`** for any origin,
so the page cannot read them. A Worker fetching them with YouTube's Origin gets
`200` (verified: 2,706 bytes). These are static, cacheable, and tiny.

### 6. The bookmarklet works, but not the way the plan said

`music.youtube.com` sends `Cross-Origin-Opener-Policy: same-origin-allow-popups`,
which severs `window.opener` when the app opens the YouTube tab. The direction must
be reversed:

- the bookmarklet runs on `music.youtube.com` and calls `window.open(appOrigin + '/capture')`;
- the popup receives `postMessage` from the (now-opener) YouTube tab;
- the app validates `event.origin === 'https://music.youtube.com'`.

Verified end-to-end in a browser: a fake `ytcfg` + `document.cookie` on a
`music.youtube.com` document reached the app's capture page with
`fromOrigin: "https://music.youtube.com"`, `loggedIn: true`, and `SAPISID` present.

`SAPISID` is readable from JS: checked the local Chrome cookie DB —
`SAPISID` `is_httponly = 0` (only `__Secure-3PSID` is HttpOnly). iOS Safari still
has to be confirmed on a real device.

### 7. Other confirmed facts

- `https://www.youtube.com/api/jnn/*` (BotGuard) allows any origin, preflight
  included — Create and GenerateIT can run from the page/sandbox.
- `music.youtube.com` CSP includes `'unsafe-eval'` and `'unsafe-inline'`, but that
  is YouTube's own page; BitChord's page needs its own CSP allowance for
  `new Function` (the player decipher) and the inline BotGuard interpreter.
- Cloudflare Workers can set `Cookie`, `Origin`, `Referer` on subrequests.
- Workers' ToS has no clause banning audio/video proxying, but proxying all audio
  would move gigabytes/day through the free tier — avoid it.

---

### 8. Confirmed on the actual iPhone (iOS 17.5, Safari)

Run by the project owner on the deployed spike:

- `browse` → 200, `player` → 200 OK, 5 audio formats.
- **Audio plays, pauses, and seeks** ("jump juga bisa"). The seek stall seen in
  Chromium emulation did not reproduce on the device.
- `sw.js_data` → BLOCKED (no ACAO), and `sw via Worker` → **200, 2,739 bytes**.
- `try via Worker proxy` → **403** on the audio URL, as predicted: it is signed
  for the phone's IP.
- Bookmarklet capture → **"Session captured ✅ signing secret: SAPISID"** with
  `fromOrigin: https://music.youtube.com`, `loggedIn: true`, `authUser: 3`, and
  all three signing cookies present (`SAPISID`, `__Secure-1PAPISID`,
  `__Secure-3PAPISID`).

**One correction to the plan's assumptions.** The captured `clientVersion` was
`1.20261031.09.00` and `pageId` was `null` with `authUser: 3` — i.e. `ytcfg` on
that page reported the **WEB** client, not WEB_REMIX, and the account had a
single channel. So `clientVersion` from the bookmarklet must not be assumed to be
a WEB_REMIX version. The spike re-tested: that version string is accepted by
WEB_REMIX endpoints too (200), but the safe rule is to keep the pinned
`WEB_REMIX_VERSION` for InnerTube calls and use the captured value only as a hint.

The captured cookie jar also lacks `__Secure-3PSID` (only `__Secure-3PAPISID`),
which is fine — `__Secure-3PAPISID` is the signing cookie for that variant.

**Playback does not need Shaka on iOS.** The spike played through a plain
`<audio>` element, which is what made it work: media elements send no `Origin`,
so googlevideo's missing ACAO never applies. A `fetch()`/XHR from the app origin
to the same URL is refused (verified: `206` but **no ACAO** for
`Origin: https://bitchord.in`). Any design that routes audio through Shaka's
fetch-based loader on iOS will break; the direct-URL path must use `<audio>`.

---

## Revised architecture

```
iOS Safari
┌──────────────────────────────────────────────────────────────┐
│  BitChord app  (Cloudflare Pages)                            │
│    • UI, player, state                                       │
│    • <audio> / Shaka for playback                            │
│                                                              │
│  ┌────────────────────────────┐   postMessage                │
│  │ sandbox iframe             │ ───────────▶ app             │
│  │ sandbox="allow-scripts"    │                              │
│  │ origin = null              │                              │
│  │  • InnerTube browse/search │                              │
│  │  • player (VISIONOS)       │                              │
│  └────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
        │                              │
        │ audio bytes                  │ sw.js_data, player script
        │ (device IP, direct)          ▼
        │                     ┌─────────────────────┐
        │                     │ Cloudflare Worker   │
        │                     │  • /asset (ACAO-less│
        │                     │    YouTube files)   │
        │                     │  • signed calls     │
        │                     └─────────────────────┘
        ▼
   googlevideo CDN
```

**Why the split:** audio must come from the device (IP binding), and the device
can call youtubei anonymously through the sandbox — so the Worker never touches
media. What the Worker is actually needed for is (a) the ACAO-less bootstrap
assets and (b) **signed** calls, which need `Cookie` + `SAPISIDHASH` headers that
a page cannot set.

### Signed-in flow (bookmarklet session)

The session capture is now proven; the request path still needs work:

1. Bookmarklet captures `document.cookie` + `ytcfg` (as verified).
2. App stores it (AES-GCM in IndexedDB) and computes `SAPISIDHASH` locally —
   `crypto.subtle.digest('SHA-1', ts + ' ' + secret + ' ' + origin)`.
3. Signed InnerTube calls go **through the Worker**, because the page cannot set
   `Cookie` or `Authorization` (both forbidden request headers). The Worker
   re-assembles `Cookie:` and `Origin:` and forwards.
4. Audio for signed-in playback is minted **by the device** where possible. If
   only a Worker-minted URL is available, it is IP-bound to the Worker and must
   be proxied — which is the expensive path this design avoids.

### Signed calls must go through the Worker (settled)

Two facts together close this question:

1. `Cookie` is a [forbidden request header](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header):
   a page cannot set it, and a sandboxed iframe cannot either. So the device can
   never present the session's cookies to youtubei by itself.
2. Measured: a request carrying `Authorization: SAPISIDHASH …` **without** a
   Cookie header answers `200` but reports `logged_in=0` — the hash alone does
   not identify a session. The endpoint accepts the request shape, so a Worker
   that sets both headers is viable.

**Conclusion:** signed InnerTube calls go through the Worker, which re-assembles
`Cookie:` + `Authorization:` and forwards with `Origin: https://music.youtube.com`.
The Worker therefore does see the session cookies — that has to be stated plainly
in the product's privacy copy, replacing the original plan's "cookies never leave
the device".

**Still unmeasured:** whether a *signed* player response mints URLs the device can
play. Signed playback needs the web clients (WEB_REMIX), and their URLs were
measured to stop at ~1.2 MB — so signed audio may have to be proxied through the
Worker. Do not build the signed playback path before measuring this.

---

## Revised task list

### Phase 0 — spike on a real iPhone ✅ DONE (2026-11-05, iOS 17.5 Safari)

- [x] `browse` 200, `player` OK, `<audio>` plays, pause and seek all work.
- [x] `SAPISID` is readable from `document.cookie` on iOS Safari; capture works
      end to end.
- [x] `sw.js_data` needs the Worker (`200 · 2,739 bytes` through `/asset`).
- [x] Worker-fetched audio URL → `403`, confirming IP binding on the device.
- [x] `canPlayType('audio/mp4; codecs="mp4a.40.2"')` is true (from the page log).

Remaining unknowns, both deferred to phase 3:

- Whether the sandbox can mint a **signed** player response (see the open question).
- Whether BotGuard/PO tokens are needed for age-gated tracks.

### Phase 1 — anonymous playback (no Worker required for audio)

- [ ] `web/app/src/youtube/sandbox/` — an iframe host + typed RPC
      (`browse`, `search`, `player`, `suggestions`), request/response correlation,
      timeouts, and a single `sandbox.html` served as a static asset.
- [ ] `innertube.ts`: a third fetch path. YouTube.js's `fetch` cannot be used
      directly (it would run in the page origin); instead either
      (a) run YouTube.js **inside** the sandbox and expose its parsed results, or
      (b) keep YouTube.js out and call InnerTube directly, porting the mappers.
      Decide with a small experiment; (a) reuses all existing mappers.
- [ ] Player path: force `VISIONOS`, select AAC 140 when
      `canPlayType('audio/mp4; codecs="mp4a.40.2"')`, keep Opus for MSE browsers.
- [ ] **iOS playback must use a plain `<audio>` element with the direct URL**,
      not Shaka. googlevideo sends no ACAO, so Shaka's fetch-based loader is
      refused from the app's origin even though the media element works.
      `engine.ts` already builds a DASH manifest over direct URLs; on iOS, bypass
      it and hand the `<audio>` element the single selected rendition instead.
- [ ] `useYouTubeReady()`: ready when `sandbox available` OR extension present.
- [ ] `States.tsx` / `AppShell.tsx`: drop the "Get the App" banner when the
      sandbox path is available.

### Phase 2 — the two proxied assets

- [ ] `web/worker/`: a Cloudflare Worker with `/asset?u=` (allow-listed to
      `www.youtube.com/sw.js_data` and `/s/player/…`), immutable caching, and no
      logging of URLs.
- [ ] `config.ts`: `VITE_WORKER_URL`, optional (build must still work without it).

### Phase 3 — sign-in

- [ ] Bookmarklet generator (proven), `/capture` receiver (proven), AES-GCM
      IndexedDB storage, `sapisidHash.ts`.
- [ ] `workerSignedFetch`: POST the request to the Worker with the cookie jar in
      a custom header; the Worker sets `Cookie` + `Origin` and forwards. Never log
      either header, and say in the privacy copy that the Worker relays them.
- [ ] **Measure first:** does a signed WEB_REMIX player response give a URL the
      device can play for the whole track? Its URLs were measured to stop at
      ~1.2 MB. If they do stop, signed playback needs Worker byte-proxying — decide
      then whether that is acceptable, before building it.

### Phase 4 — port the app-side plumbing

- [ ] `useYtAuth.readAuth()`: bookmarklet session path.
- [ ] `routes.tsx` + `pageRegistry.tsx`: `/sign-in`.
- [ ] `platform.ts`: `isIOS()`.
- [ ] `vite.config.ts`: relax `VITE_PARTY_SERVER_URL` for a mobile-only build.

---

## What to keep from the original plan

The original's file-by-file breakdown of the app-side changes is still broadly
right: `useYtAuth.ts`, `queries.ts`, `AppShell.tsx`, `States.tsx`, `routes.tsx`,
`config.ts`, `platform.ts`, and the `sapisidHash` port from
`web/extension/lib/ytAuth.ts:65-70` all stand. What changes is *where the
requests are made from*: a sandboxed iframe on the device instead of a Worker
proxy, with the Worker reduced to assets and signed calls.

## Risks

1. ~~iOS Safari may differ from Chromium~~ — resolved: verified on an iPhone.
2. **VISIONOS is a probe client.** It works today (and the project already relies
   on it for Android-style direct playback), but YouTube could gate it. The IOS
   client is the fallback, but its URLs stop at ~1.2 MB — so a VISIONOS block
   would need a different streaming strategy, not just another client.
3. **The app's origin cannot fetch googlevideo.** Confirmed: no ACAO for any
   non-YouTube origin. Every iOS audio path must go through `<audio>`, which rules
   out Shaka, SABR, and any byte-range logic the app does itself.
3. **BotGuard/PO tokens** were not exercised. Playback worked without them in the
   spike; signed or age-gated tracks may need them, and whether a token minted in
   an opaque origin is accepted is untested.
4. **Signed audio may need Worker proxying** (IP binding), which is the expensive
   path. Phase 3's measurement decides.
