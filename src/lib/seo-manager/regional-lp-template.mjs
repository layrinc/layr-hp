import service from '../../data/service-ltori.json' with {type:'json'};
import company from '../../data/company.json' with {type:'json'};
import geography from '../../data/ltori-municipalities.json' with {type:'json'};
import {cityAreas,areaPath} from '../ltori-seo.mjs';
import {localCoverageFor,localPlacesFor,townSource} from '../ltori-local-content.mjs';
import {normalizeDocument,qualityIssues} from './editorial-model.mjs';

export const REGIONAL_LP_TEMPLATE_VERSION='regional-lp-20260923-v1';
export const REGIONAL_LP_REVIEWER='既存LPテンプレート・地域マスター検査';
const cities=new Map(cityAreas.map(city=>[city.slug,city]));
const geographicRecords=new Map(geography.areas.map(row=>[row.jisCode,row]));
const contentFields=['schemaVersion','id','type','slug','title','description','heading','lead','intent','region','sections','example','sources','relatedCitySlugs','regionalLp'];
const error=(code,message,field)=>({code,message,field,severity:'error'});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:object(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
function validTime(value,label) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new RangeError(`${label}を確認してください。`);
  return date;
}
function masterCity(slug) {
  const city=typeof slug==='string'?cities.get(slug):null;
  if(!city)throw new RangeError('全国市マスターにある市のURLを指定してください。');
  const record=geographicRecords.get(city.code);
  if(!record||record.name!==city.locality||record.prefecture!==city.prefectureName)throw new Error('地域マスターの市コード・地域名が一致しません。');
  return city;
}

/** Existing service-LP copy plus stored address names. No research, inference,
 * model call, clock mutation, I/O, or assertion of local employment conditions.
 * The caller owns approval and publication after validating this draft.
 */
export function createRegionalLpDocument(citySlug,{now=new Date(),scheduledAt}={}) {
  const city=masterCity(citySlug),date=validTime(now,'生成日時');
  const schedule=scheduledAt==null?date.toISOString():validTime(scheduledAt,'公開予定日時').toISOString();
  const coverage=localCoverageFor(city),places=localPlacesFor(city);
  const locationText=places.length
    ?`${places.join('・')}など、${coverage.kind==='wards'?'市内の区':'郵便番号データにある町域表記'}を参考に、実際に募集する勤務地の住所・勤務時間・応募先を整理します。複数の拠点がある場合は、希望勤務地に応じた案内を設計します。`
    :'実際に募集する勤務地の住所・勤務時間・応募先を整理します。複数の拠点がある場合は、希望勤務地に応じた案内を設計します。';
  const document=normalizeDocument({
    type:'city',slug:city.slug,
    title:`${city.fullName}の採用LINE構築・運用支援｜${service.name}｜${company.name}`,
    description:`${city.fullName}の企業さまの採用LINE構築・運用を${service.name}がオンラインで支援。勤務地・職種に合わせた情報発信、応募・面談予約、入社前フォローまで、採用の流れに合わせて設計します。`,
    heading:`${city.fullName}の採用LINE構築・運用支援`,
    lead:`${city.fullName}で人材採用に取り組む企業さまへ。募集職種・勤務地・現在の採用方法を伺い、企業紹介の配信から応募・面談予約、入社前フォローまで、採用LINEの導線をオンラインで整えます。`,
    intent:'employer',
    sections:[
      {heading:`${city.locality}の勤務地・職種を分かりやすく案内`,paragraphs:[locationText],steps:['募集する拠点の住所、職種、勤務条件と連絡窓口を確認する','希望勤務地や職種に応じて、案内する情報と応募先を分ける']},
      {heading:`${city.locality}で働く候補者へ、職場の情報を届ける`,paragraphs:[`${city.fullName}での勤務を検討する候補者に、仕事内容、職場の様子、教育体制などを配信します。求人媒体や採用サイトと併用し、すぐに応募を決めていない方も質問できる接点をつくります。`],steps:['自社で確認できる職場の写真、仕事内容、募集条件を用意する','配信への同意と連絡方法の希望を確認し、企業紹介や質問受付の導線を整える']},
      {heading:`${city.locality}の見学・面談から、入社前の案内まで`,paragraphs:[`見学・面談を行う場合は、${city.locality}の実際の集合場所や当日の連絡先を案内します。オンライン面談の場合は接続方法を、入社前には持ち物や初日の予定を整理。利用するツール・プランに合わせて、予約案内やリマインドと担当者の対応範囲を設計します。`],steps:['希望日時、集合場所または接続方法、当日の連絡先を案内する','担当者が確認する内容と自動配信する内容を分け、入社前までの連絡を整える']},
    ],
    example:{label:'作例',title:`${city.locality}の企業向け・応募後の案内文`,body:'ご応募いただきありがとうございます。ご希望の職種・勤務地をお知らせください。担当者が確認し、次のご案内をお送りします。見学や面談をご希望の場合は、候補日時をお知らせください。LINE以外での連絡をご希望の方は、応募時の窓口からお知らせください。'},
    sources:[
      {title:geography.metadata.source,url:geography.metadata.sourceUrl,checkedAt:geography.metadata.retrievedAt,geographicScope:`${city.fullName}の地域名・所属都道府県・市区町村コード。雇用状況やサービスの効果を示す資料ではありません。`},
      {title:townSource.source,url:townSource.sourceUrl,checkedAt:townSource.retrievedAt,geographicScope:`${city.fullName}の郵便番号に用いられる町域表記・区名。掲載する地名は表記例であり、公称町名や重点対応地域を示すものではありません。`},
    ],
    relatedCitySlugs:[],
  },{now:date,scheduledAt:schedule});
  return {...document,regionalLp:{templateVersion:REGIONAL_LP_TEMPLATE_VERSION,cityCode:city.code,geographySourceSha256:geography.metadata.sha256,coverageSourceSha256:townSource.csvSha256}};
}

/** Exact master/template equality is distinct from article originality review.
 * Workflow fields may change when the server approves/publishes the draft; its
 * content and provenance may not silently change under template approval.
 */
export function validateRegionalLpDocument(document,{now=new Date()}={}) {
  if(!object(document))return [error('regional_lp_document','地域LPの原稿形式を確認してください。','document')];
  let expected,date;
  try {date=validTime(now,'確認日時');expected=createRegionalLpDocument(document.slug,{now:date,scheduledAt:document.scheduledAt});}
  catch {return [error('regional_lp_master','対象市または公開予定日時を地域マスターと照合できません。','region')];}
  const errors=[];
  try {
    for(const field of contentFields)if(stable(document[field])!==stable(expected[field]))errors.push(error('regional_lp_changed','既存LPテンプレートまたは地域マスターと内容が一致しません。',field));
  } catch {return [error('regional_lp_document','地域LPの原稿形式を確認してください。','document')];}
  if(document.path!==undefined&&document.path!==areaPath(masterCity(document.slug)))errors.push(error('regional_lp_path','地域LPの公開URLが対象市と一致しません。','path'));
  if(!document.scheduledAt||!Number.isFinite(Date.parse(document.scheduledAt)))errors.push(error('regional_lp_schedule','公開予定日時を確認してください。','scheduledAt'));
  if(document.review!==null&&document.review!==undefined) {
    if(document.review.reviewedBy!==REGIONAL_LP_REVIEWER||!Number.isFinite(Date.parse(document.review.reviewedAt))||Date.parse(document.review.reviewedAt)>date.getTime())errors.push(error('regional_lp_review','地域LPテンプレートの確認記録を確認してください。','review'));
  } else if(['approved','scheduled','published'].includes(document.status))errors.push(error('regional_lp_review','地域LPテンプレートの確認記録が必要です。','review'));
  try {errors.push(...qualityIssues(document,{now:date,requireReview:['approved','scheduled','published'].includes(document.status)}).filter(issue=>issue.severity==='error'));}
  catch {errors.push(error('regional_lp_document','地域LPの原稿形式を確認してください。','document'));}
  return errors;
}
