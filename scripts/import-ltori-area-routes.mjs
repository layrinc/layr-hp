/** Build stable regional URLs from reviewed GSI / ABR-derived snapshots.
 * node scripts/import-ltori-area-routes.mjs <geolonia-ja.json> <YYYY-MM-DD>
 * No network requests or page-count limit. Existing routes remain stable on import.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import gsi from '../src/data/ltori-municipalities.json' with { type: 'json' };
import groups from '../src/data/ltori-prefectures.json' with { type: 'json' };

const [sourceFile, retrievedAt] = process.argv.slice(2);
if (!sourceFile || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt || '')) throw Error('Provide local ja.json and retrieval date.');
const sourceText = await readFile(sourceFile, 'utf8');
const source = JSON.parse(sourceText);
const output = new URL('../src/data/ltori-area-routes.json', import.meta.url);
let previous = [];
try { previous = JSON.parse(await readFile(output, 'utf8')).areas; } catch (error) { if (error.code !== 'ENOENT') throw error; }
const priorSlugs = new Map(previous.map(a => [a.code, a.slug]));
const prefectures = new Map(groups.flatMap(g => g.prefectures.map(([slug, name]) => [name, slug])));
const safeSlug = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const romanSlug = value => safeSlug(value.replace(/-(shi|machi|cho|mura|son|ku|gun)$/i, ''));
const candidates = source.data.flatMap(pref => pref.cities.map(city => ({
  code: String(city.code).padStart(6, '0').slice(0, 5),
  prefecture: prefectures.get(pref.pref),
  name: `${city.city}${city.ward || ''}`,
  county: city.county || '',
  slug: [romanSlug(city.city_r), ...(city.ward ? [romanSlug(city.ward_r)] : [])].join('-'),
  qualifiedSlug: safeSlug([city.city_r, city.ward_r || ''].filter(Boolean).join('-')),
  countySlug: city.county_r ? romanSlug(city.county_r) : '',
  cityName: city.city,
  cityRoman: city.city_r,
})));
const byCode = new Map(candidates.map(a => [a.code, a]));
// GSI still includes the legacy Tomiya town code alongside its current city code.
// Keep only the current code already present in the ABR-derived snapshot.
const legacyCodes = new Map([['04423', '04216']]);
for (const g of gsi.areas) {
  if (byCode.has(g.jisCode)) continue;
  if (legacyCodes.has(g.jisCode) && byCode.has(legacyCodes.get(g.jisCode))) continue;
  const ward = candidates.find(a => a.prefecture === prefectures.get(g.prefecture) && a.cityName === g.name);
  if (!ward) throw Error(`Unresolved region ${g.jisCode} ${g.prefecture}${g.name}; review source data.`);
  const parent = { code: g.jisCode, prefecture: ward.prefecture, name: g.name, county: '', slug: romanSlug(ward.cityRoman), countySlug: '' };
  candidates.push(parent); byCode.set(parent.code, parent);
}
// Disambiguate same-prefecture homonyms such as Hokkaido's two Tomari villages.
const counts = new Map();
for (const a of candidates) { const key = `${a.prefecture}/${a.slug}`; counts.set(key, (counts.get(key) || 0) + 1); }
const areas = candidates.map(a => ({
  code: a.code, prefecture: a.prefecture, name: a.name,
  ...(a.county ? { county: a.county } : {}),
  slug: priorSlugs.get(a.code) || (counts.get(`${a.prefecture}/${a.slug}`) > 1 ? [a.countySlug, a.qualifiedSlug || a.slug].filter(Boolean).join('-') : a.slug),
})).sort((a, b) => a.code.localeCompare(b.code));
if (areas.length < 1700 || new Set(areas.map(a => a.prefecture)).size !== 47 || new Set(areas.map(a => a.code)).size !== areas.length) throw Error('Incomplete municipality source.');
const invalid = areas.filter(a => !a.prefecture || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug));
const duplicate = areas.filter((a, i) => areas.findIndex(b => b.prefecture === a.prefecture && b.slug === a.slug) !== i);
if (invalid.length || duplicate.length) throw Error('Invalid or duplicate regional URL: ' + JSON.stringify({ invalid, duplicate }));
const metadata = {
  source: 'Geolonia japanese-addresses-v2（デジタル庁アドレス・ベース・レジストリ由来）と国土地理院の市区町村コード',
  sourceUrl: 'https://japanese-addresses-v2.geoloniamaps.com/api/ja.json',
  sourceRepository: 'https://github.com/geolonia/japanese-addresses-v2',
  retrievedAt, sourceUpdatedAt: new Date(source.meta.updated * 1000).toISOString().slice(0, 10),
  sha256: createHash('sha256').update(sourceText).digest('hex'),
  gsiSourceUrl: gsi.metadata.sourceUrl,
  corrections: [{ from: '04423', to: '04216', reason: '富谷市の旧町コードによる重複を除外。現行コードを使用。' }],
  note: '政令指定都市と行政区を含む地域レコード。自治体数とは異なる。コードとURLはデータ更新時にも維持する。',
};
// One row per region keeps the reviewed snapshot and future diffs readable.
await writeFile(output, '{\n  "metadata": ' + JSON.stringify(metadata, null, 2).replace(/\n/g, '\n  ') + ',\n  "areas": [\n' + areas.map(a => '    ' + JSON.stringify(a)).join(',\n') + '\n  ]\n}\n');
console.log(`${areas.length} municipality/ward routes + 47 prefecture routes prepared for one build.`);
