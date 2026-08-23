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
    // ===== SEO記事ツール（メディア記事つくる君）用の管理項目。全てoptionalで既存記事に影響しない =====
    /** この記事が狙う検索キーワード（1記事1KWの記録） */
    target_keyword: z.string().optional(),
    /** KWの層: 指名 / 収益 / 集客 */
    keyword_layer: z.enum(['指名', '収益', '集客']).optional(),
    /** ピラー記事（まとめ記事）か */
    pillar: z.boolean().default(false),
    /** 所属するピラー記事のslug（クラスター記事のみ指定） */
    cluster_of: z.string().optional(),
    /** 執筆・監修者表記（E-E-A-T） */
    supervisor: z.string().optional(),
    /** リライト日（更新日として表示・dateModifiedに使用） */
    updated: z.coerce.date().optional(),
    /** よくある質問（FAQPage構造化データとして出力） */
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
});

// 支援実績のコレクション定義。1実績 = src/content/cases/ 配下の 1つの .md ファイル。
const cases = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cases' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    industry: z.string(),
    date: z.coerce.date(),
    problem: z.string(),
    action: z.string(),
    metric_label: z.string(),
    before: z.string(),
    after: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, cases };
