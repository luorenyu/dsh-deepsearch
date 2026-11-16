# History preference and header alignment

Approved: 2026-11-16. Local update only, no publication.

- Rename 默认搜索历史 to 默认历史; retain the existing storage key and preference.
- Use one explicit box height, line height and inline-flex centering for 设置 and esc. Keep their existing appearance and actions.
- Render empty-query tabs history/recent when defaultHistory is true, recent/history otherwise. Change order immediately when preference changes; preserve selected content until the user chooses a tab or reopens.
- On every reopen use the existing preference reset, selecting the first tab. Preserve keyboard selection, history replay and deletion.

Implementation plan: add actual Overlay regression tests for both preference states, immediate reorder without content switching, reopen and persistence. Update client markup and button CSS; run the complete suite, syntax checks and diff checks. Copy only the client to the installed scoped plugin, refresh the existing DSH and verify tab order and header alignment without backend/plugin toggling.
