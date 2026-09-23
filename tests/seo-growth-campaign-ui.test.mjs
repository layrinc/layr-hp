import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cityAreas, prefectureAreas} from '../src/lib/ltori-seo.mjs';

const source = readFileSync(new URL('../src/lib/seo-manager/growth-app.mjs', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../src/pages/tools/ltori-seo/growth.astro', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.hidden = false; this.value = ''; this.dataset = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Campaign rendering must use text nodes.'); }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.text = ''; this.children = [...elements]; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
function client() {
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const context = vm.createContext({Intl, Date, URL, console, startAccessSession: async () => false,
    document: {createElement: tag => new Element(tag), getElementById: id => {
      assert.ok(elements.has(id), `Missing markup for #${id}`); return elements.get(id);
    }},
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context);
  return {
    get: id => elements.get(id),
    render(campaign, {paused = false, todayPublished = 0, regionalPreparation} = {}) {
      context.fixture = {settings: {paused}, documents: [], regionalPreparation, publicationStats: {byScope: {regional: {todayPublished, dailyLimit: null, mode: 'prefecture_campaign', campaign}, media: {monthPublished: 3, monthlyLimit: 10, dueReady: 1}}}};
      vm.runInContext('data = fixture; renderOverview = renderDocuments = renderLeads = renderHealth = () => {}; render();', context);
    },
    approve(doc) { context.doc = doc; return vm.runInContext('approvalMessage(doc)', context); },
  };
}
function campaignFixture() {
  const prefectures = prefectureAreas.map(prefecture => {
    const cities = cityAreas.filter(city => city.prefectureSlug === prefecture.slug);
    return {code: cities[0].code.slice(0, 2), slug: prefecture.slug, name: prefecture.name, total: cities.length};
  }).sort((a, b) => a.code.localeCompare(b.code)).map((prefecture, index) => ({...prefecture, dayNumber: index + 1,
    plannedOn: new Date(Date.UTC(2026, 8, 23 + index)).toISOString().slice(0, 10), live: 0, ready: 0, missing: prefecture.total, remaining: prefecture.total, overdue: false}));
  const total = prefectures.reduce((sum, row) => sum + row.total, 0);
  return {config: {enabled: true, startDate: '2026-09-23', revision: 1}, day: {status: 'active', day: '2026-09-23', startDate: '2026-09-23', endDate: '2026-11-08', dayNumber: 1,
    prefecture: {name: '北海道', slug: 'hokkaido', code: '01'}, publishAt: '2026-09-23T09:17:00+09:00', readyToPublish: false},
    totals: {total, live: 0, remaining: total, ready: 0, missing: total}, prefectures, currentDay: prefectures[0]};
}

test('campaign renders all 47 prefectures, 792 cities and the current day without the old daily cap', () => {
  const ui = client(), campaign = campaignFixture(); ui.render(campaign, {todayPublished: 35});
  assert.equal(ui.get('growth-regional-rows').children.length, 47);
  const rows = ui.get('growth-regional-rows').children;
  assert.equal(rows[0].children[1].textContent, '北海道');
  assert.equal(rows.at(-1).children[1].textContent, '沖縄県');
  assert.match(ui.get('growth-regional-totals').textContent, /対象市792市/);
  assert.match(ui.get('growth-regional-day').textContent, /1 \/ 47日目：北海道/);
  assert.equal(ui.get('growth-daily-count').textContent, '35市');
  assert.equal(ui.get('growth-monthly-count').textContent, '3 / 10本');
  assert.doesNotMatch(ui.get('growth-publication-detail').textContent, /1日20|20地域/);
  assert.equal(ui.get('growth-regional-empty').hidden, true);
});

test('calendar completion never claims all cities published when cities remain missing', () => {
  const ui = client(), campaign = campaignFixture();
  campaign.day.status = 'completed'; campaign.day.day = '2026-11-09'; campaign.day.prefecture = null; campaign.currentDay = null;
  campaign.totals.remaining = 17; campaign.prefectures[0].overdue = true;
  ui.render(campaign);
  assert.match(ui.get('growth-regional-day').textContent, /日程が終了.*未公開 17市/);
  assert.match(ui.get('growth-regional-day').textContent, /全市の公開完了を意味しません/);
  assert.equal(ui.get('growth-regional-rows').children[0].children.at(-1).textContent, '予定日経過・未公開あり');
});

test('missing and invalid counts remain unknown while measured zero remains zero', () => {
  const ui = client(), campaign = campaignFixture();
  campaign.totals.live = null; campaign.totals.ready = 0; campaign.totals.missing = '0'; campaign.totals.remaining = -1;
  campaign.prefectures[0].live = undefined; campaign.prefectures[0].ready = '0';
  ui.render(campaign, {todayPublished: null});
  const counts = ui.get('growth-regional-totals').children.map(element => element.children[1].textContent);
  assert.deepEqual(counts, ['792市', '—', '—', '0市', '—']);
  assert.equal(ui.get('growth-daily-count').textContent, '—');
  assert.equal(ui.get('growth-regional-rows').children[0].children[4].textContent, '—');
  ui.render(undefined);
  assert.match(ui.get('growth-regional-day').textContent, /取得できていません/);
  assert.equal(ui.get('growth-regional-rows').children.length, 0);
  assert.equal(ui.get('growth-regional-empty').hidden, false);
  assert.equal(ui.get('growth-regional-totals').children.every(element => element.children[1].textContent === '—'), true);
});

test('upcoming, disabled and common pause states are distinct without replacing saved progress', () => {
  const ui = client(), campaign = campaignFixture();
  campaign.day.status = 'upcoming'; campaign.day.prefecture = null; campaign.currentDay = null;
  ui.render(campaign);
  assert.match(ui.get('growth-regional-day').textContent, /2026-09-23から開始予定/);
  campaign.day.status = 'disabled'; campaign.config.enabled = false;
  ui.render(campaign, {paused: true});
  assert.match(ui.get('growth-regional-day').textContent, /共通の自動公開を一時停止中.*都道府県別の自動公開は停止中/);
  assert.equal(ui.get('growth-regional-rows').children.length, 47);
  assert.match(ui.get('growth-regional-totals').textContent, /792市/);
  campaign.config.valid = false; ui.render(campaign);
  assert.match(ui.get('growth-regional-day').textContent, /設定を確認できません/);
});

test('regional text is rendered as text and approval explains the matching publication scope', () => {
  const ui = client(), campaign = campaignFixture();
  campaign.prefectures[0].name = '<img src=x onerror=alert(1)>';
  ui.render(campaign);
  assert.equal(ui.get('growth-regional-rows').children[0].children[1].textContent, campaign.prefectures[0].name);
  assert.match(ui.approve({type: 'city'}), /1日1都道府県.*全市.*47日間/);
  assert.match(ui.approve({type: 'city'}), /予定日を過ぎた未公開分は確認が必要/);
  assert.match(ui.approve({type: 'article'}), /月10本まで・原則3日以上/);
  assert.doesNotMatch(ui.approve({type: 'article'}), /都道府県/);
  assert.doesNotMatch(markup + source, /1日20地域|— \/ 20/);
  assert.match(markup, /<details>[\s\S]*47都道府県[\s\S]*tabindex="0"/);
});

test('preparation configuration and blocked cities remain separate from published counts', () => {
  const ui = client(), campaign = campaignFixture();
  const regionalPreparation = {enabled: true, ready: 2, blocked: 1, pending: 0, blockedCities: [{name: '札幌市', slug: 'sapporo', reason: 'INTERNAL_PROVIDER_DETAILS'}]};
  ui.render(campaign, {regionalPreparation});
  assert.match(ui.get('growth-regional-preparation').textContent, /稼働中.*準備済み 2市.*要確認 1市.*待機中 0市/);
  assert.equal(ui.get('growth-regional-blocked').hidden, false);
  assert.match(ui.get('growth-regional-blocked-cities').textContent, /札幌市：原稿・根拠資料の確認が必要/);
  assert.doesNotMatch(ui.get('growth-regional-blocked-cities').textContent, /INTERNAL_PROVIDER/);
  assert.match(ui.get('growth-regional-totals').textContent, /公開中0市/);
  ui.render(campaign, {regionalPreparation, paused: true});
  assert.match(ui.get('growth-regional-preparation').textContent, /停止中（共通の一時停止）/);
  ui.render(campaign, {regionalPreparation: {...regionalPreparation, enabled: false}});
  assert.match(ui.get('growth-regional-preparation').textContent, /停止中/);
  ui.render(campaign);
  assert.match(ui.get('growth-regional-preparation').textContent, /未確認.*準備済み —.*要確認 —/);
  assert.equal(ui.get('growth-regional-blocked').hidden, true);
});


test('provider or budget interruptions are visible instead of reporting uninterrupted generation',()=>{
 const ui=client(),campaign=campaignFixture();
 ui.render(campaign,{regionalPreparation:{enabled:true,lastRun:{status:'completed',result:{outcome:'provider_blocked'}}}});
 assert.match(ui.get('growth-regional-preparation').textContent,/要確認（費用上限・接続・設定を確認）/);
 campaign.day.status='disabled';ui.render(campaign,{regionalPreparation:{enabled:true}});
 assert.match(ui.get('growth-regional-preparation').textContent,/停止中（公開日程の設定待ち）/);
});

test('template preparation explains reuse without AI charges and shows configuration errors accurately',()=>{
 const ui=client(),campaign=campaignFixture();
 const regionalPreparation={mode:'lp_template',enabled:true,paidAiRequired:false,ready:35,blocked:0,pending:0};
 ui.render(campaign,{regionalPreparation});
 assert.match(ui.get('growth-regional-preparation').textContent,/既存LPの地域展開：稼働中.*有料AIは使用しません.*準備済み 35市/);
 assert.doesNotMatch(ui.get('growth-regional-preparation').textContent,/自動調査・制作/);
 ui.render(campaign,{regionalPreparation:{...regionalPreparation,lastRun:{status:'error'}}});
 assert.match(ui.get('growth-regional-preparation').textContent,/地域データ・公開設定を確認/);
 assert.doesNotMatch(ui.get('growth-regional-preparation').textContent,/費用上限/);
 campaign.day.status='completed';ui.render(campaign,{regionalPreparation});
 assert.match(ui.get('growth-regional-preparation').textContent,/日程終了/);
});
