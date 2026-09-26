// "05 公開URL記事": every published regional LP, grouped by prefecture in catalog order
// (Hokkaido → Okinawa). Pure functions so the grouping can be tested without a DOM.

export const PUBLIC_ORIGIN = 'https://layr.co.jp';

export function publishedGroups(catalog, {prefecture = '', search = ''} = {}) {
  const query = search.normalize('NFKC').toLowerCase().trim();
  const groups = new Map();
  for (const page of catalog) {
    if (page.publication !== 'published') continue;
    if (prefecture && page.prefecture !== prefecture) continue;
    const url = `${PUBLIC_ORIGIN}${page.path}`;
    if (query && !`${page.fullName} ${page.title || ''} ${url}`.normalize('NFKC').toLowerCase().includes(query)) continue;
    const key = page.prefecture || page.id;
    if (!groups.has(key)) groups.set(key, {prefecture: key, name: page.prefectureName || page.name, pages: []});
    groups.get(key).pages.push({...page, url});
  }
  // Prefecture LP first, then cities in catalog order.
  for (const group of groups.values()) group.pages.sort((a, b) => (a.kind === 'prefecture' ? -1 : 0) - (b.kind === 'prefecture' ? -1 : 0));
  return [...groups.values()];
}

export function publishedSummary(groups) {
  const pages = groups.flatMap(group => group.pages);
  const dates = pages.map(page => page.publishedAt).filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort();
  return {count: pages.length, prefectures: groups.length, latest: dates.at(-1) || ''};
}

export function publishedRows(groups) {
  return [['No', '都道府県', '地域', '区分', '記事タイトル', '公開URL', '公開日時'], ...groups.flatMap(group => group.pages).map((page, index) => [index + 1, page.prefectureName || page.name, page.fullName, page.kind === 'prefecture' ? '都道府県LP' : '市区町村LP', page.title || '', page.url, page.publishedAt || ''])];
}
