import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// コラム記事のコレクション定義。
// 1記事 = src/content/blog/ 配下の 1つの .md ファイル。
// 管理画面(Sveltia CMS)はこのスキーマに沿ってフォームを表示する。
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    category: z.string(),
    draft: z.boolean().default(false),
    /** SNSシェア用画像（任意）。管理画面からアップロードできる */
    image: z.string().optional(),
  }),
});

export const collections = { blog };
