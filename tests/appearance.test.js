import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../client.js',import.meta.url),'utf8');
const pure=source.slice(source.indexOf('    const APPEARANCE_KEY'),source.indexOf('    function Icon'));
const f=vm.runInNewContext('(function(){'+pure+';return {formatMessageTime,appearancePrefs,readAppearance,saveAppearance,appearanceStyle};})()');
test('message time preserves actual local date and 24-hour minute, including epoch zero',()=>{
  for(const value of [0,Date.parse('2026-11-14T22:03:00+08:00'),'2026-11-14T00:01:02Z']){
    const d=new Date(value),p=n=>String(n).padStart(2,'0');
    assert.equal(f.formatMessageTime(value),d.getFullYear()+'/'+p(d.getMonth()+1)+'/'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()));
  }
  for(const value of [undefined,null,false,{},'', '  ', '2026-11-14','2026-02-30T01:01:01Z','2026-01-01T24:00:00Z','invalid',NaN,Infinity,9e20]) assert.equal(f.formatMessageTime(value),null);
});
test('appearance preferences allow only safe modes, hex color and finite bounded numbers',()=>{
  const defaults=f.appearancePrefs(null);
  for(const value of [null,[],{},'glass',42]) assert.equal(JSON.stringify(f.appearancePrefs(value)),JSON.stringify(defaults));
  const p=f.appearancePrefs({mode:'custom',color:'#123AbC',opacity:2,blur:100,unknown:'ignored'});
  assert.equal(p.mode,'custom');assert.equal(p.color,'#123AbC');assert.equal(p.opacity,55);assert.equal(p.blur,32);assert.equal(p.unknown,undefined);
  assert.equal(JSON.stringify(f.appearancePrefs(p)),JSON.stringify(p));
  for(const value of [null,'0',NaN,Infinity,false]){const p=f.appearancePrefs({color:'red;display:none',mode:'other',opacity:value,blur:value});assert.equal(JSON.stringify(p),JSON.stringify(defaults));}
  assert.equal(f.appearancePrefs({blur:0,opacity:100}).blur,0);
});
test('storage corruption and blocked access cannot prevent panel opening',()=>{
  const defaults=JSON.stringify(f.appearancePrefs(null));
  for(const raw of [null,'{','null','[]','"bad"','x'.repeat(3000)]) assert.equal(JSON.stringify(f.readAppearance({getItem:()=>raw})),defaults);
  assert.equal(JSON.stringify(f.readAppearance({getItem(){throw Error('blocked')}})),defaults);
  assert.equal(f.saveAppearance({setItem(){throw Error('quota')}},{}),false);
  let stored; assert.equal(f.saveAppearance({setItem:(key,value)=>stored=value},{mode:'custom',color:'#102030',opacity:72,blur:8,evil:'x'}),true);
  const value=f.readAppearance({getItem:()=>stored}); assert.equal(value.opacity,72);assert.equal(value.evil,undefined);
});
test('surface alpha and blur stay panel-local and theme mode is opaque',()=>{
  const theme=f.appearanceStyle({mode:'theme'});assert.equal(theme['--ds-blur'],'0px');assert.equal(theme['--ds-surface'],'var(--ds-bg)');
  const glass=f.appearanceStyle({mode:'glass',blur:5});
  assert.match(glass['--ds-surface'],/--dsw-specific-input-major/);assert.match(glass['--ds-filter'],/blur\(var\(--ds-blur\)\).*saturate/);assert.equal(glass['--ds-blur'],'5px');
  const custom=f.appearanceStyle({mode:'custom',color:'#102030',opacity:72,blur:8});assert.equal(custom['--ds-surface'],'rgba(16,32,48,0.72)');assert.equal(custom['--ds-text'],'#f4f7fc');
  assert.equal(custom.opacity,undefined);assert.equal(custom.filter,undefined);
  assert.match(source,/prefers-reduced-transparency:reduce/);assert.doesNotMatch(source,/document\.documentElement\.style/);
  assert.ok(source.includes('body[data-we-glass-page][data-we-floater-solid] .deepsearch-panel[role=dialog][data-appearance]'));
  assert.ok(source.includes('--ds-effective-filter:none'));
  assert.doesNotMatch(source,/setAttribute\(["']data-we-(?:surface-runtime|host-dialog)/);
});
