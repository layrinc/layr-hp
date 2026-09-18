import {canonicalPath} from './model.mjs';
import {inquiryPageId, validateAnalyticsReport, validatePeriod} from './analytics-model.mjs';

export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly';
export function validateConnection(config) {
  if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(config.clientId || '')) throw new Error('Google OAuthのクライアントIDを入力してください。クライアントシークレットは使用しません。');
  if (!/^\d+$/.test(config.property || '')) throw new Error('GA4のプロパティID（数字）を入力してください。G-から始まる測定IDとは異なります。');
  if (!['sc-domain:layr.co.jp','https://layr.co.jp/'].includes(config.site)) throw new Error('layr.co.jpのSearch Consoleプロパティを選んでください。');
  return {clientId:config.clientId,property:config.property,site:config.site};
}
const filter = (fieldName,value,matchType='EXACT') => ({filter:{fieldName,stringFilter:{value,matchType}}});
export function gaRequest(kind,start,end) {
  const common = {dateRanges:[{startDate:start,endDate:end}],limit:'10000',keepEmptyRows:true};
  const host = filter('hostName','layr.co.jp');
  if (kind==='traffic') return {...common,dimensions:[{name:'pagePath'}],metrics:[{name:'screenPageViews'},{name:'totalUsers'}],dimensionFilter:{andGroup:{expressions:[host,filter('pagePath','/service/ltori/area/','BEGINS_WITH')]}}};
  if (kind==='landings') return {...common,dimensions:[{name:'landingPage'}],metrics:[{name:'sessions'}],dimensionFilter:{andGroup:{expressions:[host,filter('landingPage','/service/ltori/area/','BEGINS_WITH')]}}};
  if (kind==='inquiries') return {...common,dimensions:[{name:'pagePathPlusQueryString'}],metrics:[{name:'eventCount'}],dimensionFilter:{andGroup:{expressions:[host,filter('eventName','ltori_inquiry_complete'),filter('pagePathPlusQueryString','/contact/','BEGINS_WITH')]}}};
  throw new Error('Unknown GA report');
}
async function request(fetcher,url,token,body) {
  const res = await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data = await res.json();
  if (!res.ok) {
    const code = res.status;
    throw new Error(code===401?'Googleの接続期限が切れました。再接続してください。':code===403?'閲覧権限・APIの有効化を確認してください（403）。':code===429?'Google APIの利用上限です。時間を置いて再取得してください。':`Google APIの取得に失敗しました（${code}）。設定と期間を確認してください。`);
  }
  return data;
}
export async function fetchGoogleReport({config,token,start,end,catalog,fetcher=fetch}) {
  validateConnection(config); validatePeriod(start,end);
  if (!token) throw new Error('Googleに接続してください。');
  const byPath = new Map(catalog.map(p=>[p.path,p.id])), rows = new Map(), notes = [];
  const rowFor = id => {if(!rows.has(id)) rows.set(id,{pageId:id});return rows.get(id);};
  let gaTimezone = '', successes = 0;
  const requests = ['traffic','landings','inquiries'].map(async kind=>{
    const result = await request(fetcher,`https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`,token,gaRequest(kind,start,end));
    if (Number(result.rowCount||0)>10000) throw new Error('10,000行を超えています。期間を短くしてください。');
    return {kind,result};
  });
  requests.push((async()=>{
    const collected=[];
    for (let offset=0;offset<100000;offset+=25000) {
      const result=await request(fetcher,`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.site)}/searchAnalytics/query`,token,{startDate:start,endDate:end,dimensions:['page'],type:'web',dataState:'final',rowLimit:25000,startRow:offset,dimensionFilterGroups:[{filters:[{dimension:'page',operator:'contains',expression:'https://layr.co.jp/service/ltori/area/'}]}]});
      collected.push(...(result.rows||[]));
      if((result.rows||[]).length<25000) return {kind:'search',result:{rows:collected}};
    }
    throw new Error('検索実績の取得上限です。期間を短くしてください。');
  })());
  const results = await Promise.allSettled(requests);
  const names = ['GA4閲覧','GA4流入','GA4問い合わせ','Search Console'];
  results.forEach((out,index)=>{
    if(out.status==='rejected'){notes.push(`${names[index]}：${out.reason.message}`);return;}
    successes++;
    const {kind,result}=out.value;
    if(result.metadata?.timeZone)gaTimezone=result.metadata.timeZone;
    if(result.metadata?.subjectToThresholding || result.metadata?.dataLossFromOtherRow || result.metadata?.samplingMetadatas?.length) notes.push(`${names[index]}：しきい値・集約・サンプリングの影響があります。`);
    for(const entry of result.rows||[]) {
      const raw = kind==='search'?entry.keys[0]:entry.dimensionValues[0].value;
      const id = kind==='inquiries'?inquiryPageId(raw,catalog):byPath.get(canonicalPath(raw));
      if(!id)continue;
      const row=rowFor(id);
      if(kind==='search') Object.assign(row,{clicks:entry.clicks,impressions:entry.impressions,position:entry.impressions?entry.position:null});
      else if(kind==='inquiries') row.inquiries=(row.inquiries||0)+Number(entry.metricValues[0].value);
      else if(kind==='landings') row.sessions=(row.sessions||0)+Number(entry.metricValues[0].value);
      else {
        if(row.users!==undefined) throw new Error('同じ地域のパスが複数あります。総ユーザー数を重複合計できないため、URLの正規化を確認してください。');
        Object.assign(row,{views:Number(entry.metricValues[0].value),users:Number(entry.metricValues[1].value)});
      }
    }
  });
  if(!successes)throw new Error(notes.join('\n'));
  notes.push('行が返らない地域は「—」。計測未開始・データ反映待ち・ゼロ件を区別できないため、0に補完しません。');
  return validateAnalyticsReport({origin:'google',start,end,property:config.property,site:config.site,gaTimezone:gaTimezone||'プロパティの設定',importedAt:new Date().toISOString(),notes,rows:[...rows.values()]},catalog);
}
