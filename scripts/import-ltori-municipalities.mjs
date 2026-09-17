/** Import a reviewed GSI municipalities snapshot without executing source JavaScript.
 * Usage: node scripts/import-ltori-municipalities.mjs <downloaded-muni.js> <YYYY-MM-DD>
 * Download source: https://maps.gsi.go.jp/js/muni.js
 * Administrative wards are records too; record count is NOT municipality count.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [input, retrievedAt] = process.argv.slice(2);
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt || '')) throw new Error('Provide a local source file and retrieval date (YYYY-MM-DD).');
const text = await readFile(input, 'utf8');
const pattern = /GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*['"]([^'"]+)['"]/g;
const areas = [...text.matchAll(pattern)].map(([, key, value]) => {
  const [prefCode, prefecture, cityCode, name] = value.split(',');
  if (Number(key) !== Number(cityCode) || !prefecture || !name) throw new Error(`Invalid municipality: ${key}`);
  return { jisCode: key.padStart(5, '0'), prefectureCode: prefCode.padStart(2, '0'), prefecture, name: name.trim().replace(/\u3000/g, ' ') };
});
if (new Set(areas.map(x => x.prefectureCode)).size !== 47 || areas.length < 1700 || new Set(areas.map(x => x.jisCode)).size !== areas.length) throw new Error('Incomplete or duplicate source data. Existing snapshot was not changed.');
const metadata = { source: '国土地理院 地理院地図 市区町村コード一覧', sourceUrl: 'https://maps.gsi.go.jp/js/muni.js', retrievedAt, sourceUpdatedAt: null, sha256: createHash('sha256').update(text).digest('hex'), note: '原典に更新日の明示なし。行政区を含む地域レコード。取得日は行政区画の施行基準日ではない。公開前に各自治体の最新情報を確認する。' };
await writeFile(new URL('../src/data/ltori-municipalities.json', import.meta.url), JSON.stringify({ metadata, areas }, null, 2) + '\n');
console.log(`Imported ${areas.length} regional records across 47 prefectures. No public pages were generated.`);
