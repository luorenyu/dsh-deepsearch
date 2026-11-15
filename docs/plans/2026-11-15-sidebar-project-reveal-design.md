# Project sidebar reveal

Approved: choosing a project keeps native startSession navigation. After confirmed main-session ownership of that workspace, expand collapsed ancestors and target, then reveal the project and new session once. Preserve other expansion state. Never call selectPanel after startSession. Missing DOM is a no-op.

DSH 0.2.2-rc.3 exposes no sidebar reveal command. Use exact data-row-key identifiers and aria-expanded, not titles or private React state. Determine ancestors from host path metadata. Bound waiting and cancel on new search, navigation, user input, disposal or timeout. Disconnect after success. No version bump or publication.

Plan: inspect host contracts; add cancellable helper outside Overlay lifetime; test delayed navigation, nesting, one-shot scroll and cancellation; review full diff and tests; deploy client only and verify existing desktop GUI.
