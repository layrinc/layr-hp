import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLtoriContact, resolveContactSource } from '../src/lib/ltori-contact.mjs';
import { diagnosisCode } from '../src/lib/ltori-diagnosis.mjs';

const diagnostic = diagnosisCode({industry:'care',goal:'small',source:'owned',bottleneck:'schedule',line:'new'});
const node = () => ({value:'', hidden:true, disabled:false, dataset:{}, firstChild:{textContent:'送信する'},scrollIntoView(){}});
function harness({search='?service=ltori&source=diagnosis', fetcher, message=''}={}) {
  const nodes = new Map(['ctSubmit','ctOk','ctFb','ctMailto'].map(id=>[id,node()]));
  const fields = new Map(['_honey','_subject','ご相談内容','お名前','会社名','メールアドレス','お問い合わせ内容'].map(name=>[name,{...node(),name,value:name.startsWith('_')?'':`private-${name}`} ]));
  fields.get('お問い合わせ内容').value = message;
  const requests = [], events = [];
  let generated = 0;
  const form = {dataset:{}, action:'https://formsubmit.co/info@layr.co.jp',
    querySelector:selector=>selector==='textarea'?fields.get('お問い合わせ内容'):fields.get(selector.match(/name="([^"]+)"/)[1]),
    querySelectorAll:()=>[...fields.values()].filter(field=>field.type!=='hidden'),
    append:field=>fields.set(field.name,field), addEventListener(event,callback){this.submit=callback;},
  };
  bindLtoriContact(form, {email:'info@layr.co.jp',ltoriName:'エルトリ',sourceLabels:{diagnosis:'採用LINE活用診断','area/mie/nabari':'名張市の採用LINE'}}, {
    document:{createElement:node,getElementById:id=>nodes.get(id)},search,
    makeSubmissionId:()=>{generated++;return '00000000-0000-4000-8000-000000000001';},
    makeData:()=>new Map([...fields].map(([key,field])=>[key,field.value])),
    track:(...args)=>events.push(args),
    fetcher:async(url,options)=>{requests.push({url,options});return fetcher?fetcher(url,options):{ok:true,json:async()=>({success:true,leadId:'lead_12345678'})};},
  });
  return {fields,nodes,requests,events,generated:()=>generated,submit:()=>form.submit({preventDefault(){}})};
}

test('validated diagnosis prefills the consultation and goes only to the same-origin relay',async()=>{
  const h=harness({search:`?service=ltori&source=area/mie/nabari&diagnosis=${diagnostic}`});
  assert.match(h.fields.get('お問い合わせ内容').value,/介護・福祉/);
  assert.match(h.fields.get('お問い合わせ内容').value,/面接/);
  await h.submit();
  assert.equal(h.requests[0].url,'/api/ltori/contact');
  assert.equal(h.requests[0].options.body.get('_ltori_source'),'area/mie/nabari');
  assert.equal(h.requests[0].options.body.get('_ltori_diagnosis'),diagnostic);
  assert.ok(h.events.some(event=>event[1]==='ltori_diagnosis_inquiry_complete'));
  assert.ok(h.events.some(event=>event[2].lead_id==='lead_12345678'));
  assert.ok(!JSON.stringify(h.events).includes('private-'));
  await h.submit(); assert.equal(h.requests.length,1);
});

test('failed relay requests keep the retry id, offer mail fallback, and never count as accepted leads',async()=>{
  let call=0;
  const h=harness({message:'相談したいです',fetcher:async()=>({ok:true,json:async()=>({success:++call>1})})});
  await h.submit();
  assert.equal(h.nodes.get('ctFb').hidden,false);
  assert.equal(h.events.length,0);
  assert.equal(h.fields.get('お問い合わせ内容').value,'相談したいです');
  await h.submit();
  assert.equal(h.generated(),1);
  assert.equal(h.requests[0].options.body.get('_ltori_submission_id'),h.requests[1].options.body.get('_ltori_submission_id'));
  assert.equal(h.events.filter(event=>event[1]==='generate_lead').length,1);
});

test('general inquiries keep their existing external endpoint and cannot adopt diagnosis attribution',async()=>{
  const h=harness({search:`?service=general&source=diagnosis&diagnosis=${diagnostic}`});
  assert.equal(h.fields.get('お問い合わせ内容').value,'');
  await h.submit();
  assert.equal(h.requests[0].url,'https://formsubmit.co/ajax/info@layr.co.jp');
  assert.equal(h.requests[0].options.body.has('_ltori_submission_id'),false);
  assert.equal(h.events[0][2].service,'general');
  assert.equal(h.events[0][2].page_source,undefined);
});

test('runtime published sources are checked before sending and preserve the authoritative label',async()=>{
  let release;
  const sourceResponse=new Promise(resolve=>{release=resolve;});
  const h=harness({search:'?service=ltori&source=area/mie/owase',fetcher:async url=>url.startsWith('/api/ltori/source')?sourceResponse:{ok:true,json:async()=>({success:true})}});
  const sending=h.submit();
  assert.equal(h.requests.length,1,'only the source lookup is sent while validation is pending');
  release({ok:true,json:async()=>({key:'area/mie/owase',label:'尾鷲市の採用LINE',path:'/service/ltori/area/mie/owase/'})});
  await sending;
  assert.equal(h.requests[1].options.body.get('_ltori_source'),'area/mie/owase');
  assert.equal(h.requests[1].options.body.get('ご覧になったページ'),'尾鷲市の採用LINE');
});

test('unknown sources and lookup errors do not block the form or accept arbitrary labels',async()=>{
  for(const response of [{ok:false}, {ok:true,json:async()=>({key:'area/mie/owase',label:'bad',path:'https://evil.example'})}, {ok:true,json:async()=>({key:'area/mie/toba',label:'wrong key',path:'/service/ltori/area/mie/toba/'})}]) {
    const h=harness({search:'?service=ltori&source=area/mie/owase',fetcher:async url=>url.startsWith('/api/ltori/source')?response:{ok:true,json:async()=>({success:true})}});
    await h.submit();
    assert.equal(h.requests[1].options.body.get('_ltori_source'),'');
    assert.equal(h.fields.has('ご覧になったページ'),false);
    assert.equal(h.nodes.get('ctOk').hidden,false);
  }
  assert.equal(await resolveContactSource('area/mie/owase',{}, {fetcher:async()=>{throw new Error('offline');}}),null);
  assert.equal(await resolveContactSource('person@example.com',{}, {fetcher:async()=>{throw new Error('must not call');}}),null);
});

test('untrusted diagnosis codes are ignored and a visitors existing message is never overwritten',()=>{
  const invalid=harness({search:'?service=ltori&diagnosis=<script>'});
  assert.equal(invalid.fields.get('お問い合わせ内容').value,'');
  const existing=harness({search:`?service=ltori&diagnosis=${diagnostic}`,message:'自分で入力した相談内容'});
  assert.equal(existing.fields.get('お問い合わせ内容').value,'自分で入力した相談内容');
});
