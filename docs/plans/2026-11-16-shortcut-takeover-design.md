# Optional native search shortcut takeover

Approved: add a default-off settings switch to use Cmd+K for DeepSearch on macOS, preserving Cmd+Shift+K as fallback. Disabled leaves the native host shortcut untouched; enabling must suppress the duplicate native search event. Local persistence survives reload, and disabling restores behavior immediately without editing host configuration. No arbitrary shortcut recorder in this iteration, no version bump or publication.

Keep existing settings visual language and accessible switch semantics. Handle composing/repeat keys safely, persist errors gracefully, clean event listeners on disposal and support storage updates. Inspect host event ordering before choosing interception mechanism. Test exact modifiers, enabled/disabled dispatch, persistence, failure and cleanup, then refresh existing desktop and verify native-vs-plugin behavior including editable input.

Implementation plan: confirm host dispatch contract; add small preference store and conditional interception; add settings switch/hint/docs; regression tests; review final diff, deploy only local client and verify real GUI.
