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
`openFeedCompose()`, Trail Cam, Trophy Room — not just navigation. Month nav
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

### Trophy Room — SHIPPED in lite-2.10.0 (commit `98a784c`)

Built: `renderTrophyRoom` (stat-card feed, camp rankings, by-year bars, award
badges), `renderMasterTrophyRoom` (champion + runner-up per category + contest
champions), shared `loadTrophyData` / `computeTrophyStats` layer, harvest-form
and Harvest Log cross-links, "Trophy added" confirmation. Contest placements
are derived live from `contestEntries` sorted per closed season — no
`closeContest` schema change was needed.

Follow-up polish (do later):
- More cards: bear stats, trail-cam photos contributed, "first tag filled this
  year" race, biggest-doe-by-weight.
- Real charts beyond the by-year bars — a rack-size trend line, seasonality by
  month. Still hand-rolled SVG.
- Let members pin favourite cards to the top.
- Camp-wide aggregate is loaded fresh each session (`getDocs` on all harvests).
  Fine now; if it ever gets heavy, add a `campStats` summary doc refreshed by a
  Cloud Function.
- `trophyStatCard` bars/points have `title` tooltips but no `<title>` SVG — add
  when the SVG charts land.

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
