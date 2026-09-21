import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewChannel} from '../src/lib/media-manager/preview-import.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const file=(name,pending)=>({name,text:()=>pending.promise});
function view(channel){
  const ui={pending:null,error:null};
  ui.select=()=>{channel.invalidate();ui.pending=null;};
  ui.read=(selected,meta={})=>channel.run({
    capture:()=>({file:selected,meta:{...meta}}),
    load:async snapshot=>({name:snapshot.file.name,text:await snapshot.file.text(),meta:snapshot.meta}),
    accept:value=>{ui.pending=value;},reject:error=>{ui.error=error.message;},
  });
  return ui;
}

test('backup A cannot be restored after B is selected while A.text() is pending',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred();
  const pending=ui.read(file('old-A.json',a));
  ui.select(); // The input now displays new-B.json; B has not been previewed yet.
  a.resolve('backup-A');
  assert.equal(await pending,false);assert.equal(ui.pending,null);assert.equal(ui.error,null);
});

test('only the latest plan file may become actionable when reads finish out of order',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred(),b=deferred();
  const first=ui.read(file('old-A.csv',a));ui.select();const latest=ui.read(file('new-B.csv',b));
  b.resolve('plan-B');assert.equal(await latest,true);
  a.resolve('plan-A');assert.equal(await first,false);assert.equal(ui.pending.name,'new-B.csv');assert.equal(ui.pending.text,'plan-B');
});

test('changing volume survey metadata invalidates the old read and keeps the new snapshot',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred(),b=deferred(),meta={source:'A',periodStart:'2026-01-01'};
  const first=ui.read(file('volume.csv',a),meta);
  meta.source='B';meta.periodStart='2026-02-01';ui.select();
  const latest=ui.read(file('volume.csv',b),meta);
  b.resolve('Keyword,Volume\n採用,10');await latest;a.resolve('Keyword,Volume\n採用,0');await first;
  assert.equal(ui.pending.meta.source,'B');assert.equal(ui.pending.meta.periodStart,'2026-02-01');assert.match(ui.pending.text,/,10$/);
});

test('a snapshot captures the selected filename and metadata before its asynchronous read',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred(),meta={source:'first'};
  const pending=ui.read(file('A.csv',a),meta);meta.source='changed outside the request';a.resolve('A-content');await pending;
  assert.deepEqual(ui.pending,{name:'A.csv',text:'A-content',meta:{source:'first'}});
});

test('Google Sheet and local plan imports share one generation in both directions',async()=>{
  for(const [firstSource,nextSource] of [['Google Sheet','local.json'],['local.csv','Google Sheet']]){
    const channel=createPreviewChannel(),ui=view(channel),a=deferred(),b=deferred();
    const first=ui.read(file(firstSource,a));ui.select();const latest=ui.read(file(nextSource,b));
    a.resolve('stale-plans');assert.equal(await first,false);assert.equal(ui.pending,null);
    b.resolve('current-plans');assert.equal(await latest,true);assert.equal(ui.pending.name,nextSource);
  }
});

test('a stale parsing/read failure cannot replace the current preview or show a misleading error',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred(),b=deferred();
  const first=ui.read(file('bad-A.json',a));const latest=ui.read(file('good-B.json',b));
  b.resolve('B');await latest;a.reject(new Error('A failed'));assert.equal(await first,false);
  assert.equal(ui.error,null);assert.equal(ui.pending.name,'good-B.json');
});

test('current file validation errors are reported and never produce a preview',async()=>{
  const channel=createPreviewChannel(),ui=view(channel),a=deferred();const pending=ui.read(file('bad.json',a));
  a.reject(new Error('JSONが不正'));assert.equal(await pending,false);assert.equal(ui.error,'JSONが不正');assert.equal(ui.pending,null);
  let captureError;
  await channel.run({capture:()=>{throw new Error('ファイルを選択');},load:()=>assert.fail('must not read'),accept:()=>assert.fail('must not preview'),reject:error=>{captureError=error.message;}});
  assert.equal(captureError,'ファイルを選択');
});

test('independent volume, plan, and backup channels do not invalidate each other',async()=>{
  const volume=view(createPreviewChannel()),plans=view(createPreviewChannel()),backup=view(createPreviewChannel());
  const a=deferred(),b=deferred(),c=deferred();const operations=[volume.read(file('volume.csv',a)),plans.read(file('plans.csv',b)),backup.read(file('backup.json',c))];
  volume.select();a.resolve('volume');b.resolve('plans');c.resolve('backup');
  assert.deepEqual(await Promise.all(operations),[false,true,true]);assert.equal(volume.pending,null);assert.equal(plans.pending.text,'plans');assert.equal(backup.pending.text,'backup');
});

test('superseded Google authorization can stop before fetching or exposing its result',async()=>{
  const channel=createPreviewChannel(),authorization=deferred();let fetched=false,accepted=false;
  const pending=channel.run({capture:()=>({clientId:'client-A'}),load:async(snapshot,isCurrent)=>{await authorization.promise;if(!isCurrent())return null;fetched=true;return snapshot;},accept:()=>{accepted=true;},reject:()=>assert.fail('no current failure')});
  channel.invalidate();authorization.resolve('token-A');assert.equal(await pending,false);assert.equal(fetched,false);assert.equal(accepted,false);
});
