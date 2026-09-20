export const mediaPath = '/service/ltori/media/';
export const articlePath = id => `${mediaPath}${id}/`;
export const topics = ['採用導線', '応募後フォロー', '外注・比較'];
export const isPublished = ({ data }, now = new Date()) => !data.draft && data.date <= now;
