import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,parseFragment} from 'parse5';
import {mountKijiWorkbench} from '../src/lib/seo-manager/kiji-app.mjs';

// A small event/DOM adapter exercises the real controller against the built form IDs.
// Native dialog focus, layout and keyboard navigation are separately checked in the browser.
class Element {
  constructor(tag = '#text',attributes = {},text = '') { this.tagName=tag;this.attrs={...attributes};this.children=[];this.parentNode=null;this.listeners={};this._text=text;this.nodeType=tag==='#text'?3:1;this._value=attributes.value;this.disabled='disabled' in attributes;this.checked='checked' in attributes;this.required='required' in attributes;this.files=[];this.dataset=new Proxy({}, {get:(_,key)=>this.attrs['data-'+String(key).replace(/[A-Z]/g,char=>'-'+char.toLowerCase())],set:(_,key,value)=>{this.attrs['data-'+String(key).replace(/[A-Z]/g,char=>'-'+char.toLowerCase())]=String(value);return true;}});this.classList={add:value=>{this.className=[this.className,value].filter(Boolean).join(' ');}}; }
  get id(){return this.attrs.id||'';} set id(value){this.attrs.id=value;}
  get className(){return this.attrs.class||'';} set className(value){this.attrs.class=value;}
  get hidden(){return 'hidden' in this.attrs;} set hidden(value){if(value)this.attrs.hidden='';else delete this.attrs.hidden;}
  get open(){return 'open' in this.attrs;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');} set textContent(value){this._text=String(value);this.children=[];}
  get value(){if(this._value!==undefined)return this._value;if(this.tagName==='textarea')return this.textContent;if(this.tagName==='select'){const first=this.children.find(child=>child.tagName==='option');return first?.attrs.value??first?.textContent??'';}return '';}
  set value(value){this._value=String(value);}
  get innerHTML(){return this.textContent;} set innerHTML(value){this.replaceChildren(...parseFragment(value).childNodes.map(convert));}
  append(...nodes){for(let child of nodes){if(typeof child==='string')child=new Element('#text',{},child);child.parentNode=this;this.children.push(child);}}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attrs[key]=String(value);} getAttribute(key){return this.attrs[key]??null;} hasAttribute(key){return key in this.attrs;}
  addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);}
  async fire(type,details={}){const event={target:this,key:'',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...details};for(let current=this;current;current=current.parentNode){for(const handler of current.listeners[type]||[])await handler(event);}return event;}
  matches(selector){const parts=selector.trim().split(/\s+/),last=parts.pop(),match=last.match(/^([a-z]+)?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i);if(!match)return false;if(match[1]&&this.tagName!==match[1])return false;if(match[2]&&(!this.hasAttribute(match[2])||(match[3]!==undefined&&this.getAttribute(match[2])!==match[3])))return false;if(!parts.length)return true;let parent=this.parentNode;while(parent){if(parent.matches(parts.join(' ')))return true;parent=parent.parentNode;}return false;}
  querySelectorAll(selector){const matches=[];const alternatives=selector.split(',');const visit=parent=>{for(const child of parent.children){if(alternatives.some(item=>child.matches(item)))matches.push(child);visit(child);}};visit(this);return matches;}
  showModal(){this.attrs.open='';} close(){delete this.attrs.open;} focus(){globalThis.document.activeElement=this;} reportValidity(){return true;}
  reset(){this.querySelectorAll('input,textarea,select').forEach(element=>{element.value=element.attrs.value||'';});}
}
function convert(source){const element=new Element(source.tagName||source.nodeName,Object.fromEntries((source.attrs||[]).map(attr=>[attr.name,attr.value])),source.value||'');element.append(...(source.childNodes||[]).map(convert));return element;}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const draft={id:7,title:'採用LINEの費用',description:'元の説明',slug:'line-price',category:'採用',body_md:'## 元の本文\n本文',status:'pending_approval',keyword:'採用LINE 費用',gate_score:7,gate_json:'[]',svg_json:'[]'};
function fixture(){const root=convert(parse(readFileSync(new URL('../dist/tools/ltori-seo/articles/index.html',import.meta.url),'utf8')));const doc={getElementById:id=>{let found;const visit=node=>{if(node.id===id)found=node;for(const child of node.children)visit(child);};visit(root);return found;},querySelectorAll:selector=>root.querySelectorAll(selector),createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',{},text),activeElement:null};return doc;}
async function harness(overrides={},options={}){
  const original=Object.fromEntries(['document','window','location','history','confirm'].map(key=>[key,globalThis[key]]));const document=fixture();const mediaListeners=[];const media={matches:options.compact??false,addEventListener(type,handler){if(type==='change')mediaListeners.push(handler);}};const history=[];globalThis.document=document;globalThis.window=Object.assign(new EventTarget(),{matchMedia:()=>media});globalThis.location={pathname:'/articles/',search:'',hash:options.hash??''};globalThis.history={replaceState(_state,_title,url){history.push(url);}};globalThis.confirm=()=>true;
  const calls=[];const api=async(path,options={})=>{calls.push({path,...options});if(overrides[path])return overrides[path](options);if(path==='/settings')return {ok:true,settings:{automation_paused:'0',autopilot:'approval',daily_cap:'1',weekly_target:'3',article_min_chars:'2000',article_max_chars:'6000'}};if(path==='/evidence')return {ok:true,items:[]};if(path==='/overview')return {automationPaused:false,articles:{byStatus:[{status:'pending_approval',n:1}],publishedThisWeek:0,weeklyTarget:3},keywords:{byLayer:[],total:10,consumed:0},apiKeys:{anthropic:true,github:true},autopilot:'approval',recentLog:[]};if(path.startsWith('/articles?status=pending_approval'))return {items:[{...draft}]};if(path.startsWith('/articles?'))return {items:[]};if(path==='/articles/7')return {article:{...draft},keyword:{keyword:draft.keyword}};if(path.startsWith('/keywords?'))return {items:[{id:5,keyword:'採用LINE',layer:'収益',experience_fit:1,intent_explicit:'費用',intent_latent:'工数削減',status:'new'}]};throw new Error('unexpected '+path);};
  let improvementsMounted=0;const app=await mountKijiWorkbench({api,mountImprovement:async()=>{improvementsMounted++;}});const $=id=>document.getElementById('kiji-'+id);return {app,$,calls,api,document,history,get improvementsMounted(){return improvementsMounted;},setCompact(value){media.matches=value;mediaListeners.forEach(handler=>handler());},cleanup:()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

function assertSelection(h,key){const tabs=h.$('navigation').querySelectorAll('[data-kiji-tab]');assert.equal(tabs.filter(tab=>tab.getAttribute('aria-selected')==='true').length,1);assert.equal(tabs.filter(tab=>tab.tabIndex===0).length,1);for(const tab of tabs){const selected=tab.dataset.kijiTab===key;assert.equal(tab.getAttribute('aria-selected'),String(selected));const panel=h.document.getElementById(tab.getAttribute('aria-controls'));assert.equal(panel.hidden,!selected);assert.equal(panel.getAttribute('aria-labelledby'),tab.id);}assert.equal(h.history.at(-1),`/articles/#${key}`);}

test('sidebar navigation controls all seven panels outside the workbench and keeps the queue badge and lazy improvement panel',async()=>{
  const h=await harness();try{
    assert.equal(h.document.querySelectorAll('main').length,1);assert.equal(h.$('workbench').querySelectorAll('[data-kiji-tab]').length,0);assert.equal(h.$('navigation').querySelectorAll('[data-kiji-tab]').length,7);assert.equal(h.$('queue-count').textContent,'1');assert.equal(h.$('queue-count').hidden,false);assertSelection(h,'dash');
    await h.$('tab-keywords').fire('click');assertSelection(h,'keywords');const keywordReads=h.calls.filter(call=>call.path.startsWith('/keywords?')).length;
    await h.$('tab-improve').fire('click');assertSelection(h,'improve');assert.equal(h.improvementsMounted,1);
    await h.$('tab-keywords').fire('click');await h.$('tab-improve').fire('click');assert.equal(h.improvementsMounted,1);assert.equal(h.calls.filter(call=>call.path.startsWith('/keywords?')).length,keywordReads);assert.ok(h.calls.every(call=>!call.method));
  }finally{h.cleanup();}
});

test('sidebar follows vertical or horizontal keyboard orientation, wraps, and preserves focus through resize',async()=>{
  const h=await harness();try{
    assert.equal(h.$('navigation').getAttribute('aria-orientation'),'vertical');
    let event=await h.$('tab-dash').fire('keydown',{key:'ArrowDown'});await flush();assert.equal(event.defaultPrevented,true);assertSelection(h,'keywords');assert.equal(h.document.activeElement,h.$('tab-keywords'));
    event=await h.$('tab-keywords').fire('keydown',{key:'ArrowRight'});assert.equal(event.defaultPrevented,false);assertSelection(h,'keywords');
    await h.$('tab-keywords').fire('keydown',{key:'Home'});await flush();assertSelection(h,'dash');await h.$('tab-dash').fire('keydown',{key:'ArrowUp'});await flush();assertSelection(h,'improve');assert.equal(h.document.activeElement,h.$('tab-improve'));
    h.setCompact(true);assert.equal(h.$('navigation').getAttribute('aria-orientation'),'horizontal');assert.equal(h.document.activeElement,h.$('tab-improve'));
    await h.$('tab-improve').fire('keydown',{key:'ArrowRight'});await flush();assertSelection(h,'dash');assert.equal(h.document.activeElement,h.$('tab-dash'));
    await h.$('tab-dash').fire('keydown',{key:'ArrowLeft'});await flush();assertSelection(h,'improve');
    event=await h.$('tab-improve').fire('keydown',{key:'ArrowDown'});assert.equal(event.defaultPrevented,false);assertSelection(h,'improve');
    await h.$('tab-improve').fire('keydown',{key:'Home'});await flush();assertSelection(h,'dash');await h.$('tab-dash').fire('keydown',{key:'End'});await flush();assertSelection(h,'improve');assert.ok(h.calls.every(call=>!call.method));
  }finally{h.cleanup();}
});

test('initial deep links select the requested sidebar panel without loading unrelated data',async()=>{
  for(const key of ['keywords','improve']){const h=await harness({},{hash:`#${key}`,compact:true});try{assertSelection(h,key);assert.equal(h.calls.some(call=>call.path==='/overview'),false);assert.equal(h.$('navigation').getAttribute('aria-orientation'),'horizontal');if(key==='improve'){assert.equal(h.improvementsMounted,1);assert.deepEqual(h.calls.map(call=>call.path),['/settings']);}}finally{h.cleanup();}}
});

test('hash changes select known tabs without intercepting skip links or inherited object keys',async()=>{
  const h=await harness();try{
    globalThis.location.hash='#keywords';globalThis.window.dispatchEvent(new Event('hashchange'));await flush();assertSelection(h,'keywords');const keywordReads=h.calls.filter(call=>call.path.startsWith('/keywords?')).length;
    const historyCount=h.history.length;for(const hash of ['#workspace-main','#unknown','#constructor','#__proto__']){globalThis.location.hash=hash;globalThis.window.dispatchEvent(new Event('hashchange'));await flush();assertSelection(h,'keywords');assert.equal(h.history.length,historyCount);assert.equal(globalThis.location.hash,hash);}
    globalThis.location.hash='#improve';globalThis.window.dispatchEvent(new Event('hashchange'));await flush();assertSelection(h,'improve');assert.equal(h.improvementsMounted,1);
    globalThis.location.hash='#keywords';globalThis.window.dispatchEvent(new Event('hashchange'));await flush();assertSelection(h,'keywords');assert.equal(h.calls.filter(call=>call.path.startsWith('/keywords?')).length,keywordReads);assert.ok(h.calls.every(call=>!call.method));
  }finally{h.cleanup();}
  for(const hash of ['#unknown','#constructor','#__proto__']){const invalid=await harness({},{hash});try{assertSelection(invalid,'dash');assert.equal(invalid.calls.filter(call=>call.path==='/overview').length,1);}finally{invalid.cleanup();}}
});

test('opening the workbench and visiting production tabs never starts generation or publication',async()=>{const h=await harness();try{await h.app.selectTab('queue');await h.app.selectTab('keywords');await h.app.selectTab('drafts');assert.ok(h.calls.every(call=>!call.method));assert.equal(h.$('tick').disabled,false);assert.match(h.$('generation-status').textContent,/設定あり.*未確認/);}finally{h.cleanup();}});

test('editing an article retains unsaved values across preview and failed save, and asks before closing',async()=>{const h=await harness({'/articles/7':async options=>{if(options.method==='PATCH')throw new Error('保存失敗');return {article:{...draft},keyword:{keyword:draft.keyword}};}});try{await h.app.selectTab('queue');await h.$('queue-list').querySelectorAll('button')[0].fire('click');await flush();await h.$('article-toggle').fire('click');h.$('article-edit-title').value='編集中のタイトル';h.$('article-edit-body').value='## 編集本文\n変更中';await h.$('article-edit-title').fire('input');await h.$('article-toggle').fire('click');assert.match(h.$('article-preview').textContent,/編集本文/);await h.$('article-toggle').fire('click');assert.equal(h.$('article-edit-title').value,'編集中のタイトル');await h.$('article-form').fire('submit');await flush();assert.match(h.$('article-error').textContent,/保存失敗/);assert.equal(h.$('article-edit-body').value,'## 編集本文\n変更中');assert.equal(h.$('article-dialog').open,true);globalThis.confirm=()=>false;await h.$('article-dialog').querySelectorAll('[data-kiji-close]')[0].fire('click');assert.equal(h.$('article-dialog').open,true);}finally{h.cleanup();}});

test('publication creates only the confirmed PR action and suppresses double submit',async()=>{const pending=deferred();const h=await harness({'/articles/7/approve':()=>pending.promise});try{await h.app.selectTab('queue');await h.$('queue-list').querySelectorAll('button')[1].fire('click');assert.match(h.$('action-description').textContent,/まだ公開されません/);assert.equal(h.calls.filter(call=>call.method==='POST').length,0);await h.$('action-form').fire('submit');await h.$('action-form').fire('submit');await flush();assert.equal(h.calls.filter(call=>call.path==='/articles/7/approve').length,1);assert.equal(h.$('action-submit').disabled,true);pending.resolve({ok:true,publicationState:'pending_review'});await flush();assert.match(h.$('message').textContent,/公開用の変更を作成/);assert.equal(h.$('action-dialog').open,false);}finally{h.cleanup();}});

test('keyword input survives a failed mutation and controls unlock for a retry',async()=>{const h=await harness({'/keywords/5':async()=>{throw new Error('競合');}});try{await h.app.selectTab('keywords');await h.$('kw-rows').querySelectorAll('button')[0].fire('click');h.$('edit-explicit').value='保持する入力';await h.$('edit-explicit').fire('input');await h.$('keyword-form').fire('submit');await flush();assert.equal(h.$('edit-explicit').value,'保持する入力');assert.equal(h.$('keyword-dialog').open,true);assert.equal(h.$('edit-explicit').disabled,false);assert.match(h.$('keyword-error').textContent,/競合/);}finally{h.cleanup();}});

test('a late CSV file read cannot overwrite pasted content or make the old file actionable',async()=>{const pending=deferred();const h=await harness();try{await h.$('csv-open').fire('click');h.$('csv-file').files=[{name:'old.csv',size:10,arrayBuffer:()=>pending.promise}];const reading=h.$('csv-file').fire('change');assert.equal(h.$('csv-run').disabled,true);h.$('csv-text').value='キーワード,検索数\n新しい内容,10';await h.$('csv-text').fire('input');pending.resolve(new TextEncoder().encode('old,0'));await reading;assert.match(h.$('csv-text').value,/新しい内容/);assert.equal(h.$('csv-run').disabled,false);assert.ok(h.calls.every(call=>!call.method));}finally{h.cleanup();}});

test('uncertain publication exposes reconciliation while blocking edits and another approval',async()=>{
  const article={...draft,status:'needs_human',publication:{status:'unconfirmed',pullRequestUrl:'https://github.com/layrinc/layr-hp/pull/123'}};
  const h=await harness({'/articles?status=pending_approval':async()=>({items:[]}),'/articles?status=needs_human':async()=>({items:[article]}),'/articles/7':async()=>({article}),'/articles/7/check-deploy':async()=>({ok:true,live:false,message:'公開用の変更を確認してください'})});
  try{
    await h.app.selectTab('queue');const buttons=h.$('queue-list').querySelectorAll('button');assert.deepEqual(buttons.map(button=>button.textContent),['原稿を確認','公開状態を照合']);
    await buttons[0].fire('click');await flush();assert.equal(h.$('article-toggle').hidden,true);assert.equal(h.$('article-regate').hidden,true);
    const links=h.$('article-publication').querySelectorAll('a');assert.ok(links.some(link=>link.href==='https://github.com/layrinc/layr-hp/pull/123'));
    await h.$('article-publication').querySelectorAll('button')[0].fire('click');await flush();assert.equal(h.calls.filter(call=>call.path==='/articles/7/check-deploy').length,1);assert.equal(h.calls.filter(call=>call.path.endsWith('/approve')).length,0);
  }finally{h.cleanup();}
});

test('linked, writing and published keywords keep metadata editing but cannot be queued again',async()=>{
  for(const state of [{article_id:7,status:'ready'},{status:'writing'},{status:'published'}]){
    const row={id:5,keyword:'採用LINE',layer:'収益',experience_fit:1,...state};
    const h=await harness({'/keywords?':async()=>({items:[row]}),'/keywords/5':async()=>({ok:true})});
    try{
      await h.app.selectTab('keywords');await h.$('kw-rows').querySelectorAll('button')[0].fire('click');
      assert.equal(h.$('keyword-ready').disabled,true);assert.equal(h.$('keyword-queue').disabled,true);assert.match(h.$('keyword-reason').textContent,/メモは保存できます/);
      await h.$('keyword-queue').fire('click');await flush();assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
      h.$('edit-explicit').value='確認済みのニーズ';await h.$('edit-explicit').fire('input');await h.$('keyword-form').fire('submit');await flush();
      const saved=h.calls.find(call=>call.method==='PATCH');assert.equal(saved.body.intent_explicit,'確認済みのニーズ');assert.equal(Object.hasOwn(saved.body,'status'),false);
    }finally{h.cleanup();}
  }
});


test('hold is visible on deep links, blocks production controls, and normal settings save never clears it',async()=>{
  const h=await harness({'/settings':async options=>options.method?{ok:true}:{ok:true,settings:{automation_paused:'1',autopilot:'approval',daily_cap:'1',weekly_target:'3',article_min_chars:'2000',article_max_chars:'6000'}}},{hash:'#settings'});try{
    assert.match(h.$('automation-state').textContent,/保留中/);assert.equal(h.$('tick').disabled,true);assert.equal(h.$('classify').disabled,true);assert.equal(h.$('expand').disabled,true);assert.match(h.$('automation-toggle').textContent,/再開/);
    await h.$('settings-form').fire('submit');await flush();const save=h.calls.find(call=>call.path==='/settings'&&call.method==='PUT');assert.ok(save);assert.equal(Object.hasOwn(save.body,'automation_paused'),false);
  }finally{h.cleanup();}
});
test('pause toggle sends only the dedicated state, and unknown state prevents production actions',async()=>{
  let paused='1';const h=await harness({'/settings':async options=>{if(options.method){paused=options.body.automation_paused;return {ok:true};}return {ok:true,settings:{automation_paused:paused}};}},{hash:'#settings'});try{
    await h.$('automation-toggle').fire('click');await flush();const writes=h.calls.filter(call=>call.method);assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{automation_paused:'0'});
  }finally{h.cleanup();}
  const unknown=await harness({'/settings':async()=>{throw new Error('offline');}},{hash:'#queue'});try{assert.match(unknown.$('automation-state').textContent,/取得できません/);assert.equal(unknown.$('tick').disabled,true);assert.equal(unknown.$('automation-toggle').disabled,true);const approve=unknown.$('queue-list').querySelectorAll('button').find(el=>el.textContent==='公開用の変更を作成');assert.equal(approve.disabled,true);assert.ok(unknown.calls.every(call=>!call.method));}finally{unknown.cleanup();}
});
