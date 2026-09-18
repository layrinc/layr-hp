import policy from '../data/ltori-publication.json' with {type:'json'};
import content from '../data/ltori-city-editorial.json' with {type:'json'};
import {regionalAreas, isEligibleArea} from './ltori-seo.mjs';

export function validateReleases(input, areas, editorial) {
  if (input.dailyLimit !== 3 || !Array.isArray(input.releases)) throw new Error('Publication limit must be 3 reviewed pages/day');
  const bySlug = new Map(areas.map(area => [area.slug, area])), seen = new Set(), counts = new Map();
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0,10) === value;
  for (const release of input.releases) {
    const area = bySlug.get(release.slug), copy = editorial[release.slug];
    if (!area || !isEligibleArea(area) || seen.has(release.slug)) throw new Error(`Out of scope or duplicate release: ${release.slug}`);
    if (!validDate(release.publishOn) || !validDate(release.reviewedOn) || release.reviewedOn > release.publishOn) throw new Error('Invalid review/publication date');
    if (!copy?.context || !copy.title || copy.steps?.length !== 3 || !copy.message || !copy.checklist?.length || !copy.sources?.length || copy.checkedOn !== release.reviewedOn) throw new Error(`Editorial review missing: ${release.slug}`);
    seen.add(release.slug);
    counts.set(release.publishOn, (counts.get(release.publishOn) || 0) + 1);
    if (counts.get(release.publishOn) > input.dailyLimit) throw new Error('Daily publication limit exceeded');
  }
  return input.releases;
}
const releases = validateReleases(policy, regionalAreas, content);
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(new Date());
const live = new Set(releases.filter(row => row.publishOn <= today).map(row => row.slug));
export const publishedAreas = regionalAreas.filter(area => live.has(area.slug));
export const publicationFor = area => !isEligibleArea(area) ? 'excluded' : live.has(area.slug) ? 'published' : 'draft';
export const publishedFor = slug => publishedAreas.filter(area => area.kind !== 'prefecture' && area.prefectureSlug === slug);
export const cityEditorial = content;
