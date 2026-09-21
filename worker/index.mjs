import {handleRequest} from './seo-access.mjs';

import {handleManagerApi} from './seo-manager-api.mjs';
import {publicFetch,previewDocument,runJob,getStaticPages} from './seo-runtime.mjs';
import {initializeGrowth} from './seo-bootstrap.mjs';

export default {
  async fetch(request,env,ctx) {
    try {
      return await handleRequest(request,env,undefined,{
        publicFetch,
        authenticated:async(req,bindings,identity,path)=>{
          if(identity.email.toLowerCase()!=='biz.oneservice@gmail.com') return new Response('この操作を行う権限がありません。',{status:403,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
          await initializeGrowth(bindings);
          return handleManagerApi(req,bindings,identity,path,{
            staticPages:getStaticPages(),
            preview:doc=>previewDocument(bindings,doc,{preview:true}),
            runJob:async kind=>{ctx.waitUntil(runJob(bindings,kind).catch(()=>{}));return {status:'queued',message:'処理を開始しました。少し待ってから更新してください。'};},
          });
        },
      });
    } catch {return new Response('一時的に処理を完了できませんでした。時間をおいて再度お試しください。',{status:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});}
  },
  async scheduled(controller,env,ctx) {
    await initializeGrowth(env);
    const now=new Date(controller.scheduledTime??Date.now());
    if(controller.cron==='0 0 * * *')ctx.waitUntil(runJob(env,'publish',{now}));
    else ctx.waitUntil(Promise.allSettled([runJob(env,'analytics',{now}),runJob(env,'inspection',{now})]));
  },
};
