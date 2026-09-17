import {readFile, writeFile} from 'node:fs/promises';
import {publishedGuides, guidePath} from '../src/lib/ltori-seo.mjs';
const read = async name => JSON.parse(await readFile(new URL(`../src/data/${name}`, import.meta.url),'utf8'));
const master=await read('ltori-municipalities.json');
const pilot=await read('ltori-pilot.json');
const groups=await read('ltori-prefectures.json');
const cityGuides=publishedGuides.filter(g=>g.municipalityCode);
const byCode=new Map(cityGuides.map(g=>[g.municipalityCode,g]));
for (const guide of cityGuides) {
  const area=master.areas.find(a=>a.jisCode===guide.municipalityCode);
  if (!area || area.name!==guide.label || area.prefecture!==guide.prefecture) throw new Error(`Municipality mismatch: ${guide.slug}`);
}
const lines=[
  '# エルトリ 全国地域SEO 管理台帳', '',
  'この台帳は調査の抜けを防ぐためのものです。掲載原稿数と本番公開数は別です。', '',
  `- 対象: ${master.areas.length}地域レコード / 47都道府県。政令市と行政区を含むため、自治体数ではありません。`,
  `- 原典: [${master.metadata.source}](${master.metadata.sourceUrl})。取得日 ${master.metadata.retrievedAt}。原典の更新日は未表示。`,
  '- 原稿・実装: 全国ハブ1、都道府県2、市2、業種3。今回のPR内の原稿であり、本番未公開。',
  '- 初期調査候補: 5府県30市。需要・提供実績・相談内容の調査により入れ替える。',
  '- 取得後の市制施行・合併・行政区再編は自治体公式情報と照合する。', '',
  '## 都道府県別のカバレッジ', '',
  '| 都道府県 | 地域レコード数 | 府県原稿 | 市区町村原稿 |', '| --- | ---: | --- | ---: |',
];
for(const group of groups)for(const [slug,name] of group.prefectures){
  const count=master.areas.filter(a=>a.prefecture===name).length;
  const prefectureReady=publishedGuides.some(g=>g.kind==='area'&&g.slug===slug);
  lines.push(`| ${name} | ${count} | ${prefectureReady?'PR原稿あり':'未調査'} | ${cityGuides.filter(g=>g.prefecture===name).length} |`);
}
lines.push('', '## 初期30市の調査キュー', '', pilot.note, '', '| JISコード | 地域 | 状態 | 原稿URL |', '| --- | --- | --- | --- |');
const allPilot=[];
for(const pref of pilot.prefectures)for(const city of pref.cities){
  const area=master.areas.find(a=>a.prefecture===pref.name&&a.name===city);
  if(!area)throw new Error(`Pilot not found: ${pref.name}${city}`);
  allPilot.push(area.jisCode);
  const guide=byCode.get(area.jisCode);
  lines.push(`| ${area.jisCode} | ${pref.name}${city} | ${guide?'原稿作成・技術検証':'調査待ち'} | ${guide?'`'+guidePath(guide)+'`':'—'} |`);
}
if(allPilot.length!==30||new Set(allPilot).size!==30)throw new Error('Expected 30 unique pilot cities.');
lines.push('', '## 1地域ごとに残す情報', '',
  '調査日、一次資料URL、対象年度、事業所・雇用の特徴、採用担当者の課題、検索意図、想定するLINEの役割、作例、内容確認者、公開日、更新期限、検索表示/クリック/相談/商談/受注。未確認の値は空欄とし、推測の数値で埋めない。', '',
  '公的統計は採用への意味を説明できる場合に使う。人口だけを追加して独自性があるとは判定しない。', '',
  '## 更新方法', '',
  '`node scripts/ltori-coverage.mjs` でデータから再生成。自治体マスター更新時は元データを保存し、`node scripts/import-ltori-municipalities.mjs <muni.js> <取得日>` を実行。差分の追加・消滅・改称を確認してPRに含める。自動公開や定期実行は行わない。', '',
);
await writeFile(new URL('../docs/seo/ltori-coverage.md',import.meta.url),lines.join('\n'));
console.log(`Coverage prepared: ${master.areas.length} regional records; ${allPilot.length} pilot cities; ${cityGuides.length} city manuscripts.`);
