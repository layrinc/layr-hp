import { municipalityAreas, areasBySlug } from '../ltori-seo.mjs';

export const EDITORIAL_STATUSES = ['draft', 'approved', 'scheduled', 'published', 'paused'];
export const EDITORIAL_TYPES = ['city', 'article'];
export const DAILY_PUBLICATION_LIMIT = 20;
export const ARTICLE_TEMPLATE_PATH = '/service/ltori/article-template/';
export const cityCatalog = municipalityAreas.map(({ code, slug, name, fullName, prefectureName }) => ({ code, slug, name, fullName, prefectureName }));
const text = value => typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '';
const list = value => Array.isArray(value) ? value : [];
const strings = value => list(value).map(text).filter(Boolean);
const issue = (code, message, field, severity = 'error') => ({ code, message, field, severity });

export function resolveCity(slugOrCode) {
  const area = areasBySlug.get(text(slugOrCode)) || municipalityAreas.find(city => city.code === text(slugOrCode));
  return area?.kind === 'municipality' ? area : null;
}
export function isArticleSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100 && !['index', 'about', 'contact', 'category', 'article-template', 'feed', 'sitemap', 'assets'].includes(slug);
}
export function publicPath(document) {
  if (document?.type === 'city') {
    const city = resolveCity(document.slug || document.region?.cityId);
    return city ? `/service/ltori/area/${city.slug}/` : null;
  }
  return document?.type === 'article' && isArticleSlug(document.slug || '') ? `/service/ltori/media/${document.slug}/` : null;
}
export function publicSource(document) {
  return publicPath(document) ? `${document.type === 'city' ? 'area' : 'media'}/${document.slug}` : '';
}
export function isSafeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !/^(localhost|.*\.localhost|.*\.local|127\..*|0\.0\.0\.0|\[.*\])$/i.test(url.hostname) && url.hostname.includes('.');
  } catch { return false; }
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

/** Client review/status timestamps are intentionally ignored. The API owns transitions. */
export function normalizeDocument(input = {}, options = {}) {
  const type = text(input.type) || 'article';
  const city = type === 'city' ? resolveCity(input.slug || input.region?.cityId) : null;
  const slug = city?.slug || text(input.slug);
  const review = options.review || null;
  return {
    schemaVersion: 1,
    id: `${type}:${slug}`,
    type, slug, status: options.status || 'draft',
    title: text(input.title), description: text(input.description), heading: text(input.heading), lead: text(input.lead),
    intent: text(input.intent) || 'unknown',
    region: city ? { cityId: city.code, slug: city.slug, cityName: city.locality, fullName: city.fullName, prefectureName: city.prefectureName, prefectureSlug: city.prefectureSlug, kind: 'city' } : null,
    sections: list(input.sections).map(section => ({ heading: text(section?.heading), paragraphs: strings(section?.paragraphs), steps: strings(section?.steps) })),
    example: { label: '作例', title: text(input.example?.title), body: text(input.example?.body) },
    sources: list(input.sources).map(source => ({ title: text(source?.title), url: text(source?.url), checkedAt: text(source?.checkedAt), geographicScope: text(source?.geographicScope) })),
    relatedCitySlugs: [...new Set(strings(input.relatedCitySlugs))],
    review: review ? { reviewedBy: text(review.reviewedBy), reviewedAt: text(review.reviewedAt) } : null,
    scheduledAt: text(options.scheduledAt), publishedAt: text(options.publishedAt),
    updatedAt: new Date(options.now || Date.now()).toISOString(),
  };
}

/** Structural checks aid an editor; they are not a Google ranking or penalty score. */
export function qualityIssues(document, { now = Date.now(), requireReview = false } = {}) {
  const issues = [];
  if (!EDITORIAL_TYPES.includes(document?.type)) issues.push(issue('type', 'ページの種類を選んでください。', 'type'));
  if (!publicPath(document)) issues.push(issue('path', document?.type === 'city' ? '市区町村・行政区の一覧から対象地域を選んでください。' : 'URLには半角英数字とハイフンを使用してください。予約済みの名前は使えません。', 'slug'));
  if (document?.intent !== 'employer') issues.push(issue('intent', '企業の採用担当者向けの検索意図を確認してください。', 'intent'));
  const limits = { title: 160, description: 500, heading: 160, lead: 3000 };
  for (const [field, max] of Object.entries(limits)) {
    if (!text(document?.[field])) issues.push(issue(`required_${field}`, `${({ title: 'タイトル', description: '検索結果の説明', heading: '主見出し', lead: '導入文' })[field]}を入力してください。`, field));
    else if (document[field].length > max) issues.push(issue(`length_${field}`, `${field}が長すぎます（最大${max}文字）。`, field));
  }
  const city = document?.type === 'city' ? resolveCity(document.slug) : null;
  if (city && (!text(document.title).includes(city.locality) || !text(document.heading).includes(city.locality))) issues.push(issue('city_context', 'タイトルと主見出しに対象の地域名を含めてください。', 'heading'));
  const sections = list(document?.sections);
  if (sections.length < 3 || sections.length > 20) issues.push(issue('sections', '課題・具体策・実施手順など、3〜20の節を用意してください。', 'sections'));
  const seen = new Set();
  sections.forEach((section, index) => {
    const body = [...strings(section?.paragraphs), ...strings(section?.steps)];
    const field = `sections.${index}`;
    if (!text(section?.heading) || !body.length) issues.push(issue('section_content', `${index + 1}番目の節に見出しと本文または手順が必要です。`, field));
    if (text(section?.heading).length > 200 || body.length > 30 || body.some(part => part.length > 10000)) issues.push(issue('section_length', `${index + 1}番目の節が長すぎます。節を分けてください。`, field));
    const fingerprint = body.join('\n').replace(/\s/g, '');
    if (fingerprint && seen.has(fingerprint)) issues.push(issue('duplicate_section', '同じ本文の節が重複しています。', field));
    seen.add(fingerprint);
  });
  if (!text(document?.example?.title) || !text(document?.example?.body)) issues.push(issue('example', '読者が使える配信文・運用手順の作例を入力してください。', 'example'));
  if (text(document?.example?.body).length > 10000) issues.push(issue('example_length', '作例は10,000文字以内にしてください。', 'example.body'));
  const sources = list(document?.sources);
  if (!sources.length || sources.length > 30) issues.push(issue('sources', '内容を確認した根拠資料を1〜30件登録してください。', 'sources'));
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(now));
  sources.forEach((source, index) => {
    const field = `sources.${index}`;
    if (!text(source?.title) || !isSafeSourceUrl(source?.url)) issues.push(issue('source_url', `${index + 1}番目の出典に資料名と公開HTTPS URLが必要です。`, field));
    if (!validDate(source?.checkedAt || '') || source.checkedAt > today) issues.push(issue('source_date', `${index + 1}番目の出典の確認日を正しく入力してください。未来日は使えません。`, field));
    else if (new Date(`${source.checkedAt}T00:00:00Z`).valueOf() < new Date(now).valueOf() - 366 * 86400000) issues.push(issue('source_age', '確認から1年以上経過した資料があります。内容の更新を確認してください。', field, 'warning'));
    if (!text(source?.geographicScope)) issues.push(issue('source_scope', `${index + 1}番目の資料が扱う範囲（市・県・全国など）を明記してください。`, field));
  });
  for (const slug of list(document?.relatedCitySlugs)) if (!resolveCity(slug)) issues.push(issue('related_city', '関連記事の地域リンクは有効な市区町村を選んでください。', 'relatedCitySlugs'));
  if (list(document?.relatedCitySlugs).length > 3) issues.push(issue('related_city_limit', '記事から紹介する地域は内容に関係する3地域までにしてください。', 'relatedCitySlugs'));
  if (requireReview && (!text(document?.review?.reviewedBy) || !Number.isFinite(Date.parse(document?.review?.reviewedAt)))) issues.push(issue('review', 'ログインした担当者の確認・承認が必要です。', 'review'));
  return issues;
}
export function validateDocument(input, options = {}) {
  const document = normalizeDocument(input, options);
  const structural = qualityIssues(document, { ...options, requireReview: Boolean(options.forPublication) });
  const issues = options.forPublication ? structural : structural.filter(item => ['type', 'path'].includes(item.code));
  return { valid: !issues.some(item => item.severity === 'error'), document, issues };
}
