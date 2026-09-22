import service from '../src/data/service-ltori.json' with { type: 'json' };
import { ARTICLE_TEMPLATE_PATH, publicPath, publicSource, resolveCity, qualityIssues, isSafeSourceUrl } from '../src/lib/seo-manager/editorial-model.mjs';

export { ARTICLE_TEMPLATE_PATH };
export const PUBLIC_ORIGIN = 'https://layr.co.jp';
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
const paragraphs = values => (Array.isArray(values) ? values : []).map(value => `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`).join('');
const safeDate = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const published = document => document?.status === 'published' && publicPath(document) && safeDate(document.publishedAt);
const canonical = document => `${PUBLIC_ORIGIN}${publicPath(document)}`;

export function renderEditorialBody(document, { publishedCitySlugs = [] } = {}) {
  const city = document.type === 'city' ? resolveCity(document.slug) : null;
  const sections = (document.sections || []).map((section, index) => `<section aria-labelledby="editorial-section-${index + 1}"><h${city ? '3' : '2'} id="editorial-section-${index + 1}">${escapeHtml(section.heading)}</h${city ? '3' : '2'}>${paragraphs(section.paragraphs)}${section.steps?.length ? `<ol>${section.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}</section>`).join('');
  const example = `<section aria-labelledby="editorial-example"><h${city ? '3' : '2'} id="editorial-example">${escapeHtml(document.example?.title || '配信・運用の作例')}</h${city ? '3' : '2'}><p><strong>作例</strong> — 実際の導入実績を示すものではありません。</p>${paragraphs([document.example?.body || ''])}</section>`;
  const sources = `<section aria-labelledby="editorial-sources"><h${city ? '3' : '2'} id="editorial-sources">参考資料と確認日</h${city ? '3' : '2'}><ul>${(document.sources || []).map(source => `<li>${isSafeSourceUrl(source.url) ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}<span>（対象：${escapeHtml(source.geographicScope)} ／ 確認：${escapeHtml(source.checkedAt)}）</span></li>`).join('')}</ul><p>企画・編集：株式会社LAYR。募集条件や利用するツールに合わせて運用を調整します。</p></section>`;
  // Only contextually selected, already published cities may appear. City LPs have no national directory links.
  const allowed = new Set(publishedCitySlugs);
  const related = document.type === 'article' ? (document.relatedCitySlugs || []).filter(slug => allowed.has(slug)).map(resolveCity).filter(Boolean) : [];
  const cityLinks = related.length ? `<aside><h2>地域の採用LINE活用</h2><ul>${related.map(area => `<li><a href="/service/ltori/area/${escapeHtml(area.slug)}/">${escapeHtml(area.fullName)}の採用LINE構築・運用支援</a></li>`).join('')}</ul></aside>` : '';
  const body = `${sections}${example}${sources}${cityLinks}`;
  return city ? `<section class="lt-section lt-local-guide lt-runtime-editorial" id="local-guide" aria-labelledby="local-guide-title"><div class="lt-wrap"><div class="lt-section-heading"><p class="lt-eyebrow">Local Recruitment</p><h2 id="local-guide-title">${escapeHtml(city.fullName)}での採用LINE活用</h2><p>${escapeHtml(document.lead)}</p></div><div class="lt-local-prose">${body}</div><p class="lt-note">オンラインでの支援です。この地域の事業所や導入実績を示すものではありません。</p></div></section>` : body;
}

export function renderCityHeading(document) {
  const city = resolveCity(document.slug);
  if (!city) return escapeHtml(document.heading);
  const heading = document.heading || `${city.fullName}の採用LINE構築・運用支援`;
  const cityEnd = heading.indexOf(city.locality) + city.locality.length;
  const prefixEnd = cityEnd > 0 && /[ので]/.test(heading[cityEnd] || '') ? cityEnd + 1 : cityEnd;
  const prefix = heading.slice(0, prefixEnd);
  const remainder = escapeHtml(heading.slice(prefixEnd)).replace('採用LINE', '<span>採用LINE</span>').replace('構築・運用支援', '<br><mark>構築・運用支援</mark>');
  return `<span class="lt-area-name">${escapeHtml(prefix)}</span><span class="lt-area-service">${remainder}</span>`;
}

export function documentStructuredData(document) {
  const city = document.type === 'city' ? resolveCity(document.slug) : null;
  const common = { '@context': 'https://schema.org', name: document.title, description: document.description, url: canonical(document) };
  return city ? { ...common, '@type': 'Service', serviceType: service.descriptor, provider: { '@id': `${PUBLIC_ORIGIN}/#organization` }, areaServed: { '@type': 'AdministrativeArea', name: city.fullName } } : { ...common, '@type': 'BlogPosting', headline: document.title, datePublished: safeDate(document.publishedAt), dateModified: safeDate(document.updatedAt), author: { '@type': 'Organization', name: '株式会社LAYR', url: `${PUBLIC_ORIGIN}/` }, mainEntityOfPage: canonical(document) };
}

/** Transform trusted existing assets; user fields are always text or escaped, never raw HTML. */
export async function renderDocument(baseResponse, document, options = {}) {
  const preview = Boolean(options.preview);
  if (!publicPath(document) || (!preview && !published(document))) return new Response('Not found', { status: 404 });
  if (!preview && qualityIssues(document, { requireReview: true }).some(item => item.severity === 'error')) return new Response('Publication unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  if (!baseResponse?.ok) return new Response('Template unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  const html = await baseResponse.text();
  if (!html.includes('data-seo-editorial-slot')) return new Response('Template unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  const Rewriter = options.HTMLRewriter || globalThis.HTMLRewriter;
  if (!Rewriter) throw new Error('Cloudflare HTMLRewriter is required');
  const city = document.type === 'city' ? resolveCity(document.slug) : null;
  const title = document.title || '採用LINE活用ガイド';
  const pageUrl = canonical(document);
  const source = publicSource(document);
  const structured = JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'Organization', '@id': `${PUBLIC_ORIGIN}/#organization`, name: '株式会社LAYR', url: `${PUBLIC_ORIGIN}/` },
    documentStructuredData(document),
  ]).replace(/</g, '\\u003c');
  const setText = value => ({ element(element) { element.setInnerContent(value); } });
  const setContent = value => ({ element(element) { element.setAttribute('content', value); } });
  let rewriter = new Rewriter()
    .on('title', setText(title))
    .on('meta[name="description"]', setContent(document.description || ''))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(document.description || ''))
    .on('meta[name="twitter:description"]', setContent(document.description || ''))
    .on('meta[property="og:url"]', setContent(pageUrl))
    .on('meta[property="og:type"]', setContent(city ? 'website' : 'article'))
    .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', pageUrl); } })
    .on('meta[name="robots"]', { element(element) { element.remove(); } })
    .on('script[type="application/ld+json"]', { element(element) { element.remove(); } })
    .on('head', { element(element) { element.append(`<meta name="robots" content="${preview ? 'noindex, nofollow' : 'index, follow'}"><script type="application/ld+json">${structured}</script>`, { html: true }); } })
    .on('[data-seo-title]', setText(document.heading || title))
    .on('[data-seo-lead]', setText(document.lead || ''))
    .on('[data-seo-editorial-slot]', { element(element) { element.setInnerContent(renderEditorialBody(document, options), { html: true }); } })
    .on('[data-lt-source]', { element(element) { element.setAttribute('data-lt-source', source); if (city) element.setAttribute('class', `${element.getAttribute('class') || ''} lt-regional`); } })
    .on('[data-lm-source]', { element(element) { element.setAttribute('data-lm-source', source); } })
    .on('[data-seo-published-at]', { element(element) { const date = safeDate(document.publishedAt); element.setAttribute('datetime', date || ''); element.setInnerContent(date ? date.slice(0, 10) : '公開前'); } })
    .on('a[href]', { element(element) {
      const href = element.getAttribute('href');
      if (!href) return;
      let url;
      try { url = new URL(href, PUBLIC_ORIGIN); } catch { return; }
      if (url.origin !== PUBLIC_ORIGIN) return;
      if (city && url.pathname === '/service/ltori/area/') { element.remove(); return; }
      if ((url.pathname === '/contact/' && url.searchParams.get('service') === 'ltori') || url.pathname === '/document/ltori-service/' || url.pathname === '/service/ltori/diagnosis/') {
        url.searchParams.set('source', source);
        element.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
      }
    } });
  if (city) rewriter = rewriter
    .on('#lt-hero-title', { element(element) { element.setInnerContent(renderCityHeading(document), { html: true }); } })
    .on('.lt-hero-kicker', setText(`採用 × LINE　${city.fullName}の企業さまへ`))
    .on('.lt-hero-description', setText(`${city.fullName}の採用活動を、オンラインでサポート。構築・配信・改善まで、採用LINEは${service.name}に。`))
    .on('.lt-hero-actions small', setText(`${city.locality}での採用のお悩みに`));
  const headers = new Headers(baseResponse.headers);
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified', 'location']) headers.delete(name);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', preview ? 'private, no-store' : 'public, max-age=0, must-revalidate');
  headers.set('x-content-type-options', 'nosniff');
  if (preview) {
    headers.set('x-robots-tag', 'noindex, nofollow');
    // A saved draft must not run arbitrary markup even in authenticated previews.
    headers.set('referrer-policy', 'same-origin');
  } else headers.delete('x-robots-tag');
  return rewriter.transform(new Response(html, { status: 200, headers }));
}

export function renderPublishedCards(documents) {
  return documents.filter(published).filter(document => document.type === 'article').map(document => `<article class="lm-card"><div class="lm-card-content"><p class="lm-kicker">採用LINEの実践ガイド</p><h3><a href="${escapeHtml(publicPath(document))}">${escapeHtml(document.title)}</a></h3><p class="lm-card-description">${escapeHtml(document.description)}</p><p class="lm-card-date"><time datetime="${escapeHtml(safeDate(document.publishedAt))}">${escapeHtml(document.publishedAt.slice(0, 10))}</time></p></div></article>`).join('');
}
export function renderPublishedCityLinks(documents) {
  return documents.filter(published).filter(document => document.type === 'city').map(document => `<li><a href="${escapeHtml(publicPath(document))}">${escapeHtml(resolveCity(document.slug)?.fullName)}の採用LINE構築・運用支援</a></li>`).join('');
}
export function renderPublicationSitemap(documents) {
  const seen = new Set();
  const urls = documents.filter(published).filter(document => {
    const path = publicPath(document);
    if (seen.has(path)) return false;
    seen.add(path); return true;
  }).map(document => `<url><loc>${escapeHtml(canonical(document))}</loc><lastmod>${escapeHtml(safeDate(document.updatedAt) || safeDate(document.publishedAt))}</lastmod></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
