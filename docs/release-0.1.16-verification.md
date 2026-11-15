# DeepSearch 0.1.16 release verification

- Includes local archive-navigation builds 0.1.14–0.1.15, optional persistent manual-unread settings and menu, native leading StateDot correction, and the hover-scroll regression fix.
- Source regressions: 111 passed; syntax and whitespace checks passed. Demo fixtures are checked separately.
- Release contracts assert versioned backend export, package allowlist, backend/core cache-busting query, and matching client footer.
- A clean consumer installation of the prepared tarball imported the backend and both localized metadata files successfully. Final published registry integrity and clean installation are checked during publication.
- Manual unread and hover behavior were previously verified in DSH Desktop 0.2.2-rc.3: native left-side dot, mark/read menu, persistence after refresh, clearing on re-entry, hover without scroll and keyboard scrolling. Real user archive restoration was not performed.
- Documentation images use fictional data and an isolated mock host. Mocked host primitives, menu framing and sidebar scaffolding are not evidence of native-host integration.
- Local preference keys and scoped package identity remain unchanged. This release does not upload messages, synchronize unread state across devices or change native completion reminders.
