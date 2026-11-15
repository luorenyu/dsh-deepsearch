# Archive navigation verification — local release 0.1.15

- 110 unit/regression tests passed; syntax checks and diff whitespace checks passed.
- Backend tests cover archive flags for title/body, filtering and cursor snapshots.
- Client VM tests cover badge rendering, confirmation/cancel, stale archive flags, failed/successful/late restores, duplicate requests, unknown workspace state and normal native navigation.
- Preserves the concurrently added optional manual-unread menu, blue dot, local preferences and Settings switch; eight unread regressions pass.
- Isolated actual React fixture (fictional data, no real host mutations) checked desktop 1280×900 and compact 390×844: badge/confirmation visible without clipping, Cancel preserves results with zero mutations, pending cancellation prevents late navigation, Escape dismisses confirmation.
- Actual Desktop 0.1.15 AX verification: query `luc`, include archived on, 9 hits and complete 33/33; archived title/body rows display 已归档. Clicking an archived title shows 恢复并打开 / 取消; Cancel removes the prompt while preserving query and all nine results. No restore was approved. Settings still contains the existing manual-unread control and local-only help; its prior enabled preference was left unchanged.
- Installed scoped package version 0.1.15 and client bytes match the reviewed source; the prior unscoped package is absent.
- Live successful restoration of real user archived history was intentionally not exercised. Do not treat mocked restoration as native end-to-end acceptance.
- Package is installed locally only; this task does not publish a new npm or GitHub release.
