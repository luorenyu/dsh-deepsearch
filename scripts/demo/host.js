/* Only host adapters and StateDot are mocked. Plugin components, unread store,
   context-menu resolver, settings controls and leading-slot component are real. */
const {createElement:h, useSyncExternalStore} = window.React;
const root = window.ReactDOM.createRoot(document.getElementById('plugin-root'));
const sidebarRoot = window.ReactDOM.createRoot(document.getElementById('demo-sidebar'));
const cleanups = [];
const emptyStore = {getSnapshot:()=>null, subscribe:()=>()=>{}};
window.__DEEPSEARCH_DEMO__ = {nativeNavigationAttempted:false, mockSessionOpens:[]};
window.__ModuleLoader__ = {
  async load({factory}) {
    // Local, invented catalog only. No real host or browser profile is connected.
    const {sessions} = await fetch('/api/deepsearch/catalog').then(response=>response.json());
    const sessionListeners = new Set();
    let sessionState = {byId:Object.fromEntries(sessions.map(row=>[row.id,{...row,retainedBy:{mainView:0}}]))};
    const sessionStore = {getSnapshot:()=>sessionState, subscribe:fn=>{sessionListeners.add(fn);return ()=>sessionListeners.delete(fn);}};
    const leading = [], menus = [];
    let refreshSidebar = ()=>{};
    const mockOpen = id=>{
      window.__DEEPSEARCH_DEMO__.mockSessionOpens.push(id);
      sessionState = {byId:Object.fromEntries(Object.entries(sessionState.byId).map(([key,row])=>[key,{...row,retainedBy:{mainView:key===id?1:0}}]))};
      for(const listener of sessionListeners)listener();
    };
    function StateDot({state}) {
      if(state!=='done')throw new Error('Demo only implements the done StateDot visual');
      return h('span', {className:'demo-state-dot', 'data-mock-primitive':'StateDot', 'data-state':state, 'aria-hidden':true});
    }
    const plugin = factory(name=>{
      if(name==='react') return window.React;
      if(name==='@deepseek-ai/dsh-client-ui-primitives')return {StateDot};
      throw new Error('Isolated demo denies module: '+name);
    });
    plugin.apply({
      effect(fn) {const cleanup=fn(); if(cleanup) cleanups.push(cleanup);},
      contextMenus:{register(definition){menus.push(definition);return ()=>menus.splice(menus.indexOf(definition),1);}},
      slots:{
        inject(name,fn) {if(name==='shell.overlay'||name==='sidebar.session.row.leading')return fn();},
        register(slot,Component) {
          if(slot.name==='shell.overlay')root.render(h(Component));
          if(slot.name==='sidebar.session.row.leading')leading.push({slot,Component});
          return ()=>{};
        },
      },
      layout:{selectPanel(){throw new Error('Native panels unavailable in isolated demo');}},
      uiWorkspace:{openSession(){
        window.__DEEPSEARCH_DEMO__.nativeNavigationAttempted=true;
        throw new Error('原生跳转未在隔离演示中启用');
      }},
      uiSession:{adapter:{current:emptyStore}},
      sessions:{list:sessionStore},
    });
    const unreadStore = leading[0]?.slot.inject().hooks.manualUnread;
    if(!unreadStore || menus.length!==1)throw new Error('Expected plugin unread slot and menu registration');
    function Leading({sessionId}) {
      return h(window.React.Fragment,null,...leading.map(({slot,Component})=>{
        const store=slot.inject().hooks.manualUnread;
        const useManualUnread=selector=>selector(useSyncExternalStore(store.subscribe,store.getSnapshot));
        return h(Component,{key:slot.id,sessionId,useManualUnread});
      }));
    }
    function Sidebar() {
      useSyncExternalStore(unreadStore.subscribe,unreadStore.getSnapshot);
      const [menuSession,setMenuSession]=window.React.useState(null);
      refreshSidebar=()=>setMenuSession(null);
      const items=menuSession?menus.flatMap(menu=>menu.resolve({sessionId:menuSession})):[];
      return h('section',{className:'demo-sidebar-card','aria-label':'虚构会话列表'},
        h('header',null,h('strong',null,'最近对话'),h('span',null,'模拟宿主 / 虚构会话')),
        h('p',{className:'demo-sidebar-hint'},'会话列表 · 右键菜单由真实插件注册'),
        ...sessions.map((row,index)=>h('div',{className:'demo-session-row','data-session-id':row.id,key:row.id,onContextMenu:event=>{event.preventDefault();setMenuSession(row.id);}},
          h('span',{className:'demo-leading-slot'},h(Leading,{sessionId:row.id})),
          h('button',{onClick:()=>{mockOpen(row.id);setMenuSession(null);}},row.title),
          h('span',{className:'demo-row-time'},['今天','昨天','周一','周日'][index]))),
        items.length>0&&h('div',{role:'menu',className:'demo-context-menu'},...items.map(item=>h('button',{role:'menuitem',key:item.id,onClick:()=>{item.run();setMenuSession(null);}},item.label))),
        h('div',{className:'demo-sidebar-legend'},h('span',{className:'demo-state-dot','aria-hidden':true}),h('span',null,'左侧未读点 · 插件使用 StateDot(state="done")；此舞台原语为样式模拟')),
        h('div',{className:'demo-sidebar-details'},h('strong',null,'留个提醒，稍后再读'),h('p',null,'右键标记未读 → 左侧状态位显示提醒；再次打开会话时自动清除。'),h('p',null,'插件菜单、未读数据与 leading slot 组件为真实实现；列表布局与 StateDot 视觉由隔离宿主模拟，非 DSH 宿主截图。')));
    }
    sidebarRoot.render(h(Sidebar));
    Object.assign(window.__DEEPSEARCH_DEMO__,{loaded:true,unreadStore,openMockSession:mockOpen,closeMenu:()=>refreshSidebar(),registeredSlots:leading.map(({slot})=>slot.name),registeredMenus:menus.map(menu=>menu.id)});
  },
};
window.addEventListener('pagehide',()=>{for(const cleanup of cleanups)cleanup();root.unmount();sidebarRoot.unmount();});
