import townMaster from '../data/ltori-town-areas.json' with {type:'json'};
import industries from '../data/ltori-local-industries.json' with {type:'json'};
import {municipalityAreas, municipalitiesFor, areaFaq} from './ltori-seo.mjs';

export {industries};
export const townSource = townMaster.metadata;
const byCode = new Map(townMaster.areas.map(record => [record.code, record]));
const municipalityByCode = new Map(municipalityAreas.map(area => [area.code, area]));
if (byCode.size !== municipalityAreas.length) throw new Error('Incomplete regional coverage data');
for (const area of municipalityAreas) {
  const row = byCode.get(area.code);
  if (!row || !['towns','wards','municipality','not-listed'].includes(row.kind) || !Array.isArray(row.labels)) throw new Error(`Missing coverage: ${area.code}`);
  if (row.labels.some(label => !label || /以下に掲載がない場合|次に番地がくる場合|一円|[<>]/.test(label))) throw new Error(`Invalid place name: ${area.code}`);
  if (new Set(row.labels).size !== row.labels.length) throw new Error(`Duplicate place name: ${area.code}`);
  for (const code of row.wardCodes || []) {
    const ward = municipalityByCode.get(code);
    if (!ward || ward.prefectureSlug !== area.prefectureSlug || !ward.locality.startsWith(area.locality) || !ward.locality.endsWith('区')) throw new Error(`Invalid ward: ${code}`);
  }
}

export function localCoverageFor(area) {
  if (area.kind === 'prefecture') {
    const children = municipalitiesFor(area.slug);
    return {kind:'prefecture', labels:children.map(child => child.name), children};
  }
  const row = byCode.get(area.code);
  if (!row) throw new Error(`Unknown coverage code: ${area.code}`);
  return {...row, children:(row.wardCodes || []).map(code => municipalityByCode.get(code))};
}

export function localPlacesFor(area) {
  const coverage = localCoverageFor(area);
  if (coverage.kind === 'prefecture') {
    return coverage.children.filter(child => !/市.+区$/.test(child.locality)).slice(0,3).map(child => child.name);
  }
  return coverage.labels.slice(0,3);
}

// These are other pages in the same prefecture, not a geographic-neighbor claim.
export function relatedAreasFor(area) {
  if (area.kind === 'prefecture') return [];
  const peers = municipalitiesFor(area.prefectureSlug);
  const index = peers.findIndex(peer => peer.code === area.code);
  return Array.from({length:Math.min(6, peers.length - 1)}, (_, offset) => peers[(index + offset + 1) % peers.length]);
}

export function regionalFaqsFor(area) {
  const places = localPlacesFor(area);
  return [areaFaq(area), {
    q:`${area.name}で勤務地が複数ある場合も、採用LINEをまとめて運用できますか？`,
    a:`はい。${places.length ? `${places.join('・')}など、` : ''}勤務地ごとに募集職種や勤務条件を整理し、希望勤務地に応じた配信や応募先の案内を設計できます。アカウントをまとめるか分けるかは、採用担当者の運用体制や利用するツールの仕様を確認して決めます。`,
  }, {
    q:`${area.name}の外に住む候補者への情報提供にも使えますか？`,
    a:`はい。${area.fullName}での勤務を検討する方へ、仕事内容に加えて勤務地へのアクセスや選考の進め方を案内できます。オンライン面談を行う場合の予約案内や、見学前の質問への応答も、企業さまの採用方針に合わせて設計します。`,
  }];
}
