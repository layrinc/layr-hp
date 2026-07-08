// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// サイトの本番URL。独自ドメインを設定したらここを差し替える。
// sitemap / canonical / OGP はこの値を基準に自動生成される。
export default defineConfig({
  site: 'https://layr-hp.vercel.app',
  integrations: [sitemap()],
});
