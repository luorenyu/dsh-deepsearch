# Changelog

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
