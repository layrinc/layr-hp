// One definition shared by the Worker scheduler record, the management UI and
// the GitHub runner exit code. A request that finished is not the same as a job
// that succeeded: these outcomes finished but need a person to look.
export const ATTENTION_OUTCOMES = Object.freeze({
  prepare: Object.freeze(['needs_review', 'provider_unavailable', 'provider_blocked', 'state_changed']),
  photos: Object.freeze(['provider_unavailable']),
});
const STEPPED = new Set(['prepare', 'photos']);

/** The outcome that needs attention, or null. Intermediate steps never do. */
export function jobAttention(kind, row) {
  if (!row || row.done !== true) return null;
  return ATTENTION_OUTCOMES[kind]?.includes(row.outcome) ? row.outcome : null;
}

/** Stepped jobs only finish on their last step; the others finish per request. */
export const jobFinished = (kind, row) => !STEPPED.has(kind) || row?.done === true;

export const PHOTO_PROVIDER_STAGES = Object.freeze(['wikidata_city', 'wikipedia_city', 'wikipedia_landmarks', 'wikidata_landmarks', 'commons_category', 'commons_file', 'processing']);
export const PHOTO_PROVIDER_FAILURES = Object.freeze(['budget', 'timeout', 'network', 'redirect', 'http', 'too_large', 'invalid_response', 'invalid_json', 'api_error', 'unexpected']);

/** Fixed classification values only: never a response body, URL, token or message. */
export function photoProviderFailure(value) {
  if (!value || typeof value !== 'object' || !PHOTO_PROVIDER_STAGES.includes(value.stage) || !PHOTO_PROVIDER_FAILURES.includes(value.kind)) return null;
  const failure = {stage: value.stage, kind: value.kind};
  if (value.kind === 'http' && Number.isSafeInteger(value.status) && value.status >= 100 && value.status <= 599) failure.status = value.status;
  if (value.kind === 'api_error' && typeof value.code === 'string' && /^[a-z][a-z0-9_-]{0,39}$/i.test(value.code)) failure.code = value.code;
  return failure;
}
