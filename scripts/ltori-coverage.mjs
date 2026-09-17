import {writeFile} from 'node:fs/promises';
import {prefectureAreas, municipalityAreas, regionalAreas, areaPath} from '../src/lib/ltori-seo.mjs';
import master from '../src/data/ltori-area-routes.json' with {type:'json'};
const lines = [
  '# エルトリ 全国地域LP 管理台帳', '',
  '全地域を同じサービスLPテンプレートから一括生成する。少数都市の原稿待ちや段階公開の制限は設けない。', '',
  `- 都道府県LP: ${prefectureAreas.length}ページ。市区町村・行政区LP: ${municipalityAreas.length}ページ。地域LP合計: ${regionalAreas.length}ページ。別途、全国一覧1ページ。`,
  '- これはビルド対象数。本番公開の状態はPR・Cloudflareのリリースで確認する。',
  '- 政令指定都市とその行政区をそれぞれ収録しているため、市区町村・行政区レコード数は自治体数と異なる。',
  `- 原典: [Geolonia Japanese Addresses](${master.metadata.sourceRepository}) / [国土地理院](${master.metadata.gsiSourceUrl})。取得日 ${master.metadata.retrievedAt}。Geolonia側のデータ更新日 ${master.metadata.sourceUpdatedAt}。`,
  '- 富谷市は旧コード04423の重複を除き、現行コード04216を使用。名称や行政区再編は更新時に差分確認する。', '',
  '## 都道府県別の生成対象', '',
  '| 都道府県 | 市区町村・行政区LP | 都道府県LP |', '| --- | ---: | --- |',
];
for (const pref of prefectureAreas) lines.push(`| ${pref.name} | ${municipalityAreas.filter(a=>a.prefectureSlug===pref.slug).length} | ${areaPath(pref)} |`);
lines.push('', '## 全地域URL', '', '| JISコード | 地域 | URL |', '| --- | --- | --- |');
for (const area of municipalityAreas) lines.push(`| ${area.code} | ${area.fullName} | ${areaPath(area)} |`);
lines.push('', '## 更新', '',
  '`node scripts/import-ltori-area-routes.mjs <Geoloniaのja.json> <取得日>` で経路マスターを更新。元データの差分を確認し、既存JISコードのURLは維持する。改称・統合でURLの削除が生じる場合は、後継ページへのリダイレクトを同じPRで追加する。', '',
  '`node scripts/ltori-coverage.mjs` でこの台帳を更新し、`npm run build` と `node --test tests/ltori-seo.test.mjs` で全件検証する。', '');
await writeFile(new URL('../docs/seo/ltori-coverage.md', import.meta.url), lines.join('\n'));
console.log(`Coverage: ${regionalAreas.length} regional LPs plus one directory.`);
