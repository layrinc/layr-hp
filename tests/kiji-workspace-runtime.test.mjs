import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const bundle=await build({stdin:{resolveDir:new URL('../',import.meta.url).pathname,contents:`import {handleKijiWorkspace} from './worker/kiji-workspace.mjs';export default {fetch(request,env){return handleKijiWorkspace(request,env,{timeoutMs:100});}};`},bundle:true,write:false,format:'esm',platform:'browser'});
const service=`import {WorkerEntrypoint} from 'cloudflare:workers';export class SeoWorkspaceApi extends WorkerEntrypoint {async fetch(request){
 if(this.env.MODE==='redirect')return new Response('private body',{status:307,headers:{Location:'https://must-not-follow.invalid/secret','Set-Cookie':'secret'}});
 if(this.env.MODE==='error')throw new Error('private implementation error');
 if(this.env.MODE==='timeout')await new Promise(()=>{});
 return Response.json({ok:true,url:request.url,method:request.method,hasCookie:request.headers.has('Cookie'),hasAccess:request.headers.has('Cf-Access-Jwt-Assertion'),hasAuth:request.headers.has('Authorization'),origin:request.headers.get('Origin')});
}};export default {fetch(){return new Response('unauthorized',{status:401});}};`;
async function native(mode,callback){const outbound=[];const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'seo',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-01',serviceBindings:{KIJI_WORKSPACE:{name:'kiji',entrypoint:'SeoWorkspaceApi'}}},
 {name:'kiji',modules:true,script:service,compatibilityDate:'2026-08-01',bindings:{MODE:mode},outboundService:async req=>{outbound.push(req.url);return new Response('unexpected',{status:500});}}
]}));try{await callback(mf);assert.deepEqual(outbound,[]);}finally{await mf.dispose();}}
test('native service binding targets named fetch and does not forward browser credentials',{timeout:60000},async()=>native('ok',async mf=>{
 const res=await mf.dispatchFetch('https://seo.layr.co.jp/api/seo/kiji/keywords/12',{method:'PATCH',headers:{Origin:'https://seo.layr.co.jp','Content-Type':'application/json',Cookie:'private',Authorization:'private','Cf-Access-Jwt-Assertion':'private'},body:JSON.stringify({status:'new'})});
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,url:'https://kiji-workspace.internal/api/keywords/12',method:'PATCH',hasCookie:false,hasAccess:false,hasAuth:false,origin:'https://seo.layr.co.jp'});
}));
test('native redirects and exceptions fail closed without external fetch or leaked response headers',{timeout:60000},async()=>{
 for(const mode of ['redirect','error'])await native(mode,async mf=>{const res=await mf.dispatchFetch('https://seo.layr.co.jp/api/seo/kiji/overview');assert.equal(res.status,502);assert.equal(res.headers.has('location'),false);assert.equal(res.headers.has('set-cookie'),false);assert.doesNotMatch(await res.text(),/private|secret|implementation/);});
});
