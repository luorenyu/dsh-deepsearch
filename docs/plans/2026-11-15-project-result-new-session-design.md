# Project search results open a new conversation

Approved by the user on 2026-11-15.

## Interaction
- Clicking a project result or pressing Enter on the selected project invokes DSH native `uiWorkspace.startSession(workspaceId)` and closes DeepSearch.
- Project helper text becomes “工作区 · 点击或回车新建会话”.
- The workspace dropdown remains the search-scope control. Conversation and message results retain existing navigation.
- No search query is submitted or inserted as a prompt. No draft replacement or clearing options are passed. DSH may reuse an existing blank session and preserve its draft, matching the native New Session action.

## Integration and failure behavior
- Use the public navigation service, not direct controller creation or DOM automation.
- Cancel a pending search-message locator before new-session navigation; select the main conversation panel.
- Preserve current input and results and display an inline error if the host lacks the API or throws synchronously. Native asynchronous creation failures are reported by the host notice channel, with the native selection retained.
- Existing closed/disposed/IME guards remain effective.

## Implementation plan
1. Extend the actual-plugin interaction harness with project catalog fixtures and a native startSession spy. Add regression tests for click, Enter, dropdown filtering, synchronous failure, unsupported host and IME safety.
2. Replace only the project branch of choose(), and its helper copy. Update usage docs.
3. Run syntax, full unit suite, demo fixtures and diff checks; review changes.
4. Back up installed client, update only that client artifact and refresh the existing desktop. Verify target-workspace blank-session navigation without submitting any message. No npm publication or version bump is included.
