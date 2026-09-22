import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {GOOGLE_SCOPES,SHEETS_SCOPE} from '../src/lib/media-manager/google.mjs';

const source=await readFile(new URL('../src/lib/media-manager/app.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function authorize(scope,clientId){');
const end=source.indexOf('\nfunction selectedFile(',start);
assert.ok(start>=0&&end>start,'Use the actual app authorization function in the VM');
const authorizeSource=source.slice(start,end);
const scopes=value=>value.trim().split(/\s+/).filter(Boolean);
const existingWriteScope='https://www.googleapis.com/auth/drive.file';

function harness({granted,extraIdentityScopes=[],oauthError}={}) {
  const projectGrants=new Set([existingWriteScope]),calls=[],issued=new Map();
  const sdk={
    initTokenClient(config){
      const call={config};calls.push(call);
      return {requestAccessToken(override){
        call.override=override;
        const requested=scopes(override.scope??config.scope);
        const accepted=granted??requested;
        // Model Google's documented project-wide incremental grant combination.
        const includePrevious=override.include_granted_scopes??config.include_granted_scopes??true;
        const tokenScopes=new Set([...(includePrevious?projectGrants:[]),...accepted,...extraIdentityScopes]);
        accepted.forEach(scope=>projectGrants.add(scope));
        const access_token=`fake-access-${calls.length}`;
        issued.set(access_token,tokenScopes);
        queueMicrotask(()=>config.callback(oauthError?{error:oauthError}:{access_token,expires_in:3600,scope:[...tokenScopes].join(' ')}));
      }};
    },
    hasGrantedAllScopes(response,...required){const accepted=new Set(scopes(response.scope));return required.every(scope=>accepted.has(scope));},
  };
  const context=vm.createContext({window:{google:{accounts:{oauth2:sdk}}},loadIdentity:async()=>{},renderConnection:()=>{}});
  vm.runInContext(`let oauthPending=false;\n${authorizeSource}\nthis.authorize=authorize;this.isPending=()=>oauthPending;`,context);
  return {authorize:context.authorize,isPending:context.isPending,calls,issued,projectGrants};
}

test('media OAuth disables project-wide scope accumulation at both initialization and request',async()=>{
  const h=harness();
  const result=await h.authorize(GOOGLE_SCOPES,'media-client.apps.googleusercontent.com');
  assert.equal(h.calls[0].config.include_granted_scopes,false);
  assert.equal(h.calls[0].override.include_granted_scopes,false);
  assert.equal(h.calls[0].config.client_id,'media-client.apps.googleusercontent.com');
  assert.equal(h.calls[0].override.prompt,'consent');
  assert.deepEqual([...h.issued.get(result.token)].sort(),scopes(GOOGLE_SCOPES).sort());
  assert.equal(h.issued.get(result.token).has(existingWriteScope),false);
  assert.equal(h.projectGrants.has(existingWriteScope),true,'A new request must not revoke an existing application grant');
  assert.equal(h.isPending(),false);
});

test('GA4/GSC and Sheets tokens keep separate readonly scopes regardless of connection order',async()=>{
  for(const order of [[GOOGLE_SCOPES,SHEETS_SCOPE],[SHEETS_SCOPE,GOOGLE_SCOPES]]) {
    const h=harness(),tokens=[];
    for(const requested of order) {
      const result=await h.authorize(requested,'media-client.apps.googleusercontent.com');tokens.push(result.token);
      assert.deepEqual([...h.issued.get(result.token)].sort(),scopes(requested).sort());
      assert.equal(h.issued.get(result.token).has(existingWriteScope),false);
    }
    assert.notEqual(tokens[0],tokens[1]);
    assert.deepEqual(h.calls.map(call=>call.config.scope),order);
  }
});

test('granular refusal still prevents adoption of a token missing a required analytics scope',async()=>{
  const h=harness({granted:['https://www.googleapis.com/auth/analytics.readonly']});
  await assert.rejects(h.authorize(GOOGLE_SCOPES,'media-client.apps.googleusercontent.com'),/必要な読み取り権限/);
  assert.equal(h.isPending(),false,'A rejected response must not leave the connection UI pending');
});

test('required-scope validation remains compatible with standard Google identity scope metadata',async()=>{
  const h=harness({extraIdentityScopes:['openid','https://www.googleapis.com/auth/userinfo.email']});
  const result=await h.authorize(SHEETS_SCOPE,'media-client.apps.googleusercontent.com');
  assert.ok(result.token);assert.equal(h.issued.get(result.token).has(SHEETS_SCOPE),true);
  assert.equal(h.issued.get(result.token).has(existingWriteScope),false);
  assert.equal(h.isPending(),false);
});

test('OAuth errors never return a usable token and release the pending state',async()=>{
  const h=harness({oauthError:'access_denied'});
  await assert.rejects(h.authorize(SHEETS_SCOPE,'media-client.apps.googleusercontent.com'),/接続が完了しませんでした/);
  assert.equal(h.isPending(),false);
});
