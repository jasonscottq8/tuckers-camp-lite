# Tucker's Camp Lite — Backlog

Known issues to address after the stress-test weekend (2026-08-29 sweep, v2.9.3).
Revisit once we know which ones actually bite in real use.

## Next full code sweep — focus: CONSISTENCY + APP SAFETY

The next deep pass should be dedicated to these two themes, not features.

### Safety (do first)

- **Firestore security rules are wide open.** Current rule:
  `allow read, write: if request.auth != null` on every document. That means any
  signed-in member can read *and overwrite/delete* anything — every other
  member's harvests, the whole feed, bulletins, guest keys, the admin log — and
  can promote their own account to admin with a one-line
  `updateDoc(doc(db,'users',myUid),{role:'admin'})`. Tighten to:
  per-user write on own `users/{uid}` doc (but NOT the `role` field — admin
  only), authors can edit/delete their own content, admins can do the rest,
  reads scoped sensibly. Same for Storage (currently any auth write anywhere
  under 25 MB).
- **Password policy is weak** — `doChangePassword` only requires 6 characters.
  Consider raising the minimum and/or enabling Firebase's built-in password
  policy + email-enumeration protection.
- **Two-factor auth.** Priorities / cost (project is on Blaze, everything free
  so far at ~12 users):
  1. Turn on Google-account 2-step verification for the account that owns the
     `tucker-s-camp` project — free, do first, protects the whole backend.
  2. Optional member 2FA via Firebase Auth MFA. Enabling it upgrades the
     project to Identity Platform (free tier 50k MAU, so free at our size, but
     it's a semi-one-way door — do it deliberately in this sweep).
     - TOTP / authenticator-app second factor: **free**, no per-use cost.
     - SMS second factor: ~1–5¢ per text + needs abuse protection. Avoid unless
       members won't use an authenticator app.
     Recommend TOTP-only.
- **Guest access model** needs a look — guest "sessions" are pure client-side
  `sessionStorage` with no Firebase auth, so a forged `role:'admin'` in
  sessionStorage would show the admin UI (writes would fail at the rules layer,
  but it's confusing and leaks the layout). Verify guests can actually read what
  they're supposed to and nothing more.
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

1. **Comment race / lost comments.**
   Comments are stored as an array on the post/harvest/photo doc and saved with
   read-modify-write (`getDoc` → `push` → `updateDoc`). Two people commenting on
   the same item within the same moment can overwrite each other. Same for
   edit/delete comment.
   *Proper fix:* move comments to a Firestore subcollection
   (`feed/{id}/comments/{commentId}`), or at minimum use a transaction.
   Affects: `submitFeedComment`, `submitHarvestComment`, `submitTcComment`,
   `editComment`, `deleteComment`.

2. **Orphaned Storage files.**
   Deleting a harvest, trail cam photo, feed post, or contest entry removes the
   Firestore doc but not the image file in Cloud Storage. Files accumulate
   forever.
   *Proper fix:* on delete, also `deleteObject(ref(storage, ...))` for the
   photo URL (parse the path out of the download URL, or store the storage path
   alongside the URL when uploading).
   Note: the admin "keep photo in the log" option deliberately keeps the file —
   don't delete when `keepPhoto` is true.

3. **"Change Email" is deprecated.**
   `updateEmail()` (in `doChangeEmail`) is deprecated by Firebase; projects with
   email-enumeration protection reject it and require `verifyBeforeUpdateEmail`.
   Likely fails with a generic "Could not update email."
   *Proper fix:* switch to `verifyBeforeUpdateEmail` (sends a confirmation link
   to the new address) and update the success copy to say "check your inbox".
   Also: the wrong-password branch checks `auth/wrong-password` but modern
   Firebase returns `auth/invalid-credential` on reauth — update both
   `doChangeEmail` and `doChangePassword`.

4. **No real offline support.**
   The service worker caches the app shell, but `firebase.js` imports the SDK
   from `https://www.gstatic.com/...`, which the SW can't cache (external
   origin). With no connection the app shows a blank screen instead of a cached
   view.
   *Options:* bundle the Firebase SDK locally and add it to `STATIC_ASSETS`, or
   accept it and show a friendly "you're offline" screen. Also fix the SW fetch
   handler to fall back to `/index.html` for uncached navigation requests
   (deep links break offline right now).

5. **`cabinmap.jpg` is 4.2 MB.**
   Full-res phone photo of the hand-drawn map. Slow first load on camp cell
   service (cached for a week after, per `firebase.json` headers).
   *Fix:* resize to ~2000 px wide / ~70% JPEG quality → a few hundred KB with no
   visible quality loss at the zoom levels the viewer allows. Replace the file
   in `Images/` with the same name; bump the SW version to force the refresh.

## UI changes to make

- **Remove "Tag Animals in Photo" from the trail cam photo expansion / lightbox.**
  Not needed — a comment or a reaction emoji is enough on a trail cam photo.
  Remove the tag pill row (`renderTcTagPills` call in `renderTcLightboxBody`,
  the `#tc-tag-list` block) and the `toggleTcTag` handler. **Also remove the
  "🔍 Filter Photos" tag filter** on the trail cam feed (`openTcFilterModal`,
  `closeTcFilterModal`, `toggleTcFilterPill`, `applyTcFilters`, `clearTcFilters`,
  `tcActiveAnimals`, the filter bar in `renderTrailCamScreen`, and the filter
  branch in `renderTcFeed`) — confirmed, for consistency. `TC_ANIMALS` and the
  `animalTags` field can stay in old docs; just stop reading/writing them, and
  drop the tag-icon summary from the collapsed row header too.

## Feature ideas

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
