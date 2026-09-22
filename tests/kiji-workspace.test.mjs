import test from 'node:test';
import assert from 'node:assert/strict';
import {handleKijiWorkspace,MAX_REQUEST_BYTES} from '../worker/kiji-workspace.mjs';
import {handleManagerApi} from '../worker/seo-manager-api.mjs';
const origin='https://seo.layr.co.jp';
const request=(path='overview',method='GET',body,headers={})=>new Request(origin+'/api/seo/kiji/'+path,{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const binding=fn=>({KIJI_WORKSPACE:{fetch:fn}});
test('bounded proxy allows supported methods only and strips browser authentication',async()=>{
 let sent;const env=binding(async req=>{sent=req;return Response.json({ok:true,item:{id:1}});});
 const res=await handleManagerApi(request('keywords/1','PATCH',{status:'new'},{Cookie:'private-cookie',Authorization:'private-token','Cf-Access-Jwt-Assertion':'private-jwt'}),env,{email:'biz.oneservice@gmail.com'},'/api/seo/kiji/keywords/1');
 assert.equal(res.status,200);assert.equal(sent.url,'https://kiji-workspace.internal/api/keywords/1');
 assert.equal(sent.headers.has('Cookie'),false);assert.equal(sent.headers.has('Authorization'),false);assert.equal(sent.headers.has('Cf-Access-Jwt-Assertion'),false);assert.equal(sent.redirect,'manual');
 assert.equal((await handleManagerApi(request('keywords/1','PATCH',{}),env,{email:'other@example.test'},'/api/seo/kiji/keywords/1')).status,403);
 assert.equal((await handleManagerApi(new Request(origin+'/api/seo/state',{method:'PATCH'}),env,{email:'biz.oneservice@gmail.com'},'/api/seo/state')).status,405);
});
test('same-origin, exact route, verb and query allowlists reject before binding access',async()=>{
 const env=binding(()=>assert.fail('must not call binding'));
 for(const [req,status] of [[request('tick','POST',{}, {Origin:'https://evil.test'}),403],[request('settings','DELETE',{}),405],[request('keywords/import-material','POST',{}),404],[request('articles/1/approve/extra','POST',{}),404],[request('articles/01'),404],[request('keywords?q=ok&q=again'),400],[request('keywords?token=secret'),400],[request('keywords?q='+encodeURIComponent('a'.repeat(201))),400]])assert.equal((await handleKijiWorkspace(req,env)).status,status);
});
test('settings cannot read or change internal, login or publishing configuration',async()=>{
 const env=binding(async()=>Response.json({ok:true,settings:{autopilot:'approval',google_client_id:'hidden',publish_repo:'hidden',__workspace_mutation_lease:'hidden',model_body:'selected'}}));
 assert.deepEqual((await (await handleKijiWorkspace(request('settings'),env)).json()).settings,{autopilot:'approval',model_body:'selected'});
 for(const body of [{publish_repo:'other'},{google_client_id:'bad'},{__workspace_mutation_lease:'bad'},{daily_cap:99},{categories:['a'.repeat(61)]}])assert.equal((await handleKijiWorkspace(request('settings','PUT',body),binding(()=>assert.fail()))).status,400);
});
test('JSON and streaming size limits, no implicit non-JSON fallback',async()=>{
 const env=binding(()=>assert.fail());
 assert.equal((await handleKijiWorkspace(request('tick','POST','nope'),env)).status,400);
 assert.equal((await handleKijiWorkspace(request('tick','POST',[],{'Content-Type':'text/plain'}),env)).status,415);
 assert.equal((await handleKijiWorkspace(request('keywords/import','POST',JSON.stringify({csv:'x'.repeat(MAX_REQUEST_BYTES)})),env)).status,413);
 assert.equal((await handleKijiWorkspace(request('tick','POST',[],{}),env)).status,400);
});
test('redirects, exceptions and timeouts reveal no internal details or cookies',async()=>{
 for(const fetch of [async()=>new Response('sensitive',{status:302,headers:{Location:'https://secret.invalid','set-cookie':'private'}}),async()=>{throw Error('private binding secret');},async()=>Response.json({error:'private upstream secret'},{status:500}),async()=>new Response('<html>private</html>')]){
  const res=await handleKijiWorkspace(request(),binding(fetch));assert.equal(res.status,502===res.status?502:500);assert.equal(res.headers.has('location'),false);assert.equal(res.headers.has('set-cookie'),false);assert.doesNotMatch(await res.text(),/private|secret|sensitive/);
 }
 const res=await handleKijiWorkspace(request('tick','POST',{}),binding(()=>new Promise(()=>{})),{timeoutMs:10});assert.equal(res.status,504);assert.match(await res.text(),/自動再試行はしません/);
 assert.equal((await handleKijiWorkspace(request(),{})).status,503);
});
