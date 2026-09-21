import { getCollection } from 'astro:content';
import { isPublished } from './ltori-media.mjs';
import { areaKey } from './ltori-seo.mjs';
import { publishedAreas } from './ltori-publication.mjs';

// Only published article IDs can reach form email fields and analytics.
export async function leadSourceLabels() {
  const posts = await getCollection('recruitment', isPublished);
  return {
    area: '都道府県・市別の採用LINE',
    ...Object.fromEntries(publishedAreas.map(area => [areaKey(area), `${area.fullName}の採用LINE`])),
    media: 'エルトリ採用メディアの記事一覧',
    diagnosis: 'エルトリの採用LINE活用診断',
    ...Object.fromEntries(posts.map(post => [`media/${post.id}`, post.data.title])),
  };
}
