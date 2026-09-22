import test from 'node:test';
import assert from 'node:assert/strict';
import {growthNavigation} from '../src/lib/seo-manager/growth-navigation.mjs';

test('project entry opens the matching document list before the first data render', () => {
  assert.deepEqual(growthNavigation('?type=city', '#documents'), {documentType: 'city', tab: 'documents'});
  assert.deepEqual(growthNavigation('?type=article', '#documents'), {documentType: 'article', tab: 'documents'});
  assert.deepEqual(growthNavigation('?type=city'), {documentType: 'city', tab: 'documents'});
});

test('shared operations retain default overview and allow explicit operational tabs', () => {
  assert.deepEqual(growthNavigation(), {documentType: '', tab: 'overview'});
  assert.deepEqual(growthNavigation('', '#health'), {documentType: '', tab: 'health'});
  assert.deepEqual(growthNavigation('?type=article', '#leads'), {documentType: 'article', tab: 'leads'});
});

test('unknown project types and fragments cannot hide every operational panel', () => {
  assert.deepEqual(growthNavigation('?type=corporate', '#missing'), {documentType: '', tab: 'overview'});
  assert.deepEqual(growthNavigation('?type=city', '#missing'), {documentType: 'city', tab: 'documents'});
  assert.deepEqual(growthNavigation('?type=%3Cscript%3E', '#%3Cscript%3E'), {documentType: '', tab: 'overview'});
});
