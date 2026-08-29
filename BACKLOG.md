# Tucker's Camp Lite — Backlog

Known issues to address after the stress-test weekend (2026-08-29 sweep, v2.9.3).
Revisit once we know which ones actually bite in real use.

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
