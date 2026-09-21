import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual built form scripts, with outbound requests replaced by fixtures.
const scriptFor = (path, marker) => {
  const html = readFileSync(`dist/${path}/index.html`, 'utf8');
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes(marker));
};
const node = () => ({value:'', hidden:true, disabled:false, dataset:{}, firstChild:{textContent:'送信する'}, scrollIntoView(){}, setAttribute(){}});
function formHarness(kind, {source='media/interview-followup', service='ltori', response={success:true}, status=200, analytics='callback', fetcher, docId='ltori-service'}={}) {
  const prefix = kind === 'contact' ? 'ct' : 'dd';
  const nodes = new Map(['Form','Submit','Ok','Fb','Fallback','Mailto'].map(s => [prefix+s,node()]));
  const fields = new Map(['_honey','_subject','ご相談内容','お名前','会社名','メールアドレス','電話番号','お問い合わせ内容'].map(name => [name,{...node(),name,value:name.startsWith('_')?'':`private-${name}`} ]));
  const form = nodes.get(prefix+'Form');
  const events = [], requests = [], timers = new Map(); let timerId=0;
  const location = {search:`?${new URLSearchParams({service,source})}`,href:'unchanged'};
  Object.assign(form, {
    action:'https://formsubmit.co/info@layr.co.jp',
    querySelector(selector){return selector === 'textarea' ? fields.get('お問い合わせ内容') : fields.get(selector.match(/name="([^"]+)"/)[1]);},
    querySelectorAll(){return [...fields.values()].filter(f=>f.type!=='hidden');},
    append(input){fields.set(input.name,input);},
    addEventListener(_,fn){this.submit=fn;},
  });
  nodes.get(prefix+'Mailto').href='mailto:info@layr.co.jp';
  const context = {
    document:{getElementById:id=>nodes.get(id),createElement:node},location,window:{location},URLSearchParams,AbortController,
    FormData:class {constructor(){this.values=new Map([...fields].map(([k,v])=>[k,v.value]));}get(k){return this.values.get(k);}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    fetch:async(url,options)=>{requests.push({url,body:options.body});return fetcher ? fetcher(options) : {ok:status===200,status,json:async()=>{if(response==='invalid-json')throw new Error('Invalid JSON');return response;}};},
  };
  if(analytics!=='absent')context.gtag=(...args)=>{if(analytics==='throw')throw new Error('Tag blocked');events.push(args);if(analytics==='callback')args[2]?.event_callback?.();};
  const path = kind === 'contact' ? 'contact' : `document/${docId}`;
  const script=scriptFor(path,`getElementById('${prefix}Form')`);
  assert.ok(script, 'Built form script must exist');
  vm.runInNewContext(script, context);
  return {nodes,fields,events,requests,location,timers,submit:()=>form.submit({preventDefault(){}}),flushTimers:()=>{for(const {fn} of [...timers.values()])fn();timers.clear();}};
}

test('contact preserves article attribution in email and accepted-lead events without personal data',async()=>{
  const h=formHarness('contact');
  await h.submit();
  assert.match(h.requests[0].body.get('ご覧になったページ'),/面接/);
  assert.equal(h.events.filter(e=>e[1]==='generate_lead').length,1);
  assert.equal(h.events.find(e=>e[1]==='ltori_media_inquiry_complete')[2].page_source,'media/interview-followup');
  assert.ok(!JSON.stringify(h.events).includes('private-'));
  assert.equal(h.nodes.get('ctOk').hidden,false);
  await h.submit();assert.equal(h.requests.length,1);
});
test('area attribution remains separate; unknown and other-service sources are ignored',async()=>{
  const area=formHarness('contact',{source:'area/mie/nabari'});await area.submit();
  assert.ok(area.events.some(e=>e[1]==='ltori_inquiry_complete'));
  assert.ok(!area.events.some(e=>e[1]==='ltori_media_inquiry_complete'));
  for(const options of [{source:'media/not-published'},{source:'__proto__'},{source:'constructor'},{service:'general'}]){
    const h=formHarness('contact',options);await h.submit();
    assert.equal(h.fields.has('ご覧になったページ'),false);
    assert.equal(h.events[0][2].page_source,undefined);
  }
});
test('successful document submission records one lead; callback redirects to the correct download',async()=>{
  const h=formHarness('document',{response:{success:'true'}});await h.submit();
  assert.equal(h.location.href,'/document/thanks/?d=ltori-service');
  assert.equal(h.events.filter(e=>e[1]==='generate_lead').length,1);
  assert.equal(h.events.find(e=>e[1]==='generate_lead')[2].method,'document_download');
  assert.equal(h.events.find(e=>e[1]==='ltori_media_document_complete')[2].page_source,'media/interview-followup');
  assert.ok(h.requests[0].body.get('ご覧になったページ'));
  assert.ok(!JSON.stringify(h.events).includes('private-'));
  await h.submit();assert.equal(h.requests.length,1);
});
test('rejected/invalid/network form responses preserve inputs and offer mail fallback without leads',async()=>{
  for(const kind of ['contact','document'])for(const options of [{response:{success:false}},{response:{success:'false'}},{response:{}},{response:'invalid-json'},{status:500},{fetcher:async()=>{throw new Error('network');}}]){
    const h=formHarness(kind,options);await h.submit();
    assert.equal(h.events.length,0);assert.equal(h.location.href,'unchanged');
    assert.equal(h.fields.get('お名前').value,'private-お名前');
    const prefix=kind==='contact'?'ct':'dd';
    assert.equal(h.nodes.get(prefix+'Submit').disabled,false);
    assert.equal(h.nodes.get(prefix+(kind==='contact'?'Fb':'Fallback')).hidden,false);
    assert.match(decodeURIComponent(h.nodes.get(prefix+'Mailto').href),/ご覧になったページ/);
    await h.submit();assert.equal(h.requests.length,2,'failure allows retry');
  }
});
test('double submits during requests are ignored by both forms',async()=>{
  for(const kind of ['contact','document']){
    let finish;
    const h=formHarness(kind,{fetcher:()=>new Promise(resolve=>{finish=resolve;})});
    const pending=h.submit();await h.submit();assert.equal(h.requests.length,1);
    finish({ok:true,json:async()=>({success:true})});await pending;
    assert.equal(h.events.filter(e=>e[1]==='generate_lead').length,1);
  }
});
test('timeout covers a stalled response body as well as the initial request',async()=>{
  for(const kind of ['contact','document']){
    let readingBody;
    const bodyStarted=new Promise(resolve=>{readingBody=resolve;});
    const h=formHarness(kind,{fetcher:async({signal})=>({ok:true,json:()=>new Promise((_,reject)=>{
      const abort=()=>reject(new Error('body aborted'));
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
      readingBody();
    })})});
    const pending=h.submit();await bodyStarted;
    assert.ok([...h.timers.values()].some(t=>t.ms===8000),'body must retain the timeout');
    h.flushTimers();await pending;
    const prefix=kind==='contact'?'ct':'dd';
    assert.equal(h.events.length,0);assert.equal(h.location.href,'unchanged');
    assert.equal(h.nodes.get(prefix+'Submit').disabled,false);
    assert.equal(h.nodes.get(prefix+(kind==='contact'?'Fb':'Fallback')).hidden,false);
  }
});
test('blocked, absent, or queued analytics never prevent a successful document download',async()=>{
  for(const analytics of ['absent','throw','queued']){
    const h=formHarness('document',{analytics});await h.submit();h.flushTimers();
    assert.equal(h.location.href,'/document/thanks/?d=ltori-service');
    assert.equal(h.nodes.get('ddFallback').hidden,true);
  }
  const contact=formHarness('contact',{analytics:'throw'});await contact.submit();
  assert.equal(contact.nodes.get('ctOk').hidden,false);assert.equal(contact.nodes.get('ctFb').hidden,true);
});
test('other materials still record downloads but cannot adopt recruitment attribution',async()=>{
  const h=formHarness('document',{docId:'line-service'});await h.submit();
  assert.equal(h.location.href,'/document/thanks/?d=line-service');
  assert.equal(h.fields.has('ご覧になったページ'),false);
  assert.equal(h.events.length,1);assert.equal(h.events[0][2].service,'general');
});
test('thank-you page direct visits and reloads never create leads',()=>{
  for(const search of ['','?d=ltori-service','?d=unknown']){
    const events=[];
    const context={location:{search},URLSearchParams,gtag:(...args)=>events.push(args),document:{getElementById:node,querySelector:node}};
    const script=scriptFor('document/thanks',"getElementById('mailBlock')");
    vm.runInNewContext(script,context);vm.runInNewContext(script,context);
    assert.equal(events.length,0);
  }
});
