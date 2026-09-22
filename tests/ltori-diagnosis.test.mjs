import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosisQuestions, createDiagnosis, diagnosisCode, diagnosisFromCode, diagnosisSummary, diagnosisContactHref, safeDiagnosisSource } from '../src/lib/ltori-diagnosis.mjs';

const answers = { industry: 'manufacturing', goal: 'small', source: 'media', bottleneck: 'contact', line: 'new' };

test('returns a practical plan specific to stage, industry, recruitment scale and source', () => {
  const result = createDiagnosis(answers);
  assert.match(result.title, /応募後の連絡/);
  assert.match(result.industry, /交替勤務/);
  assert.match(result.preparation.join('\n'), /媒体で認められた範囲/);
  assert.match(result.preparation.join('\n'), /少人数/);
  assert.match(result.message, /ご応募ありがとうございます/);
  assert.equal(result.flow.length, 4);
  assert.equal(result.labels.length, 5);
});

test('other stages and industries change the recommended flow and relevant material', () => {
  const interview = createDiagnosis({...answers, industry:'care', bottleneck:'schedule', source:'owned', goal:'large', line:'using'});
  assert.match(interview.flow.join(' '), /予約/);
  assert.match(interview.industry, /必要資格/);
  assert.match(interview.preparation.join(' '), /採用管理システム/);
  assert.match(interview.metrics.join(' '), /面接実施率/);
  const prejoin = createDiagnosis({...answers, bottleneck:'prejoin'});
  assert.match(prejoin.message, /入社/);
  assert.notDeepEqual(prejoin.flow, interview.flow);
});

test('all advertised choices produce a complete deterministic plan', () => {
  for (const question of diagnosisQuestions) {
    for (const [choice] of question.choices) {
      const current = {...answers, [question.key]:choice};
      const result = createDiagnosis(current);
      assert.ok(result.title && result.message && result.industry);
      assert.equal(result.preparation.length, 3);
      assert.deepEqual(diagnosisFromCode(result.code), current);
    }
  }
});

test('rejects incomplete or injected values before producing a result or contact payload', () => {
  for (const invalid of [null, {}, [], {...answers, source:'<script>'}, {...answers, industry:'__proto__'}, {...answers, goal:['small']}]) {
    assert.equal(createDiagnosis(invalid), null);
    assert.equal(diagnosisCode(invalid), '');
    assert.equal(diagnosisSummary(invalid), '');
    assert.equal(diagnosisContactHref(invalid), '');
  }
  for (const code of [null, '', 'manufacturing.small.media.contact', `${diagnosisCode(answers)}.extra`, 'x'.repeat(121), 'constructor.small.media.contact.new']) assert.equal(diagnosisFromCode(code), null);
});

test('contact links preserve valid regional attribution with enum-only result codes', () => {
  const url = new URL(diagnosisContactHref(answers, 'area/mie/nabari'), 'https://layr.co.jp');
  assert.equal(url.pathname, '/contact/');
  assert.equal(url.searchParams.get('service'), 'ltori');
  assert.equal(url.searchParams.get('source'), 'area/mie/nabari');
  assert.deepEqual(diagnosisFromCode(url.searchParams.get('diagnosis')), answers);
  assert.ok(!url.searchParams.has('message'));
  assert.match(diagnosisSummary(answers), /採用LINE活用診断/);
  assert.match(diagnosisSummary(answers), /製造/);
});

test('external URLs, PII and traversal cannot enter attribution through the diagnostic', () => {
  for (const invalid of ['https://example.com', 'javascript:alert(1)', '//example.com', 'area/../../contact', 'person@example.com', 'media/hello?email=x', '<script>', 'x'.repeat(121)]) assert.equal(safeDiagnosisSource(invalid), 'diagnosis');
  for (const valid of ['diagnosis', 'media', 'media/recruitment-line-guide', 'area/mie', 'area/mie/nabari']) assert.equal(safeDiagnosisSource(valid), valid);
});
