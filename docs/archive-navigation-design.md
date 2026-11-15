# Archived result navigation — approved 2026-11-15

- Search includes archived history only when requested; every title/message hit carries an explicit archive snapshot flag.
- An archived result displays “已归档”. Client live workspace state is authoritative when the user chooses a result; stale search flags must not cause silent restoration.
- Selecting an archived hit keeps the search panel and opens an inline confirmation with “恢复并打开” and “取消”. Keyboard Enter on the search field never implicitly confirms a mutation.
- Only explicit confirmation calls the host public unarchive service. Wait for success and check the current archive state before normal native conversation opening and exact-message navigation. No embedded transcript replacement.
- Cancel, query/filter change, close, unmount, disposal and superseding operations invalidate late navigation. Duplicate confirmations do not issue duplicate mutations. A sent restore request may still complete on the host; cancelling the UI cannot roll back it and must not automatically rearchive.
- Failures/timeouts keep results and display an actionable error. Unknown/disconnected workspace state must not be treated as permission to mutate or open a known archived result.
- No chat messages are edited or submitted; no real archived sessions are changed during unattended verification. Test successful mutations using mock host state.
- Regression scope: flags for title/body, archive filters and cursor snapshots; badge rendering, confirm/cancel, stale flags, failed/late/successful restores, duplicate clicks and normal native navigation.

Release 0.1.14 will be packaged and installed locally. npm/GitHub publication is not part of this fix unless separately requested.
