export const WORKSPACE_ORIGIN = 'https://layr.co.jp';
export const WORKSPACE_PROJECTS = Object.freeze([
  {id: 'regional', name: 'エルトリ全国SEO', shortName: '全国SEO', href: '/regional/', prefix: '/service/ltori/area/', publicUrl: 'https://layr.co.jp/service/ltori/', description: '地域の採用事情を調べ、市町村のページと検索実績を管理します。'},
  {id: 'media', name: 'エルトリ採用ノート', shortName: '採用ノート', href: '/media/', prefix: '/service/ltori/media/', publicUrl: 'https://layr.co.jp/service/ltori/media/', description: '採用担当者の課題に答える記事の企画・需要・成果を管理します。'},
  {id: 'corporate', name: 'LAYR公式メディア', shortName: '公式メディア', href: '/articles/', prefix: '/media/', publicUrl: 'https://layr.co.jp/media/', description: '公式サイトのコラムと、記事ごとの検索・アクセス実績を管理します。'},
]);

export function canonicalWorkspacePath(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.trim() || value.includes('\\')) return null;
  try {
    const url = new URL(value, WORKSPACE_ORIGIN);
    if (url.origin !== WORKSPACE_ORIGIN || url.username || url.password || /%2f|%5c/i.test(url.pathname)) return null;
    return `${url.pathname.replace(/\/+$/, '')}/`;
  } catch { return null; }
}

export function workspaceProjectForPath(value) {
  const path = canonicalWorkspacePath(value);
  return path ? WORKSPACE_PROJECTS.find(project => path.startsWith(project.prefix))?.id ?? null : null;
}
