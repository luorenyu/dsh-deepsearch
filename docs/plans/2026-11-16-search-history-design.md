# Search history — approved local enhancement

- Empty-query view has Recent conversations and Search history tabs next to each other. Existing result-type tabs and search behavior stay unchanged.
- Default search history checkbox sits immediately before Include archived; preference is local, initially false, and chooses the empty view on every overlay opening.
- Store only trimmed search keywords, no result/chat payload; deduplicate by exact keyword, newest first, max 30 entries, each at most input limit 256 characters.
- Record once after one second without input while overlay is visible and IME composition inactive. Cancel pending record on change, close and disposal; do not record empty input.
- History activation by click or input Enter fills the input and performs normal search, never opens a conversation directly. Arrow navigation retains existing behavior.
- Single remove and Clear history controls; no nested buttons; local storage failures leave in-memory use available with visible warning. Validate persisted data, cross-window storage updates, keep history/pref independent of unread/shortcuts/appearance.
- Keep existing visual theme, native-navigation safety, default archived behavior, recent workspace/time metadata. Add renderer and storage regression tests; inspect diff and deploy client only. No version bump, publication, host config edits, component toggles or whole-app restart.
