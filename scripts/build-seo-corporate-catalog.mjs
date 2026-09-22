import {readFile, readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative} from 'node:path';
import {parseFrontmatter} from '@astrojs/markdown-remark';

export async function buildCorporateCatalog(directory) {
  const rows = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, {withFileTypes: true})) {
      const filename = resolve(folder, entry.name);
      if (entry.isDirectory()) { await walk(filename); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const {frontmatter: data} = parseFrontmatter(await readFile(filename, 'utf8'));
      if (data.draft === true) continue;
      const slug = relative(directory, filename).replace(/\.md$/, '').replaceAll('\\', '/');
      if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(slug) || typeof data.title !== 'string' || !data.title.trim() || !Number.isFinite(Date.parse(data.date))) throw new Error(`コラムの管理情報を確認してください: ${slug}`);
      rows.push({path: `/media/${slug}/`, title: data.title, type: 'article', publishedAt: new Date(data.date).toISOString(), updatedAt: data.updated ? new Date(data.updated).toISOString() : null, keyword: typeof data.target_keyword === 'string' ? data.target_keyword : '', category: typeof data.category === 'string' ? data.category : ''});
    }
  }
  await walk(directory);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../src/content/blog/', import.meta.url));
  const rows = await buildCorporateCatalog(directory);
  await writeFile(new URL('../src/data/seo-corporate-catalog.json', import.meta.url), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`公式メディアの管理一覧を更新: ${rows.length}記事`);
}
