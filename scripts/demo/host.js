/* Only the host context is mocked. Overlay, Mark, CSS, hooks, keyboard controls,
   search requests, tabs, filters and appearance controls come from /client.js. */
const {createElement:h} = window.React;
const root = window.ReactDOM.createRoot(document.getElementById('plugin-root'));
const cleanups = [];
const emptyStore = {getSnapshot:()=>null, subscribe:()=>()=>{}};
window.__DEEPSEARCH_DEMO__ = {nativeNavigationAttempted:false};
window.__ModuleLoader__ = {
  load({factory}) {
    const plugin = factory(name=>{
      if(name==='react') return window.React;
      throw new Error('Isolated demo denies module: '+name);
    });
    plugin.apply({
      effect(fn) {const cleanup=fn(); if(cleanup) cleanups.push(cleanup);},
      slots:{
        inject(name,fn) {if(name==='shell.overlay') fn();},
        register(slot,Component) {if(slot.name==='shell.overlay') root.render(h(Component)); return ()=>{};},
      },
      layout:{selectPanel(){throw new Error('Native panels unavailable in isolated demo');}},
      uiWorkspace:{openSession(){
        window.__DEEPSEARCH_DEMO__.nativeNavigationAttempted=true;
        throw new Error('原生跳转未在隔离演示中启用');
      }},
      uiSession:{adapter:{current:emptyStore}},
      sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>{}}},
    });
    window.__DEEPSEARCH_DEMO__.loaded=true;
  },
};
window.addEventListener('pagehide',()=>{for(const cleanup of cleanups) cleanup();root.unmount();});
