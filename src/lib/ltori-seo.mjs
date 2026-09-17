import guides from '../data/ltori-guides.json' with { type: 'json' };
import prefectureGroups from '../data/ltori-prefectures.json' with { type: 'json' };

export { prefectureGroups };
export const guideKey = (guide) => `${guide.kind}/${guide.slug}`;
export const guidePath = (guide) => `/service/ltori/${guideKey(guide)}/`;
export const guideName = (guide) => `${guide.prefecture || ''}${guide.label}`;

// Draft records never produce HTML, links, or sitemap entries.
// This checks publishing mechanics; editorial quality still needs review in the PR.
export function selectPublishedGuides(records = guides) {
  const published = records.filter((guide) => guide.status === 'ready');
  const seen = new Set();
  const prefectures = new Set(prefectureGroups.flatMap((group) => group.prefectures.map(([slug]) => slug)));
  for (const guide of published) {
    const key = guideKey(guide);
    if (seen.has(key)) throw new Error(`Duplicate ltori guide: ${key}`);
    seen.add(key);
    if (!['area', 'industry'].includes(guide.kind) || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(guide.slug) || (guide.kind === 'industry' && guide.slug.includes('/'))) {
      throw new Error(`Invalid ltori guide path: ${key}`);
    }
    if (guide.kind === 'area' && !prefectures.has(guide.slug.split('/')[0])) throw new Error(`Unknown prefecture: ${key}`);
    if (!guide.label || !guide.description || !guide.headline || !guide.lead || !guide.context || !guide.checkedAt || !guide.steps?.length || !guide.checklist?.length || !guide.faq?.length) {
      throw new Error(`Incomplete ltori guide: ${key}`);
    }
    if (guide.kind === 'area' && !guide.sources?.[guide.contextSource]?.url?.startsWith('https://')) {
      throw new Error(`Missing local source: ${key}`);
    }
  }
  for (const guide of published) {
    if (guide.kind === 'area' && guide.slug.includes('/') && !seen.has(`area/${guide.slug.split('/')[0]}`)) {
      throw new Error(`Missing parent prefecture: ${guideKey(guide)}`);
    }
    for (const related of guide.related || []) {
      if (!seen.has(related)) throw new Error(`Unpublished related guide: ${related}`);
    }
  }
  return published;
}

export const publishedGuides = selectPublishedGuides();
export const consultationHref = (source) => `/contact/?${new URLSearchParams({ service: 'ltori', source })}`;
export const sourceLabels = Object.fromEntries([
  ['area', '全国対応エリア'],
  ...publishedGuides.map((guide) => [guideKey(guide), `${guideName(guide)}の採用LINE`]),
]);
