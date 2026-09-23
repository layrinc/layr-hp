import service from '../src/data/service-ltori.json' with {type: 'json'};
import company from '../src/data/company.json' with {type: 'json'};
import {industries, localCoverageFor, regionalFaqsFor, townSource} from '../src/lib/ltori-local-content.mjs';
import {areaKey, areaPath, consultationHref} from '../src/lib/ltori-seo.mjs';
import {publicationFor} from '../src/lib/ltori-publication.mjs';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]);
}

// Match RegionalContent.astro / AreaLinks.astro without introducing another
// visual template. Content and business facts come from their existing data.
export function renderRegionalIndustries(area) {
  const consult = escapeHtml(consultationHref(areaKey(area)));
  return `<section class="lt-section lt-local-industries" id="local-industries" aria-labelledby="local-industries-title">
  <div class="lt-wrap">
    <div class="lt-section-heading">
      <p class="lt-eyebrow">Industries</p>
      <h2 id="local-industries-title">${escapeHtml(area.name)}のさまざまな業種に。<br><mark>採用LINEの活用例</mark></h2>
      <p>募集する仕事や採用課題に合わせて、配信内容と応募までの流れを設計します。</p>
    </div>
    <nav class="lt-local-industry-nav" aria-label="業種別の採用LINE活用例へ">${industries.flatMap(industry => industry.examples.map(example => `<a href="#local-industry-${escapeHtml(industry.id)}">${escapeHtml(example)}</a>`)).join('')}</nav>
    <div class="lt-local-industry-grid">${industries.map(industry => `<article class="lt-local-industry" id="local-industry-${escapeHtml(industry.id)}">
      <h3>${escapeHtml(industry.name)}</h3><p class="lt-local-roles">${escapeHtml(industry.roles)}</p><p class="lt-local-question">${escapeHtml(industry.question)}</p><p>${escapeHtml(industry.answer)}</p>
      <p class="lt-local-menu-label">リッチメニューの構成例</p><ul class="lt-local-menu">${industry.menu.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </article>`).join('')}</div>
    <p class="lt-note">業種別の活用提案であり、掲載業種での導入実績を示すものではありません。具体的な機能・対応範囲はご相談時に確認します。</p>
    <p class="lt-local-action"><a class="lt-button" href="${consult}" data-lt-cta="local-industries">自社の業種での活用を相談する<span class="lt-button-arrow" aria-hidden="true">↗</span></a></p>
  </div></section>`;
}

export function renderRegionalCoverage(area) {
  const coverage = localCoverageFor(area);
  const children = coverage.children.filter(child => publicationFor(child) === 'published');
  const body = children.length
    ? `<h3>${escapeHtml(area.name)}の${coverage.kind === 'wards' ? '区別' : '市別'}の対応ページ</h3><nav aria-label="${escapeHtml(area.name)}の地域別ページ"><ul class="lt-area-list">${children.map(child => `<li><a href="${escapeHtml(areaPath(child))}">${escapeHtml(child.name)}</a></li>`).join('')}</ul></nav>`
    : coverage.labels.length
      ? `<h3>${escapeHtml(area.name)}の対応エリア例</h3><ul class="lt-local-town-list">${coverage.labels.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`
      : '<p>町域名の記載がない場合も、勤務地と募集内容をお知らせください。ご希望の運用方法をオンラインで伺います。</p>';
  return `<section class="lt-section lt-area-links" id="area" aria-labelledby="local-area-title"><div class="lt-wrap">
    <div class="lt-section-heading"><p class="lt-eyebrow">Service Area</p><h2 id="local-area-title">${escapeHtml(area.fullName)}全域で<br><mark>採用LINEの構築・運用を支援</mark></h2><p>事業所や店舗の所在地に合わせて、採用の導線を設計します。ご相談から構築・配信・運用改善まで、オンラインで対応します。</p></div>
    ${body}<p class="lt-local-coverage-note">掲載している地域以外も、${escapeHtml(area.fullName)}での採用をご相談いただけます。現地での撮影・訪問が必要な場合は、対応可否と費用を個別に確認します。</p>
    ${coverage.kind === 'towns' ? `<p class="lt-note">町域表記の出典：<a class="lt-local-source" href="${escapeHtml(townSource.sourceUrl)}" target="_blank" rel="noopener">日本郵便「住所の郵便番号」</a>（${escapeHtml(townSource.sourceUpdatedAt)}更新）。町域表記の一部を例示しています。</p>` : ''}
  </div></section>`;
}

export function renderRegionalProvider(area) {
  return `<section class="lt-section lt-local-provider" id="local-provider" aria-labelledby="local-provider-title"><div class="lt-wrap lt-local-provider-grid"><div>
    <p class="lt-eyebrow">${escapeHtml(service.name)} by LAYR</p><h2 id="local-provider-title">${escapeHtml(area.fullName)}の<br>採用LINE構築・運用は<br><mark>${escapeHtml(service.name)}へ。</mark></h2>
    <div class="lt-local-prose"><p>${escapeHtml(service.name)}は、${escapeHtml(company.name)}が運営する${escapeHtml(service.descriptor)}サービスです。${escapeHtml(area.name)}で人材採用に取り組む企業さまへ、LINE公式アカウント・Lステップを使った候補者とのコミュニケーションを設計します。</p>
      <p>初期構築から、配信する文章・画像の制作、運用改善まで。応募を急がせるだけでなく、企業への理解を深めながら、面談・選考・入社前フォローへつながる採用の仕組みを整えます。</p>
      <p>ご相談・打ち合わせはオンラインで対応します。募集職種、勤務地、現在の採用方法をお聞かせください。</p></div>
    <p class="lt-local-action"><a class="lt-button" href="${escapeHtml(consultationHref(areaKey(area)))}" data-lt-cta="local-provider">採用LINEについて無料相談<span class="lt-button-arrow" aria-hidden="true">↗</span></a></p>
  </div><img src="/service/ltori/isometric-strategy.webp" width="1536" height="1024" loading="lazy" decoding="async" alt="採用担当者と支援チームが、LINEを使った採用の進め方を相談するイラスト"></div></section>`;
}

export const regionalLandingFaqs = area => [...regionalFaqsFor(area), ...service.faqs];
export function renderRegionalFaqList(faqs) {
  return faqs.map(faq => `<details><summary><span class="lt-q">Q.</span><span>${escapeHtml(faq.q)}</span><span class="lt-faq-toggle" aria-hidden="true">+</span></summary><div class="lt-answer"><span>A.</span><p>${escapeHtml(faq.a)}</p></div></details>`).join('');
}

export function regionalFaqStructuredData(faqs) {
  return {'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(faq => ({'@type': 'Question', name: faq.q, acceptedAnswer: {'@type': 'Answer', text: faq.a}}))};
}
