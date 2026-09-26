import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedGroups, publishedSummary, publishedRows} from '../src/lib/seo-manager/published-list.mjs';

const catalog = [
  {id: 'pref-hokkaido', name: '北海道', fullName: '北海道', prefecture: 'hokkaido', prefectureName: '北海道', kind: 'prefecture', path: '/service/ltori/area/hokkaido/', publication: 'published'},
  {id: '011002', name: '札幌市', fullName: '北海道札幌市', prefecture: 'hokkaido', prefectureName: '北海道', kind: 'city', path: '/service/ltori/area/hokkaido/sapporo/', publication: 'published', publishedAt: '2026-09-23T04:56:00.000Z', title: '札幌市の採用LINE'},
  {id: '012025', name: '函館市', fullName: '北海道函館市', prefecture: 'hokkaido', prefectureName: '北海道', kind: 'city', path: '/service/ltori/area/hokkaido/hakodate/', publication: 'draft'},
  {id: '041009', name: '仙台市', fullName: '宮城県仙台市', prefecture: 'miyagi', prefectureName: '宮城県', kind: 'city', path: '/service/ltori/area/miyagi/sendai/', publication: 'published', publishedAt: '2026-09-26T04:56:31.000Z'},
];

test('published URLs are grouped by prefecture in catalog order and exclude drafts', () => {
  const groups = publishedGroups(catalog);
  assert.deepEqual(groups.map(group => [group.name, group.pages.length]), [['北海道', 2], ['宮城県', 1]]);
  assert.equal(groups[0].pages[0].kind, 'prefecture');
  assert.equal(groups[1].pages[0].url, 'https://layr.co.jp/service/ltori/area/miyagi/sendai/');
  assert.deepEqual(publishedSummary(groups), {count: 3, prefectures: 2, latest: '2026-09-26T04:56:31.000Z'});
  assert.equal(publishedGroups(catalog, {prefecture: 'miyagi'}).length, 1);
  assert.equal(publishedGroups(catalog, {search: 'sapporo'})[0].pages[0].name, '札幌市');
  const rows = publishedRows(groups);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[2], [2, '北海道', '北海道札幌市', '市区町村LP', '札幌市の採用LINE', 'https://layr.co.jp/service/ltori/area/hokkaido/sapporo/', '2026-09-23T04:56:00.000Z']);
});
