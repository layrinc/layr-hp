import {DOMAIN, validateMeasurement, normalizeAuthority} from '../src/lib/seo-manager/domain-authority-model.mjs';

const NAMESPACE = 'domain_authority';
const ENDPOINT = 'https://openpagerank.keywordseverywhere.com/v1/domains/bulk';
const WEEK = 7 * 86400000;
const japanDay = now => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);

export async function readDomainAuthority(db) {
  const row = await db.prepare("SELECT value,version FROM seo_kv WHERE namespace=? AND key=?").bind(NAMESPACE, DOMAIN).first();
  const state = normalizeAuthority(row ? JSON.parse(row.value) : null);
  return {...state, revision: row?.version || 0};
}

async function write(db, state, expectedRevision, now) {
  const value = JSON.stringify({history: state.history, automation: state.automation}), updatedAt = now.toISOString();
  const statement = expectedRevision === 0
    ? db.prepare("INSERT INTO seo_kv(namespace,key,value,version,updated_at) VALUES(?,?,?,1,?) ON CONFLICT DO NOTHING").bind(NAMESPACE, DOMAIN, value, updatedAt)
    : db.prepare("UPDATE seo_kv SET value=?,version=version+1,updated_at=? WHERE namespace=? AND key=? AND version=?").bind(value, updatedAt, NAMESPACE, DOMAIN, expectedRevision);
  return (await statement.run()).meta.changes > 0;
}

/** Appends one hand-entered measurement; the same source and date replaces the earlier entry. */
export async function addMeasurement(db, input, expectedRevision, now = new Date()) {
  const current = await readDomainAuthority(db);
  if (current.revision !== expectedRevision) return null;
  const measurement = validateMeasurement(input);
  const history = [...current.history.filter(row => !(row.source === measurement.source && row.measuredAt === measurement.measuredAt)), measurement];
  const next = normalizeAuthority({history, automation: current.automation});
  return await write(db, next, expectedRevision, now) ? {...next, revision: expectedRevision + 1} : null;
}

/** Weekly Open PageRank fetch. Never throws: failures are stored as a fixed code only. */
export async function refreshDomainAuthority(env, {now = new Date(), fetchImpl = fetch} = {}) {
  const db = env.SEO_DB, current = await readDomainAuthority(db);
  const key = typeof env.OPEN_PAGERANK_API_KEY === 'string' ? env.OPEN_PAGERANK_API_KEY.trim() : '';
  let automation = {...current.automation, lastAttemptAt: now.toISOString()}, history = current.history;
  if (!key) {
    if (current.revision && current.automation.status === 'not_configured') return {outcome: 'not_configured'};
    automation = {...automation, status: 'not_configured', code: null};
  }
  else {
    const last = Date.parse(current.automation.lastSuccessAt || '');
    if (Number.isFinite(last) && now.getTime() - last < WEEK - 3600000) return {outcome: 'cached'};
    try {
      const response = await fetchImpl(ENDPOINT, {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({domains: [DOMAIN]})});
      if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'http_error'); }
      const body = await response.json(), result = body?.results?.find?.(row => row?.domain === DOMAIN);
      if (!result || result.found === false || !Number.isFinite(result.open_page_rank)) throw new Error('not_found');
      const measurement = validateMeasurement({source: 'open_pagerank', value: result.open_page_rank, measuredAt: japanDay(now), referringDomains: Number.isSafeInteger(result.referring_domains) ? result.referring_domains : undefined, note: typeof result.as_of === 'string' ? `データ時点 ${result.as_of.slice(0, 10)}` : ''}, {automatic: true});
      history = [...history.filter(row => !(row.source === 'open_pagerank' && row.measuredAt === measurement.measuredAt)), measurement];
      automation = {...automation, status: 'ok', lastSuccessAt: now.toISOString(), code: null};
    } catch (error) {
      const code = ['unauthorized', 'rate_limited', 'http_error', 'not_found'].includes(error?.message) ? error.message : 'request_failed';
      automation = {...automation, status: 'error', code};
    }
  }
  const saved = await write(db, normalizeAuthority({history, automation}), current.revision, now);
  return {outcome: saved ? automation.status : 'state_changed'};
}
