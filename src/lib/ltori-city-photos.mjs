import seeds from '../data/ltori-city-photos.json' with {type: 'json'};
import {areasBySlug} from './ltori-seo.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
const plain = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
const cityFor = slug => typeof slug === 'string' && areasBySlug.get(slug)?.locality?.endsWith('市') ? areasBySlug.get(slug) : null;
function safeUrl(value, host, prefix) {
  if (!plain(value, 2048) || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    const hosts = Array.isArray(host) ? host : [host];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || !value.startsWith(`https://${url.hostname}/`) || url.username || url.password || url.port || url.search || url.hash || !decodeURIComponent(url.pathname).startsWith(prefix)) return null;
    return url.href;
  } catch {return null;}
}
function licenseFor(label, source) {
  const license = plain(label, 32);
  const url = safeUrl(source, 'creativecommons.org', '/');
  if (!license || !url) return null;
  const paths = {'CC0': '/publicdomain/zero/1.0/', 'PD': '/publicdomain/mark/1.0/'};
  const cc = /^(CC BY(?:-SA)?) (1\.0|2\.0|2\.5|3\.0|4\.0)$/.exec(license);
  const path = paths[license] || (cc ? `/licenses/${cc[1] === 'CC BY-SA' ? 'by-sa' : 'by'}/${cc[2]}/` : null);
  if (!path || new URL(url).pathname.replace(/\/$/, '') !== path.replace(/\/$/, '')) return null;
  return {license, licenseUrl: `https://creativecommons.org${path}`};
}

/** The collector and public renderer share the same single-photo allowlist. */
export function normalizeCityPhoto(photo) {
    if (!photo || typeof photo !== 'object') return null;
    const id = plain(Number.isSafeInteger(photo.id) && photo.id > 0 ? String(photo.id) : photo.id, 300);
    const title = plain(photo.title, 300), alt = plain(photo.alt, 500), author = plain(photo.author, 500);
    const caption = photo.caption === undefined ? undefined : plain(photo.caption, 100);
    const url = safeUrl(photo.url, ['upload.wikimedia.org', 'thumb.wikimedia.org'], '/wikipedia/commons/');
    const sourceUrl = safeUrl(photo.sourceUrl, 'commons.wikimedia.org', '/wiki/File:');
    const license = licenseFor(photo.license, photo.licenseUrl);
    const dimensions = [photo.width, photo.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 100000);
    if (!id || !title || !alt || !author || !url || !sourceUrl || !license || !dimensions || (photo.caption !== undefined && !caption)) return null;
    return {id, title, ...(caption ? {caption} : {}), alt, url, sourceUrl, author, ...license, width: photo.width, height: photo.height};
}

/** Stored/provider data is untrusted; only reviewed city-bound Commons photos reach markup. */
export function normalizeCityPhotos(citySlug, record) {
  if (!cityFor(citySlug) || !record || record.schemaVersion !== 1 || record.citySlug !== citySlug || record.status !== 'ready' || !Array.isArray(record.photos)) return null;
  if (typeof record.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.fetchedAt)) return null;
  const fetchedMs = Date.parse(record.fetchedAt);
  if (!Number.isFinite(fetchedMs)) return null;
  const ids = new Set(), urls = new Set(), photos = [];
  for (const candidate of record.photos.slice(0, 24)) {
    const photo = normalizeCityPhoto(candidate);
    if (!photo || ids.has(photo.id) || urls.has(photo.url)) continue;
    ids.add(photo.id); urls.add(photo.url);
    photos.push(photo);
    if (photos.length === 4) break;
  }
  return photos.length >= 3 ? {schemaVersion: 1, citySlug, status: 'ready', fetchedAt: new Date(fetchedMs).toISOString(), photos} : null;
}

export function getSeedCityPhotos(citySlug) {
  return normalizeCityPhotos(citySlug, Object.hasOwn(seeds, citySlug) ? seeds[citySlug] : null);
}

/** Shared by Astro static city pages and the Worker city template. */
export function renderCityPhotos(area, record) {
  const city = cityFor(area?.slug), data = normalizeCityPhotos(city?.slug, record);
  if (!data) return '';
  const prefix = `city-photos-${city.slug.replaceAll('/', '-')}`;
  return `<section class="lt-city-photos" data-city-photos aria-labelledby="${prefix}-title">
    <div class="lt-wrap lt-city-photos-head"><div><p class="lt-city-photos-city" id="${prefix}-title">${escape(city.fullName)}</p></div><div class="lt-city-photos-controls" data-city-photo-controls hidden><button type="button" data-city-photo-prev aria-label="前の写真を見る" aria-controls="${prefix}-viewport">←</button><button type="button" data-city-photo-next aria-label="次の写真を見る" aria-controls="${prefix}-viewport">→</button><button type="button" data-city-photo-pause aria-pressed="false" aria-controls="${prefix}-viewport">自動送りを止める</button></div></div>
    <div class="lt-city-photos-viewport" id="${prefix}-viewport" data-city-photo-viewport tabindex="0" role="region" aria-label="${escape(city.locality)}の風景写真。左右にスクロールできます"><ul class="lt-city-photos-track">${data.photos.map(photo => `<li class="lt-city-photo"><figure><img src="${escape(photo.url)}" width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>${escape((photo.caption || photo.title).replace(/\s*[（(]\s*[0-9０-９]{4}\s*年?\s*[）)]\s*$/u, ''))}</figcaption></figure></li>`).join('')}</ul></div>
    <div class="lt-wrap"><details class="lt-city-photo-credits"><summary>写真クレジット</summary><ul>${data.photos.map(photo => `<li><a href="${escape(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.title)}</a> — ${escape(photo.author)} / <a href="${escape(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(photo.license)}</a></li>`).join('')}</ul><p>写真は表示枠に合わせてトリミングしています。</p></details></div>
  </section>`;
}
