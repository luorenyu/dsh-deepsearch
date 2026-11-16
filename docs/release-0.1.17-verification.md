# 0.1.17 release verification

## Scope

- Local history and preferred tab order; default archived scope; recent workspace/last-update metadata; compact settings.
- Native project creation without panel-navigation cancellation, plus one-shot sidebar compatibility reveal.
- Optional native macOS Desktop Cmd+K takeover using the official shortcut configuration API and a local recovery journal.
- Existing manual unread, archive confirmation, full-text search and message navigation retained.

## Automated checks

- `npm test`: 256 tests passed before release preparation and again after version bump.
- `npm run check`: all four published JavaScript entry points parsed successfully.
- `node --test scripts/demo/*.test.mjs`: four fictional-fixture/mock-service checks passed.
- `git diff --check`: passed.
- Version consistency tests cover manifest exports, backend cache keys, runtime and client footer.

## Prior actual-desktop checks

Verified locally against DSH Desktop 0.2.2-rc.3 on macOS before release packaging: project click and Enter reach the native blank composer; collapsed/offscreen workspace is revealed; optional Cmd+K enable, reload, editable focus and disable/restore; settings reset alignment and recent metadata; history idle recording/replay/persistence/clear; preference changes reorder tabs without switching content and reopen selects the preferred tab.

Some edge cases, including individual history deletion, cancellation during sidebar reveal and shortcut failure rollback, are covered by contract tests rather than claimed as visual validation. Mock screenshots are not evidence of native navigation, configuration persistence or cross-platform compatibility.

## Release checks

Registry integrity, clean consumer installation and published URLs must be verified after publication. No credentials, real conversations or local preference payloads are included in the package or demonstration fixtures.
