# README screenshots: isolated component demo

Run from the repository root:

```sh
node --test scripts/demo/*.test.mjs
node scripts/capture-demo.mjs
```

Requires Node 22+, npm, and `agent-browser` with a Chromium installation (`agent-browser install`).
The capture script installs pinned React 18.3.1 + ReactDOM 18.3.1 in a fresh OS temporary directory, starts an ephemeral loopback-only server, uses a named fresh headless browser session, writes ten feature images plus separate component-unread evidence and machine-readable records to `docs/images/`, and closes the browser/server and removes temporary dependencies in `finally`. It does not attach to the real DSH page, existing browser, CDP, accounts or conversation data.

## What is real

The server serves the repository's current `client.js` byte-for-byte. Its `window.__ModuleLoader__.load` factory runs with real React. The actual `Overlay` component is registered in `shell.overlay`. The actual component supplies all search UI, highlighting, timestamps, keyboard shortcut, project selection, workspace selector, archive checkbox, appearance controls, state updates, and CSS. The capture script performs browser interactions; it does not draw a replacement search panel or rewrite the component source.

## What is mocked

- The module loader and minimal injected host context (`slots`, `uiSession`, `uiWorkspace`, `sessions`, `layout`, `contextMenus`).
- The sidebar row layout, context-menu frame and `StateDot` visual. The plugin really requires the primitives module and renders its registered `ManualUnreadDot` with `StateDot({state:"done"})`; this isolated host supplies a clearly disclosed green-dot mock, **not the native host implementation or a real DSH screenshot**.
- `retainedBy.mainView` transitions only for invented sessions, used to verify the actual plugin auto-read subscription.
- Allowlisted catalog/search HTTP endpoints, responding only from `fixtures.mjs`.
- All Chinese conversation titles, messages, dates, workspaces and IDs: invented documentation data.
- The backdrop and CSS theme tokens normally supplied by the host. The dark screenshot demonstrates the component's actual “跟随 DSH” control against mocked dark tokens, not a running native host/theme integration.

The isolated host rejects real native navigation. Project selection invokes only an in-memory startSession callback and closes the overlay; workspace filtering is exercised separately through the selector. No screenshot claims native message navigation or positioning/highlight success. Every screenshot contains a visible “演示数据 / isolated demo” disclosure.

## Screenshots

1. `01-search.png`: Chinese match, actual excerpt highlighting and formatted message timestamps.
2. `02-projects.png`: actual 项目 results and the native New Session hint; only the mock callback is exercised. The workspace dropdown independently filters to 星河.
3. `03-archived.png`: check 含归档; the archived fictional result appears.
4. `04-glass.png`: actual 毛玻璃 controls, mocked backdrop/material token.
5. `05-theme.png`: actual 跟随 DSH controls with mocked dark host tokens.
6. `06-custom.png`: actual custom color, opacity and blur controls.
7. `07-unread-settings.png`: actual 设置 / 会话未读标记 switch, enabled through a browser click.
8. `08-unread-menu.png`: approved fictional sidebar illustration inside the same feature-card frame as the other images. Re-render with `node scripts/render-unread-card.mjs`. This image is not component/runtime evidence. The separate `component-unread-evidence.png` preserves the actual plugin menu/leading-slot mock-host capture used for behavioral checks. Scene source: `unread-scene.html`; the card embeds that scene as srcdoc in `unread-card.html`.

9. `09-history.png`: real local recording, preferred history tab, replay and fictional fixed timestamps.
10. `10-settings.png`: compact controls and real takeover controller using an explicitly mocked in-memory shortcut service.

See [CAPTURE.md](CAPTURE.md) for current capture boundaries and exact assertions. The approved illustration is preserved byte-for-byte.

The capture also exercises 标记为已读, marks the fictional row again, and clicks it to simulate a `mainView` re-entry. The actual plugin subscription clears its persisted mark and unmounts the leading dot. This is a mocked host transition, not proof of native host navigation.

`demo-evidence.json` records the exact client SHA-256/version, rendered control values, result counts, highlighted strings, mock requests, and the navigation-not-attempted check. Browser errors fail the capture. Rerun screenshots after changing client/version so the real footer stays current.
