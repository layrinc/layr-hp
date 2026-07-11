// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// サイトの本番URL。独自ドメインを設定したらここを差し替える。
// sitemap / canonical / OGP はこの値を基準に自動生成される。
export default defineConfig({
  site: 'https://layr.co.jp',
  integrations: [
    sitemap({
      // 管理系・完了ページは検索エンジンに載せない
      filter: (page) =>
        !page.includes('/dashboard') && !page.includes('/admin') && !page.includes('/document/thanks'),
    }),
  ],
});
