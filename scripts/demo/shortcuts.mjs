// In-memory public-shortcuts contract for documentation only; never writes host files.
export function createMockShortcuts() {
  const clone = value => JSON.parse(JSON.stringify(value));
  const observable = initial => {
    let value = initial; const listeners = new Set();
    return {getSnapshot:()=>value, subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
      set(next){value=next;for(const fn of [...listeners])fn();}};
  };
  const profile='desktop:macos', nativeId='session.search', ownId='deepsearch.toggle';
  const cmdK={code:'KeyK',modifiers:['meta']};
  let values={}, revision=1, command=null;
  const edits=[], dispatches=[], config=observable(null), catalog=observable([]);
  const effective=id=>Object.hasOwn(values,id)?values[id]:id===nativeId?cmdK:null;
  function publish(){
    config.set({status:'ready',revision,document:{profiles:{[profile]:clone(values)}}});
    catalog.set([{id:nativeId,binding:clone(effective(nativeId)),conflicts:[]},
      ...(command?[{id:ownId,binding:clone(effective(ownId)),conflicts:[]}]:[])]);
  }
  const service={runtime:'desktop',platform:'macos',config,catalog,
    register(value){command=value;publish();return ()=>{command=null;publish();};},
    describeBinding(binding){
      if(!/^Key[A-Z]$/.test(binding.code))throw new Error('Unsupported demo key');
      return {issue:null,conflicts:catalog.getSnapshot().filter(row=>JSON.stringify(row.binding)===JSON.stringify(binding)).map(row=>row.id)};
    },
    async edit(edit,expectedRevision){
      if(expectedRevision!==revision)return {status:'stale',snapshot:config.getSnapshot()};
      edits.push(clone(edit));
      if(edit.type==='reset')delete values[edit.id];else values[edit.id]=clone(edit.binding);
      revision++;publish();return {status:'saved',snapshot:config.getSnapshot()};
    },
    dispatch(event){
      if(event.code!=='KeyK'||!event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return false;
      if(!command||JSON.stringify(effective(ownId))!==JSON.stringify(cmdK)||effective(nativeId)!==null)return false;
      event.preventDefault();dispatches.push(ownId);command.resolve().run();return true;
    },
  };
  publish();return {service,edits,dispatches};
}
