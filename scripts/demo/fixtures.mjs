// Entirely invented documentation fixtures. Never read session storage or a real host.
export const workspaces = [
  {id:'demo-orbit', title:'星河 · 客户端体验'},
  {id:'demo-island', title:'青屿 · 知识整理'},
  {id:'demo-sail', title:'云帆 · 发布工程'},
];
export const conversations = [
  {id:'demo-s1', title:'搜索面板：中文检索体验', workspaceId:'demo-orbit', time:'2026-10-12T09:20:00+08:00'},
  {id:'demo-s2', title:'键盘操作与无障碍检查', workspaceId:'demo-orbit', time:'2026-10-11T16:45:00+08:00'},
  {id:'demo-s3', title:'知识库整理：保留上下文', workspaceId:'demo-island', time:'2026-10-10T14:10:00+08:00'},
  {id:'demo-s4', title:'秋季版本发布清单', workspaceId:'demo-sail', time:'2026-10-09T11:30:00+08:00'},
  {id:'demo-s5', title:'旧版方案复盘（已归档）', workspaceId:'demo-orbit', time:'2026-09-18T10:05:00+08:00', archived:true},
];
export const messages = [
  {id:'demo-m1',sessionId:'demo-s1',seq:12,role:'user',snippet:'请把验收记录整理成三部分：中文检索、命中摘要与消息时间，再补上工作区筛选的检查项。',time:'2026-10-12T09:20:00+08:00'},
  {id:'demo-m2',sessionId:'demo-s2',seq:24,role:'assistant',snippet:'验收记录已补充：快捷键唤起面板，方向键选择结果，Escape 关闭；同时检查中文输入法组合期间不误触。',time:'2026-10-11T16:45:00+08:00'},
  {id:'demo-m3',sessionId:'demo-s3',seq:18,role:'assistant',snippet:'知识整理时不要只记标题。验收记录需要保留命中前后的上下文，便于快速辨认当时讨论的方案。',time:'2026-10-10T14:10:00+08:00'},
  {id:'demo-m4',sessionId:'demo-s4',seq:32,role:'user',snippet:'发布前请复核验收记录：README 示例全部使用虚构数据，不展示私人对话，也不冒充原生定位成功。',time:'2026-10-09T11:30:00+08:00'},
  {id:'demo-m5',sessionId:'demo-s5',seq:8,role:'assistant',snippet:'这份旧版验收记录已归档，仍可勾选“含归档”查回；与当前项目的新版方案对照阅读。',time:'2026-09-18T10:05:00+08:00'},
];
export function catalog({includeArchived=false}={}) {
  return {workspaces, sessions:conversations.filter(s=>includeArchived || !s.archived).map(s=>({...s,updatedAt:Date.parse(s.time)}))};
}
export function search(body) {
  const query = String(body.query || '').trim();
  const sessions = conversations.filter(s=>(!body.workspaceId || s.workspaceId===body.workspaceId) && (body.includeArchived || !s.archived));
  const items = messages.flatMap(message=>{
    const session=sessions.find(s=>s.id===message.sessionId), start=message.snippet.indexOf(query);
    if (!session || !query || start<0) return [];
    return [{...message,archived:session.archived===true,title:session.title,workspaceId:session.workspaceId,workspaceTitle:workspaces.find(w=>w.id===session.workspaceId).title,range:[start,start+query.length],kind:'message'}];
  });
  return {items,cursor:null,scanned:sessions.length,totalSessions:sessions.length,warnings:[]};
}
