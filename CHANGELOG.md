# Changelog

## 0.1.17

- Add local search history: one-second idle recording outside IME composition, 30 deduplicated keywords, replay, individual deletion and clear; no result or chat content is stored.
- Add a persistent Default history preference with immediate tab ordering, preserved current content and the preferred start view on reopen.
- Open project results in the native new-conversation page without aborting host navigation; make one bounded sidebar expand/reveal attempt after navigation succeeds.
- Add opt-in macOS Desktop native ⌘K takeover through the official shortcut service, with recovery journaling, guarded rollback, original-binding restoration and unchanged ⌘⇧K fallback. Turn takeover off before uninstalling.
- Include archived conversations by default in the UI while retaining the backend API’s opt-in archive behavior; require confirmation before restoring archived results.
- Show recent conversations’ workspace and last update in local time, including live host summary fallback for older catalogs.
- Compact Settings: inline reset icon, concise shortcut help with full accessibility details, aligned Settings/Esc controls, and updated bilingual documentation and badges.
- Preserve existing appearance, manual-unread and local preference keys.

## 0.1.16

- Add public documentation images for the opt-in manual-unread settings, session context menu and left-side indicator, using fictional demo data.
- Reuse the native DSH `StateDot` unread component in the leading sidebar slot; native running, interaction and completion states retain priority.
- Stop result-list scrolling on mouse hover while preserving keyboard navigation and wraparound scrolling.
- Include the archive badges and confirmed restore-and-open workflow from the local 0.1.14–0.1.15 builds in the public release.
- Preserve existing local appearance and manual-unread preferences; manual unread remains off by default and local to each client.

## 0.1.15

- Preserve the concurrently added, opt-in local manual-unread menu, blue dot and settings alongside the archive-navigation fix.
- Keep the scoped package identity and local preference keys unchanged.

## 0.1.14

- Mark archived title and message hits with an explicit “已归档” badge.
- Confirm restoration before opening archived results in the native conversation.
- Recheck live workspace state and keep search results visible when restoration fails or is cancelled.
- Prevent duplicate restoration and stale navigation after closing or changing search scope.

## 0.1.13

- Publish the public npm package as `@renyuluo/dsh-deepsearch`; the unscoped package belongs to another author.
- Align the Cordis bundle package reference and browser module ID with the scoped identity.
- Preserve product title, repository, local appearance settings and search behavior.
- Document explicit replacement of this project’s prior unscoped GitHub install to avoid duplicate plugin instances.

## 0.1.12

First portable public GitHub release.

- Literal, case-insensitive Chinese and English conversation search.
- Current-session newest-first scanning and automatic bounded continuation.
- Highlighted compact previews and local minute-precision timestamps.
- Workspace/project filtering and optional archived sessions.
- Native conversation opening with exact-event checks and best-effort row navigation; no replacement transcript.
- Configurable glass, theme and custom appearance; wallpaper-plugin compatibility.
- Portable package-root bundle entry, localized metadata and manifest exports.
- No production dependencies, install scripts, external search endpoint or persistent conversation index.

Earlier versions were local development builds and are not part of this public repository history.
