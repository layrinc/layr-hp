export const CORPORATE_STATUS = {unreviewed: '未確認', research: '調査中', rewrite: '改善中', review: '確認待ち', done: '対応済み'};
export const CORPORATE_PRIORITY = {high: '高', normal: '通常', low: '低'};
export function corporateEdit(state, article) {
  return state?.edits?.[article.path] ?? {priority: 'normal', status: 'unreviewed', keyword: article.keyword || '', evidence: '', notes: ''};
}
export function filterCorporateArticles(catalog, state, metricRows, {search = '', status = '', category = '', sort = 'priority'} = {}) {
  const query = search.normalize('NFKC').toLowerCase().trim();
  const metrics = new Map(metricRows.map(row => [row.path, row.metrics || {}]));
  const rows = catalog.map(article => ({...article, edit: corporateEdit(state, article), metrics: metrics.get(article.path) || {}})).filter(article => {
    const text = `${article.title} ${article.keyword} ${article.edit.keyword} ${article.category}`.normalize('NFKC').toLowerCase();
    return (!query || text.includes(query)) && (!status || article.edit.status === status) && (!category || article.category === category);
  });
  const weight = {high: 0, normal: 1, low: 2};
  return rows.sort((a, b) => {
    if (sort === 'views' || sort === 'clicks') {
      const left = a.metrics[sort], right = b.metrics[sort];
      const validA = typeof left === 'number' && Number.isFinite(left), validB = typeof right === 'number' && Number.isFinite(right);
      if (validA !== validB) return validA ? -1 : 1;
      if (validA && left !== right) return right - left;
    } else if (sort === 'priority' && weight[a.edit.priority] !== weight[b.edit.priority]) return weight[a.edit.priority] - weight[b.edit.priority];
    return b.publishedAt.localeCompare(a.publishedAt) || a.path.localeCompare(b.path);
  });
}
export function validateCorporateState(input, catalog) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0 || !input.edits || typeof input.edits !== 'object' || Array.isArray(input.edits)) throw new Error('改善メモの保存データを確認できません。');
  const paths = new Set(catalog.map(article => article.path));
  for (const [path, edit] of Object.entries(input.edits)) {
    if (!paths.has(path) || !edit || !Object.hasOwn(CORPORATE_STATUS, edit.status) || !Object.hasOwn(CORPORATE_PRIORITY, edit.priority)) throw new Error('記事の改善状況を確認できません。');
    for (const [key, limit] of [['keyword', 200], ['evidence', 2000], ['notes', 4000]]) if (typeof edit[key] !== 'string' || edit[key].length > limit) throw new Error('記事の改善メモの形式が正しくありません。');
  }
  return input;
}
