# Tucker's Camp Lite — Backlog

Known issues to address after the stress-test weekend (2026-08-29 sweep, v2.9.3).
Revisit once we know which ones actually bite in real use.

## Next full code sweep — focus: CONSISTENCY + APP SAFETY

The next deep pass should be dedicated to these two themes, not features.

### Safety (do first)

- **Firestore + Storage rules — DONE in lite-2.15.0, tightened in lite-2.16.0**
  (`firestore.rules`, `storage.rules` in the repo). Self-role-change blocked,
  admin log append-only, content create locked to author, delete author-or-admin,
  config public-read for the camp-code check.
  **2026-09-19 stress test found the app.js UI hid edit/delete buttons from
  non-owners correctly, but the RULES underneath were too loose — `update` on
  harvests/trailcam/feed was `if signedIn()` for anyone, letting a non-owner
  overwrite a post's actual content (not just add a comment/reaction), i.e.
  "edit someone else's message." Fixed:** rule now allows a non-owner to change
  ONLY the `comments`/`reactions` fields (`onlyCommentsOrReactions()` — a
  `diff().affectedKeys()` check); everything else needs to be the author or an
  admin. Storage delete was `if request.auth != null` (anyone could delete any
  file) — fixed to require the requester's uid match the uploader-prefixed
  filename (`<uid>_<timestamp>...`, already the naming convention every upload
  used) or admin (via `firestore.get()` cross-service rule). Also added
  client-side re-verification inside `editComment`/`deleteComment` themselves
  (not just the button-render gate) as defense in depth. *Remaining gap:* the
  rule can't tell WHICH comment in the shared array a non-owner touched, only
  that they didn't touch other fields — a determined non-owner could still
  edit/delete someone else's individual comment via a raw Firestore call. Fully
  closing that needs the comments subcollection refactor (post-stress-test
  item #1) — this pass is a strong mitigation, not the complete fix.
- **Stats-corrupting multi-user bugs — DONE (lite-2.16.0).** Found in the same
  audit: (a) `saveHarvest` on edit reassigned `uid`/`memberName`/avatar to
  whoever clicked Save — so an admin editing another member's harvest silently
  took credit for their trophy. Fixed: edits now preserve the original owner's
  identity from the existing doc. (b) `deleteHarvest` and `adminDeleteHarvest`
  adjusted the ACTING user's kill points/totalKills instead of the harvest
  owner's — an admin deleting someone else's harvest corrupted the admin's own
  stats and left the owner's inflated. Fixed: points are now adjusted on the
  harvest's actual `uid`.
- **Password policy — mostly DONE.** `doChangePassword` + sign-up now require 8
  chars. Email-enumeration protection: **enabled in the console** (2026-08-30).
  Firebase's built-in password-strength policy: still available to toggle if
  wanted, not critical.
- **Two-factor auth.**
  1. Google-account 2-step verification on the project-owner account —
     **DONE (2026-08-30).**
  2. Optional member 2FA via Firebase Auth MFA. Enabling it upgrades the
     project to Identity Platform (free tier 50k MAU, so free at our size, but
     it's a semi-one-way door — do it deliberately in this sweep).
     - TOTP / authenticator-app second factor: **free**, no per-use cost.
     - SMS second factor: ~1–5¢ per text + needs abuse protection. Avoid unless
       members won't use an authenticator app.
     Recommend TOTP-only.
- **Guest access — REMOVED in lite-2.15.0.** Guest keys are gone entirely
  (collection, admin panel, `sessionStorage` session, all `isGuest` guards).
  Everyone has a real Firebase account. New members self-register on the sign-in
  screen with a hashed camp code (admin sets/opens it under Admin → Sign-ups;
  `config/signup` doc `{codeHash, open}`).
- **Compromised-password notification** (user reported one from their password
  manager / browser, 2026-08-29): treat as a prompt to (a) rotate the affected
  password and turn on 2FA for the Google/Firebase project account, (b) review
  whether any member reused a breached password — Firebase stores only salted
  hashes so the app didn't leak anything, but reuse is the risk. Not a code fix
  per se; note it here so the next sweep double-checks auth config.
- **Optional biometric app-lock (opt-in toggle in Settings).**
  User request 2026-08-29. Design: a *local* lock, not a replacement for the
  Firebase password.
  - Settings → Account & Security → "Require Face ID / fingerprint to open the
    app" toggle (yes/no). Feature-detect first:
    `window.PublicKeyCredential &&
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
    — hide the toggle entirely if the device has no platform authenticator.
  - On enable: `navigator.credentials.create()` with
    `authenticatorSelection: { authenticatorAttachment: 'platform',
    userVerification: 'required' }`, store the returned credential id in
    `localStorage` (per-device). No server round-trip — this is a local gate.
  - On app launch (in `onAuthStateChanged`, before `enterApp`): if the toggle
    is on and a credential id exists, show a lock screen and call
    `navigator.credentials.get({ publicKey: { userVerification: 'required',
    allowCredentials: [{ id, type: 'public-key' }] } })`. Only reveal the app
    on success. Offer a "use password instead" fallback that signs out and
    returns to the login screen.
  - Caveats to document in the UI: it's a convenience lock (clearing site data
    or the Firebase session elsewhere bypasses it); it's per-device; it does
    NOT protect data at the database layer — that's what the Firestore-rules
    fix above is for. Works on iOS 16.4+ Safari/PWA, Android Chrome, desktop
    Windows Hello / Touch ID.
  - Effort: ~half a day, client-side only. Do it in the same sweep as the rules
    tightening so "app safety" lands as one coherent release.

### Consistency (do alongside)

- Realtime-listener behaviour differs by screen: feed & harvest lists skip
  re-render on `hasPendingWrites` and preserve scroll; trail cam feed, calendar,
  and contests don't. Pick one pattern and apply everywhere.
- Error handling is uneven: some `onSnapshot` / `updateDoc` failures show a
  toast, some are silent `console.error`, some leave a spinner. Standardise.
- Empty-vs-filtered states worded inconsistently ("No harvests logged yet" shows
  even when it's just a filter miss; trail cam gets this right).
- Modal / overlay patterns vary (some `appConfirm`, some hand-rolled overlays,
  some `requireReason`). Not urgent but worth unifying.
- Remove the trail cam animal-tag feature entirely for consistency — see
  "UI changes to make" below (pills, `toggleTcTag`, AND the "🔍 Filter Photos"
  tag filter all go).

## Post-stress-test fix list

1. **Comment race / lost comments — STILL OPEN (the big one).**
   Comments are stored as an array on the post/harvest/photo doc and saved with
   read-modify-write. Two people commenting on the same item at once can
   overwrite each other. *Proper fix:* move comments to a subcollection
   (`feed/{id}/comments/{commentId}`). Affects: `submitFeedComment`,
   `submitHarvestComment`, `submitTcComment`, `editComment`, `deleteComment`.
   **Doing this ALSO lets us tighten the Firestore rules** — right now
   `update` on harvests/trailcam/feed has to be `if signedIn()` (any member)
   precisely because comments/reactions write to the parent doc. Once comments
   move to subcollections, parent-doc `update` can go to author-or-admin.
   This is its own focused session — schema change + migrate existing array
   comments + update 5 functions + listeners + then the rules.

2. **Orphaned Storage files — DONE (lite-2.15.2).** `deleteStoredImage(url)`
   helper wired into `deleteHarvest` / `deleteTcPhoto` / `deleteFeedPost` and
   the three admin delete paths (skipped when the admin's "keep photo" option
   is chosen). Best-effort, never throws.

3. **"Change Email" — DONE (lite-2.15.2).** Now `verifyBeforeUpdateEmail`
   (confirmation link to the new address); error branches handle
   `auth/invalid-credential`; `loadUserProfile` picks up the new email on next
   sign-in. `doChangePassword` also updated for `auth/invalid-credential`.

4. **Offline support — DONE (lite-2.15.2).** The 4 gstatic Firebase SDK files
   are version-pinned + CORS-enabled and only import `firebase-app.js`, so `sw.js`
   now caches them (`CDN_ASSETS`, cache-first). Firestore persistence enabled
   (`persistentLocalCache` in `firebase.js`) so a weak signal shows last-seen
   data. SW fetch handler falls back to cached `/index.html` for failed
   navigations. App boots offline instead of showing blank.

5. **`cabinmap.jpg` — DONE (lite-2.15.2).** Was 6144×8160 / 4.2 MB → 2000×2656
   / 712 KB (q72), same filename. Still fully readable at the viewer's zoom.

## UI changes to make

- **Trail cam animal tags — DONE (lite-2.15.2).** Removed `TC_ANIMALS`,
  `tcActiveAnimals`, `renderTcTagPills`, `toggleTcTag`, `openTcFilterModal` +
  the whole filter machinery, the "Tag Animals in Photo" lightbox block, row-
  header tag icons, `tcCard` tag line, compare-view tag overlay, and
  `animalTags: []` on upload. Dead stub names removed from `index.html`.
  Old docs keep their `animalTags` field (ignored).

## Feature ideas

### Home screen — SHIPPED in lite-2.16.0

The front page now leads with a live mini calendar (`renderHomeCalendarCard`,
`initHomeCalendar`) instead of the `cabinpicture.jpg` hero photo — weather and
today's moon phase sit as chips in its header, tapping a day opens the same day
sheet as the full Calendar screen. Day cells (home + full Calendar, shared via
`monthDayCell`/`monthGridCellsHTML`) dropped the occupancy fill-and-headcount
gauge for a plain red dot on any day with activity, gold ring on days you're on
— meant to read instinctively ("why's that dot there?") rather than be parsed.
Quick Access became "Quick Actions": long rectangular blaze-orange buttons
(`.action-btn`, same gradient as the existing back-button) that jump straight
into the action — Log Harvest → `openAddHarvest()`, Message Camp →
`goFeed()`, Trail Cam, Trophy Room — not just navigation. Month nav
and add/delete-visit now refresh whichever calendar surface(s) are on screen
via a shared `refreshAllCalendarViews()`. `cabinpicture.jpg` is unreferenced
now (left in `Images/`, dropped from the SW precache list).

**Follow-up fixes — DONE in lite-2.16.1** (from the user's first real look):
Message Camp / Log Harvest now navigate to the Feed / Harvest Log screen before
opening their quick-entry form, instead of leaving you stranded on Home after
you close it. Check-in button removed from Home (calendar RSVP covers it;
`doCheckin`/`doCheckout` left intact but unreachable). Bulletins re-skinned
red (`--alert-red*` vars) to stand out from the gold/orange everything else
uses. Calendar day popup's "add yourself" form replaced with a 4-step wizard
(`calWizardBegin`/`calWizardStep`/`calWizardPick`/`calWizardBumpSpan`) — one
question per screen with progress dots, instead of every chip row + stepper +
notes field visible at once.

### Log Harvest wizard — SHIPPED in lite-2.17.0

Extended the calendar-day wizard pattern to Log Harvest, per the user's ask
("9 times out of 10 the harvest is a deer or a turkey... you can figure how to
manage the rest"). `openAddHarvest` now opens `showHarvestWizard()` instead of
the old flat form (edit still uses the flat form — correcting known values
doesn't need a decision tree). Species screen (Deer / Turkey / Something else)
branches into a path per `HV_PATHS`: Deer asks buck-or-doe → firearm-or-bow →
weight/antler details (antler fields skipped for doe); Turkey asks tom/jake/hen
→ weight/beard/spurs; Something else asks bear (weight + color phase),
waterfowl or small game (sub-species + quantity, no weight), or other (weight
only) — every path converges on an optional photo step then notes + date +
"Log It". Reuses the generic `wizardDots`/`wizardQuestion` helpers built for
the calendar wizard. Fixed a bug found during testing: the "Something else"
branch never set `hvWizard.path`, so its progress dots silently never rendered.

### Inline compose + real notification bell — SHIPPED in lite-2.18.0

Three follow-ups from the user's first real look at the redesigned Home/Feed:

1. **Message Camp popup gone.** The "New Post" modal overlay is gone — the
   Feed screen's existing "What's on your mind?" bar now expands in place
   (`expandFeedComposer()`/`collapseFeedComposer()` swap the same
   `#feed-compose-wrap` div between a collapsed one-liner and the full
   textarea + photo + Post/Cancel) instead of spawning `.modal-overlay`. The
   Home screen's Message Camp button now just calls `goFeed()` — it no longer
   auto-opens the composer the instant you land on the screen.
2. **The bell is a real notification list now**, not "Coming soon." It merges
   two live queries — `feed` docs where `isAuto == true` (harvest, trail cam,
   rank-up, contest-winner) and all `visits` (calendar day entries) — sorted
   newest-first, rendered read-only (no edit/delete — `notifCard()`), 20 at a
   time with a "Show More" button (`notifShown`/`window.notifShowMore`). The
   public Feed itself now queries `isAuto == false` only, so it's messages-only;
   `feedPostCard`'s old blue "auto-notification" branch (with its delete
   button) was deleted since it's now unreachable from the Feed. Harvest/trail
   cam/rank-up/contest auto-posts still get written into the same `feed`
   collection via the unchanged `postAutoFeedEvent` — only the *display* split,
   no schema/collection change, no rules change needed.
3. **Unread indicator, not push spam.** `startNotifListeners()` (called once
   from `enterApp()`, torn down on sign-out) keeps a running unread count —
   `#bell-badge` in the header shows a number, and `navigator.setAppBadge()`
   puts a dot on the home-screen icon itself on supported/installed PWAs
   (`navigator.clearAppBadge()` when caught up). "Last seen" is a plain
   `localStorage` timestamp bumped on opening the bell — no new Firestore
   field, no cross-device sync, matches the "un-editable, low-key" ask.
4. **Auto-update on every return to the app**, not just at sign-in. Existing
   lite-2.15.1 auto-update only fired from `onAuthStateChanged`, which doesn't
   refire if the browser kept the PWA alive in the background — reopening from
   the home-screen icon could sit on a stale version indefinitely. Added a
   `visibilitychange` listener: becoming visible again opens a 15s auto-update
   grace window (same "safe to refresh silently" logic already used at the
   login door) and calls `maybeAutoUpdate()`.

Verified in-browser via temporary `window.__debugSetUser`/`__debugEnterApp`/
`__debugNotif` hooks (removed after): inline composer expands/collapses with
no `.modal-overlay` anywhere in the DOM; bell renders empty-state, then
harvest/trailcam/tier/contest/calendar cards with correct icons, text, and
"View X" links off injected fixture data; 25 fake items → 20 shown + Show More
→ all 25; badge shows/hides correctly around `openNotifications()`;
`visibilitychange` dispatch doesn't throw. Real Firestore reads/writes and the
actual app-icon badge (needs an installed PWA) are unverified — no auth in the
sandbox.

### Feed/bell missing index fix + chat-bubble redesign — SHIPPED in lite-2.19.0

The lite-2.18.0 feed/bell split (`where("isAuto",...)` + `orderBy("createdAt")`)
needed a Firestore **composite index** that was never deployed — `firestore.indexes.json`
had `"indexes": []`. Writes (posting) still worked; only the read/listener
query failed (`failed-precondition`), so the board loaded briefly then flashed
"Could not load feed." Fixed by adding the `feed` composite index
(`isAuto` ASC, `createdAt` DESC — covers both the feed's `isAuto==false` query
and the bell's `isAuto==true` query) and actually running
`firebase deploy --only firestore:indexes` (committing the file alone doesn't
push it). Also found and fixed while debugging: this project folder had **no
`.firebaserc`**, so `firebase deploy` was silently falling back to a different
cached default project (`family-routine-89e30`) instead of `tucker-s-camp` —
added `.firebaserc` pinning the project, and ran `firebase use tucker-s-camp`
to clear the stale per-directory cache in `~/.config/configstore/firebase-tools.json`.

**Feed redesign** (live rapid-iteration session, screenshot → feedback → adjust,
many small rounds): message cards are now chat bubbles, not full-width blocks.
Colored per sender using their own avatar color (`colorTint(hex, alpha)`, new
helper next to `safeColor`) instead of a uniform `--forest-card` background —
matches the request "whatever color your icon is should represent the color of
your message box." Own messages right-aligned, others left, bubble width
shrink-wraps to content (`display:inline-block` + `max-width:100%` inside an
`80%`-capped flex item) instead of stretching full width. Avatar (36px, same
size as the composer's own avatar) sits beside the bubble rather than above it;
name moved off its own line and into the small meta caption below the bubble,
next to the date, per explicit feedback ("names on top of the bubble is
awkward"). Bubble shape/padding (`border-radius:var(--radius-xl)`, `10px 16px`)
deliberately matches the feed composer's own "What's on your mind?" pill — the
user pointed at that element and said "make the messages look like that."
Tapping a bubble opens/closes its reply thread directly (`toggleFeedComments`)
— no separate React/Comment button row; reactions and reply count show as
plain small text beneath the bubble instead ("who needs the reaction/message
boxes... we have press technology"). **Real bug found this session:** the
bubble's `white-space:pre-wrap` was preserving the literal newlines/indentation
from the multi-line template-literal source around `${esc(post.text)}`, adding
invisible blank lines above/below every single message — made every bubble
look sized for 2 lines when it held 1. Fixed by collapsing that div onto one
source line (plus a defensive `.trim()`). `addFeedReaction` now re-renders the
one card (`#feed-post-<id>`) via `outerHTML` instead of targeting a reactions
div that no longer exists in the new layout.

**Bell got the same treatment** on request ("spruce up the notification area
the same way, i love how that looks") — `notifCard()` switched from a plain
row with a colored left border to a tinted rounded card
(`colorTint(color,0.13)` background, `colorTint(color,0.3)` border,
`var(--radius-lg)`), same visual language as the feed bubbles. First pass
colored by category (harvest orange, trail cam blue, etc.) but the user found
that confusing and asked for the same per-member coloring as the feed instead
("we should color code by user preferred color rather than random color
breaks"). Fixed via `notifMemberColor(uid)`, which looks the member up in
`trophyCache.members` (populated by `loadTrophyData()`, now awaited once in
`openNotifications()` with a re-render after) — calendar entries use their own
embedded `visitorColor` directly since that's always present. Anything with no
resolvable member (an unknown/deleted uid, or a future notification type
that isn't about one specific person) falls back to a fixed
`NOTIF_DEFAULT_COLOR` blue, per the user's explicit ask for that fallback.
**Real bug found via this feedback:** the user noticed the SAME person's
notifications showing two different colors and correctly read that as a bug,
not a display quirk — traced it to `closeContest()`'s `postAutoFeedEvent`
call not passing a `uid`, so the contest-winner notification's top-level `uid`
fell back to whoever CLOSED the season (`userProfile.uid`, usually an admin)
instead of the actual winner. Fixed by passing `uid: winner.uid` explicitly —
`winner.uid` was already available in scope, just never forwarded. Every
other auto-event type (harvest, trailcam, tier) was already correctly
self-attributed since those are always triggered by the member they're about.
**Bell badge simplified to a plain dot** — `refreshNotifBadge()` no longer sets
a count on `#bell-badge`, just toggles `display`; CSS shrunk it from a
numbered pill to a 9px dot with a thin border matching the header background
(reads as "something's new," not "here's exactly how many").

**Quick Actions** lost their emoji icons (`actionBtn(icon,label,action)` →
`actionBtn(label,action)`) per "explore getting rid of all the graphics" —
text-only rectangular buttons now, `.action-icon` CSS removed.

Verified via repeated `window.__debugSetUser`/`__debugEnterApp`/
`__debugFeedCards`/`__debugNotif` hook + screenshot rounds at both desktop and
375px mobile width (all debug hooks removed before finishing, each time).

### Feed polish — SHIPPED in lite-2.19.1

Three small follow-ups from the user's first look at the 2.19.0 chat bubbles.
1. **Floating + button removed from Feed** — `screen-feed` dropped from the
   `fabScreens` list in `showScreen()` (harvest/trailcam/calendar keep it); the
   now-unreachable `openAddPost()` and its `fabAction()` switch case were
   deleted (the inline compose bar at the top of Feed already covers the
   same job).
2. **Faint dividers between messages** — new `FEED_DIVIDER` constant (reuses
   the existing `.fade-divider-plain` gold-fade line) joins the cards in both
   `loadFeed()`'s and `loadMoreFeed()`'s render, instead of concatenating them
   with no separator — asked for specifically to keep short one-word
   back-and-forth replies ("Hey" / "Yo" / "Yep") from visually running
   together into one blob of bubbles.
3. **"Photos/Trail Cam" label** — the Quick Action button text changed first
   (user request), then the Trail Cam screen's own back-bar title
   (`index.html` `#screen-trailcam .section-title`) was updated to match after
   the user noticed the in-screen header still said just "Trail Cam." Other
   incidental "Trail Cam" mentions (the photo lightbox title, the Compare
   screen, admin stat labels) were deliberately left alone — out of scope,
   not asked for.
4. **Own-message alignment confirmed by code inspection** (user couldn't
   multi-device test live yet): `isMine = userProfile.uid === post.uid` is
   evaluated per-viewer against their OWN session, against the post's stored
   author `uid` — so on any member's device, their own messages render
   right-aligned and everyone else's render left-aligned, symmetrically. No
   change needed, just confirmed via a two-sender fixture in the sandbox.

### Bubble alignment fix — SHIPPED in lite-2.19.2

Once the user actually looked at their own real message history, the
alignment confirmation above turned out to be missing a real bug: bubbles
were sitting inconsistent distances from the avatar — "some pills next to my
name badge, some a few spaces away, giving it a twisted look." Root cause:
the content column (`<div style="min-width:0">` wrapping the bubble + photo +
meta line) was a plain block, so its rendered width was driven by whichever
child was WIDEST — for a short message ("Ok!", "Yep") with a longer meta line
below it (reactions + reply count + date), that meta line's width won, and
the bubble — a left-aligned `inline-block` by default — sat flush-left inside
that wider column instead of hugging the avatar. Looked fine for long
messages (bubble = widest child) and broken for short ones. Fixed by making
the content column `display:flex;flex-direction:column;align-items:flex-end`
(own messages) or `flex-start` (others') so every child — bubble, photo, meta
line — aligns to the same edge as the avatar, regardless of which one is
widest. Verified with a fixture mixing short/long messages and reaction
counts side by side; every bubble now sits flush against the avatar.

### Trophy Room — SHIPPED in lite-2.10.0 (commit `98a784c`)

Built: `renderTrophyRoom` (stat-card feed, camp rankings, by-year bars, award
badges), `renderMasterTrophyRoom` (champion + runner-up per category + contest
champions), shared `loadTrophyData` / `computeTrophyStats` layer, harvest-form
and Harvest Log cross-links, "Trophy added" confirmation. Contest placements
are derived live from `contestEntries` sorted per closed season — no
`closeContest` schema change was needed.

Follow-up polish (do later):
- More cards: trail-cam photos contributed, "first tag filled this year" race,
  biggest-doe-by-weight. (Bear stats — DONE in lite-2.20.0, see below.)
- Real charts beyond the by-year bars — a rack-size trend line, seasonality by
  month. Still hand-rolled SVG.
- Let members pin favourite cards to the top.
- Camp-wide aggregate is loaded fresh each session (`getDocs` on all harvests).
  Fine now; if it ever gets heavy, add a `campStats` summary doc refreshed by a
  Cloud Function.
- `trophyStatCard` bars/points have `title` tooltips but no `<title>` SVG — add
  when the SVG charts land.

### Cabin Trophy Room — more categories + "Not claimed yet" — SHIPPED in lite-2.20.0

User's ask: more categories, and any category/contest nobody's claimed yet
should still be visible so members can see every possible trophy, not just
the ones already won. Closed the species gap first — bear, waterfowl, and
small game had ZERO categories before this (only deer/turkey were covered).
`emptyMemberStats`/`computeTrophyStats` gained `bears`/`heaviestBear`/
`waterfowl`/`smallgame` fields (waterfowl/smallgame count by `quantity`, bear
tracks count + heaviest weight) and matching `rankings` entries. `allCats` in
`renderMasterTrophyRoom` is now 13 categories (was 9), each tagged with an
icon; split into `cats` (at least one member has an entry — rendered as
before, champion+runner-up) and `unclaimed` (zero entries — rendered in a new
dashed-border "Not claimed yet" list, icon dimmed, "no one yet" instead of a
name). Contests got the same treatment: `unclaimedContests` = every
`CONTESTS` entry with no closed-season row this session, listed under the same
"Not claimed yet" block as "not closed yet" (distinguishing a contest that's
simply still open for the year from a stat category nobody's ever touched).
Verified via a temporary `window.__debugTrophyCache(cache)` hook (bypasses the
real `loadTrophyData()` Firestore call by pre-seeding `trophyCache`, removed
after) with a small fixture — buck/doe/turkey/bear harvests split across two
members — confirmed bear categories populate correctly, waterfowl/small game
(no test data) correctly fall into "Not claimed yet" alongside all 5
not-yet-closed contests.

## Also noted (minor, no rush)

- Kill points use read-modify-write on the user doc (`recordKill`,
  `deleteHarvest`) — could use `increment()` for atomicity. Very low risk.
- Trail cam feed re-renders fully on every change (no `hasPendingWrites` skip /
  scroll preserve like feed & harvest lists got).
- `loadMoreFeed` results get wiped when the realtime feed listener re-fires.
- Map full-screen viewer adds a `window` resize listener per open (self-cleans
  on next resize, minor leak).
- Dead code: `harvestPhotoFile`, `calUnsub`, unused stub names in `index.html`,
  `coyote/wolf/fox` branches in `computeKillPoints`.
