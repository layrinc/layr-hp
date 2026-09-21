import { getCollection } from 'astro:content';
import { isPublished } from './ltori-media.mjs';
import { sourceLabels } from './ltori-seo.mjs';

// Only published article IDs can reach form email fields and analytics.
export async function leadSourceLabels() {
  const posts = await getCollection('recruitment', isPublished);
  return {
    ...sourceLabels,
    media: 'エルトリ採用メディアの記事一覧',
    ...Object.fromEntries(posts.map(post => [`media/${post.id}`, post.data.title])),
  };
}
