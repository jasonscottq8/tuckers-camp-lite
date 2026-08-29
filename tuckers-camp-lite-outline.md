# Tucker's Camp App — Lite Version
## Full Project Outline
**Date:** 2026-05-09
**Version:** Outline v1.0

---

## 1. Overview

A standalone PWA (Progressive Web App) built as an optimized, mobile-first upgrade to the original Tucker's Camp App. Simpler, faster, and more focused — built around 5 core features with a warm lodge aesthetic. Same Firebase project and authentication backend as the original app. Shares Firestore data where appropriate (harvests, trail cam photos, etc.).

---

## 2. Tech Stack

- **Frontend:** Vanilla HTML / CSS / JS (single-page app, same architecture as original)
- **Backend:** Firebase (Firestore, Auth, Storage) — same project: `tucker-s-camp`
- **PWA:** Service worker, installable, update banner
- **Weather:** Open-Meteo API (free, no key required) — Wausaukee/Crivitz, Marinette County WI
- **Hosting:** Firebase Hosting — separate URL (e.g. `lite.tucker-s-camp.web.app` or similar)

---

## 3. Roles & Authentication

### Roles (simplified from original)
| Role | Access |
|---|---|
| **Admin** | Full access, can post bulletins, manage users |
| **User** | Full access to all features |
| **Guest** | Read-only access, can view but not post |

- No president, treasurer, secretary, officer, or half-member roles
- Same login system: email/password + guest key
- Forced name setup on first login
- Settings modal: display name, initials, avatar color
- Logout always returns to home screen

---

## 4. Design System

### Aesthetic
- **Lodge / log cabin feel throughout**
- Wood plank photo texture as the app background (CC0 licensed, hosted in Firebase Storage)
- Dark overlay on wood texture to ensure readability
- Warm amber/gold accent color: `#c4a96a`
- Dark forest header/nav: `#1a1f12`
- All buttons and borders: **rounded corners** (no sharp edges anywhere)
- Cards: semi-transparent dark overlay on wood, rounded corners, warm border

### Typography
- **Headers/titles:** Playfair Display (serif, lodge feel)
- **Body/UI:** System sans-serif
- **No Cormorant Garamond** (field journal removed)

### Color Palette
| Element | Color |
|---|---|
| App background | Wood texture photo + dark overlay |
| Header / bottom nav | `#0f1409` (near black forest) |
| Card background | `rgba(20, 14, 6, 0.75)` |
| Card border | `rgba(196, 169, 106, 0.25)` |
| Gold accent | `#c4a96a` |
| Primary text | `#e8d9b0` (warm parchment) |
| Secondary text | `#8a9a72` (muted green) |
| Danger / alerts | `#c05a2a` |
| Success | `#5a9c4a` |

### UI Rules
- All buttons: rounded corners (`border-radius: 12px` minimum)
- All cards: rounded corners (`border-radius: 16px`)
- All modals: centered, app-themed (no raw browser `alert()`, `confirm()`, `prompt()`)
- Toast notifications: centered on screen, z-index 9999
- Back button always visible when inside a section accessed from home screen
- Active states use gold accent color

---

## 5. App Structure

### Shell
- Fixed header (logo + bell notification icon)
- Scrollable main content area
- Fixed bottom navigation bar (3 items)

### Bottom Navigation
| Tab | Icon | Destination |
|---|---|---|
| Home | House | Home screen |
| Map | Map pin | Map page |
| More | Hamburger | Slide-out drawer |

### Hamburger Drawer (More menu)
- By-Laws
- Contests (Big Buck / Big Doe — full functionality)
- Settings
- App Updates / Changelog
- Logout

---

## 6. Screens & Features

---

### 6.1 Home Screen

**Header**
- App name "Tucker's Camp" in Playfair Display
- Bell icon (top right) with red badge showing unread count
- Tapping bell shows notification panel

**Hero Image**
- Full-width image at top (cabin/nature scene — image TBD, user to provide)
- Overlaid with subtle dark gradient at bottom for text legibility

**Weather Strip**
- Small single-line strip below hero
- Shows: current temperature + wind speed/direction
- Pulled from Open-Meteo API for Wausaukee/Crivitz WI
- Updates on page load

**News / Bulletins Section**
- Pinned above all other content
- Distinct bordered panel — always visible without scrolling
- Posted by admin or any user/half-member
- Text only (no photos — photos go to the feed)
- Shows 2 most recent bulletins with "View All" link
- Admin can pin a bulletin to keep it at top

**2x2 Feature Button Grid**
- 4 large rounded buttons in a 2-column grid
- Each has an icon + label
- Buttons:

| Button | Icon | Destination |
|---|---|---|
| Harvest Log | Antlers/deer | Harvest Log page |
| Trail Cam | Camera | Trail Cam page |
| Cabin Calendar | Calendar | Cabin Calendar page |
| Feed | Speech bubble | Social Feed page |

**Recent Harvests Strip**
- Section header: "Recent Harvests" with star accents
- Shows last 3 harvest entries (species, member name, date)
- Each row is tappable → goes to that harvest entry
- "View All" link → goes to full Harvest Log

---

### 6.2 Harvest Log

**List View**
- Entries sorted newest first
- Each card shows: species icon, member name, date, weight/score if entered
- Filter by species
- Tap any entry → Detail view

**Detail View**
- Full harvest info: species, date, member, weight, rack score, notes
- Harvest photo (tap to reveal, blurred until tapped)
- Reactions (emoji picker, max 2 types)
- Comments: add, edit, delete (author + admin only)
- **"Compare to Trail Cam"** button → opens comparison view

**Comparison View**
- Harvest photo pinned at top (full width)
- Trail Cam photo browser below — vertical scroll
- User scrolls through trail cam photos to find a match
- Mobile-optimized: large images, easy scrolling

**Add Harvest**
- Floating action button (+ icon)
- Species selector: Deer, Turkey, Waterfowl, Small Game, Bear, Other
- Fields: date, weight, rack score (B&C), notes
- Optional photo upload
- Anyone can add

**Archive**
- Entries older than 48 hours archive by hunting season
- Archived entries accessible via "Archive" button

---

### 6.3 Trail Cam Photos

**Overview**
- Organized by date (newest first)
- Date headers as section dividers
- Grid view: 2 columns of photo tiles per row
- Each tile: tap-to-reveal (blurred until tapped), date, uploader name
- 24-hour live window → then archives

**Upload**
- Floating action button (+ icon)
- Photo picker + optional caption/note
- Date auto-filled (editable)
- Anyone can upload — encouraged

**Archive**
- Archived dates shown with dashed gold border
- Archive browsable by month
- Archived photos always tap-to-reveal

**Detail View**
- Full screen photo
- Caption/note if added
- Uploader name + timestamp
- Reactions
- "Use in Harvest Comparison" button → takes user to harvest log to pick an entry

**Design priority:** This section should be the most visually polished area of the app — large photos, smooth transitions, easy browsing.

---

### 6.4 Cabin Calendar

**Calendar View**
- Monthly calendar grid
- Days with visits marked with gold dot
- Tap a day → see who's going / who went + notes
- Tap again → add your own visit entry

**Visit Entry**
- Date (auto-filled)
- Notes field
- Anyone can log a visit

**Archive**
- Past months archived
- Accessible via month/year picker

---

### 6.5 Social Feed (X-style)

**Feed**
- Continuous scroll of posts, newest first
- Each post shows:
  - Avatar circle (initials + color)
  - Member name + timestamp
  - Post text
  - Optional photo (tap to expand)
  - Reaction bar
  - Reply count → tap to expand thread

**Posting**
- Floating action button (+ icon) or top-of-feed compose bar
- Text body (required)
- Optional photo attach
- Anyone can post

**Replies**
- One level of threading (reply to a post, not reply to a reply)
- Replies indented under original post
- Collapsed by default — tap to expand
- Anyone can reply

**Reactions**
- Emoji picker, max 2 reaction types per post
- Count visible

**Moderation**
- Author can edit/delete own posts and replies
- Admin can delete any post or reply

---

### 6.6 Map

**Layout**
- Google My Maps embed (full width, same as original app)
- Tucker's Camp map image below (tap to zoom — full screen lightbox)
- Back button to home

---

### 6.7 Hamburger Drawer Pages

**By-Laws**
- Static text (placeholder until real articles provided)
- Member comments section

**Contests**
- Big Buck Contest
- Big Doe Contest
- Same full functionality as original app
- Organizer = admin

**Settings**
- Display name
- Initials
- Avatar circle color (color swatches)
- Notification preferences (individually toggled):
  - New feed posts
  - New bulletins
  - New trail cam uploads
  - New harvests
- Reload/Update button (PWA update trigger)
- Logout

**App Updates**
- Changelog (same format as original)

---

## 7. Notifications

- Bell icon in header with red badge (unread count)
- Default on: new feed posts, new bulletins
- Default off: new trail cam uploads, new harvests
- All individually togglable in Settings
- Notification panel: tapping bell shows list of recent activity
- Tapping a notification item navigates to relevant content

---

## 8. Firebase Collections (New/Modified)

| Collection | Purpose | Notes |
|---|---|---|
| `users` | Auth + profile | Simplified roles: admin, user, guest |
| `bulletins` | News/bulletin posts | Same as original |
| `harvests` | Harvest log entries | Same as original |
| `trailcam` | Trail cam photos | **New** — separate from harvests |
| `visits` | Cabin calendar entries | Same as original |
| `feed` | Social feed posts | **New** |
| `feed/{id}/replies` | Replies to posts | **New** subcollection |
| `contests` | Contest entries | Same as original |
| `guestKeys` | Guest login keys | Same as original |

**Firebase Storage paths:**
- `harvests/{date}/{uid}{timestamp}.jpg` (same as original)
- `trailcam/{date}/{uid}{timestamp}.jpg` (new)
- `feed/{uid}_{timestamp}.jpg` (new)
- `assets/wood-bg.jpg` (background texture)
- `assets/hero-image.jpg` (home screen hero — TBD)

---

## 9. PWA / Auto-Update

- Service worker (`sw.js`) with APP_VERSION bump on every deploy
- Installable on phone home screen
- Update banner appears automatically when new version deployed
- Reload/Update button in: hamburger drawer, Settings modal, login screen
- Background sync for offline resilience (basic)

---

## 10. File Structure

```
index.html        — App shell, all screens as sections
app.js            — All logic (~est. 2,500-3,000 lines)
style.css         — All styles (~est. 600-800 lines)
firebase.js       — Firebase init (same as original)
sw.js             — Service worker
```

---

## 11. Build Order (Recommended Sequence)

1. **Shell & Auth** — login screen, guest key, forced name setup, logout
2. **Home Screen** — header, hero, weather strip, news section, 2x2 grid, recent harvests
3. **Design System** — wood background, color palette, card styles, button styles, modals
4. **Harvest Log** — list, detail, add, archive, reactions, comments
5. **Trail Cam** — upload, grid view, detail, archive, tap-to-reveal
6. **Harvest Comparison** — comparison view linking harvest + trail cam
7. **Cabin Calendar** — calendar grid, visit logging, archive
8. **Social Feed** — post, reply, react, photo, moderation
9. **Map** — embed + image lightbox
10. **Hamburger Drawer** — by-laws, contests, settings, notifications, changelog
11. **Notifications** — bell badge, panel, user preferences
12. **PWA** — service worker, install prompt, update banner
13. **Polish & Testing** — mobile QA, button/border audit, performance

---

## 12. Known Decisions Pending

- [ ] Hero image (user to provide photo for home screen top)
- [ ] Contests page full build-out (deferred — accessible from hamburger for now)
- [ ] Guest key management UI (admin side)
- [ ] By-laws text (placeholder until real articles provided)
- [ ] Exact deploy URL for Lite version

---

## 13. Critical Rules (Carried Over)

- ALWAYS work from workspace files. Never edit uploaded files directly.
- Bump APP_VERSION in both `app.js` and `sw.js` on every deploy.
- No raw browser `alert()`, `confirm()`, `prompt()` — use `appConfirm()` / `appPrompt()`.
- No reCAPTCHA.
- Scan for curly quotes before finalizing any JS.
- All back buttons return to home screen.
- All corners rounded — no sharp edges anywhere.
- Mobile-first at all times — test every feature at 390px width.
