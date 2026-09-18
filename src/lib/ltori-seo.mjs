import master from '../data/ltori-area-routes.json' with { type: 'json' };
import prefectureGroups from '../data/ltori-prefectures.json' with { type: 'json' };

export { prefectureGroups };
export const areaIndexPath = '/service/ltori/area/';
export const areaPath = area => `${areaIndexPath}${area.slug}/`;
export const areaKey = area => `area/${area.slug}`;
export const consultationHref = (source = '') => `/contact/?${new URLSearchParams({ service: 'ltori', ...(source ? { source } : {}) })}`;
export const prefectureAreas = prefectureGroups.flatMap(group => group.prefectures.map(([slug, name]) => ({
  kind: 'prefecture', slug, name, fullName: name, prefectureSlug: slug, prefectureName: name,
})));
const prefectureBySlug = new Map(prefectureAreas.map(area => [area.slug, area]));

// Preserve the full master for address validation and legacy manager backups.
// Publication is separately gated by ltori-publication.mjs.
export function createMunicipalityAreas(records = master.areas) {
  const codes = new Set();
  const paths = new Set();
  return records.map(record => {
    const prefecture = prefectureBySlug.get(record.prefecture);
    if (!prefecture) throw new Error(`Unknown prefecture: ${record.prefecture}`);
    if (!/^\d{5}$/.test(record.code) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.slug) || !record.name) {
      throw new Error(`Invalid municipality: ${record.code}`);
    }
    const slug = `${record.prefecture}/${record.slug}`;
    if (codes.has(record.code) || paths.has(slug)) throw new Error(`Duplicate municipality: ${record.code} ${slug}`);
    codes.add(record.code);
    paths.add(slug);
    const name = `${record.county || ''}${record.name}`;
    return { kind: 'municipality', code: record.code, slug, name, locality: record.name,
      fullName: `${prefecture.name}${name}`, prefectureSlug: prefecture.slug, prefectureName: prefecture.name };
  });
}
export const municipalityAreas = createMunicipalityAreas();
export const regionalAreas = [...prefectureAreas, ...municipalityAreas];
export const isEligibleArea = area => area.kind === 'prefecture' || area.locality.endsWith('市');
export const cityAreas = municipalityAreas.filter(isEligibleArea);
export const eligibleAreas = regionalAreas.filter(isEligibleArea);
export const areasBySlug = new Map(regionalAreas.map(area => [area.slug, area]));
export const municipalitiesFor = slug => municipalityAreas.filter(area => area.prefectureSlug === slug);
export const parentPrefecture = area => prefectureBySlug.get(area.prefectureSlug);
export const sourceLabels = Object.fromEntries([
  ['area', '都道府県・市別の採用LINE'],
  ...regionalAreas.map(area => [areaKey(area), `${area.fullName}の採用LINE`]),
]);
export const areaFaq = area => ({
  q: `${area.fullName}の企業でも、採用LINEの構築・運用を依頼できますか？`,
  a: `はい。${area.fullName}の企業さまの採用LINE構築・運用を、オンラインで支援します。募集職種や現在の採用方法を伺い、企業紹介の配信、応募・面談予約、入社前フォローまで必要な導線を設計します。現地撮影・訪問が必要な場合は、対応可否と費用を個別にご相談ください。`,
});
