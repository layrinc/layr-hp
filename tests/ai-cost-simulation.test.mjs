import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAiSavings, simulationDefaults } from '../src/lib/ai-cost-simulation.mjs';

const invoice = { ...simulationDefaults, upfront: 50000, monthlyService: 0 };

test('invoice example includes setup cost once and separates hours from cash', () => {
  const result = calculateAiSavings(invoice);
  assert.equal(result.savedHours, 40);
  assert.equal(result.timeValue, 100000);
  assert.equal(result.monthlySavings, 50000);
  assert.equal(result.firstYearNet, 550000);
  assert.equal(result.paybackMonths, 1);
});

test('redeploying salaried time is not cash savings', () => {
  const result = calculateAiSavings({ ...invoice, cashShare: 0 });
  assert.equal(result.savedHours, 40);
  assert.equal(result.timeValue, 100000);
  assert.equal(result.monthlySavings, 0);
  assert.equal(result.firstYearNet, -50000);
  assert.equal(result.paybackMonths, null);
});

test('consulting charges recur each month and losses remain visible', () => {
  const result = calculateAiSavings({ ...invoice, upfront: 0, monthlyService: 50000, monthlyTools: 10000 });
  assert.equal(result.monthlyRunningCost, 60000);
  assert.equal(result.monthlyNet, -10000);
  assert.equal(result.firstYearNet, -120000);
  assert.equal(result.paybackMonths, null);
});

test('development is one upfront payment and tool fees recur', () => {
  const result = calculateAiSavings({ ...invoice, upfront: 300000, monthlyTools: 5000 });
  assert.equal(result.monthlyNet, 45000);
  assert.equal(result.firstYearNet, 240000);
  assert.equal(result.paybackMonths, 7);
});

test('zero inputs do not invent benefits or divide by zero', () => {
  const result = calculateAiSavings({ ...invoice, monthlyHours: 0, upfront: 0 });
  assert.equal(result.savedHours, 0);
  assert.equal(result.remainingHours, 0);
  assert.equal(result.firstYearNet, 0);
  assert.equal(result.paybackMonths, 0);
  assert.equal(calculateAiSavings({ ...invoice, reductionRate: 0 }).paybackMonths, null);
});

test('100 percent and fractional hours retain valid arithmetic', () => {
  const full = calculateAiSavings({ ...invoice, monthlyHours: 10, hourlyCost: 3000, reductionRate: 100, cashShare: 100, upfront: 0 });
  assert.equal(full.savedHours, 10);
  assert.equal(full.remainingHours, 0);
  assert.equal(full.firstYearNet, 360000);
  assert.equal(calculateAiSavings({ ...invoice, monthlyHours: 1.5 }).savedHours, 0.75);
});

test('reject blank, non-numeric, negative, non-finite and excessive values', () => {
  for (const value of ['', '80', undefined, null, NaN, Infinity, -1, 10001]) {
    assert.throws(() => calculateAiSavings({ ...invoice, monthlyHours: value }), RangeError);
  }
  assert.throws(() => calculateAiSavings({ ...invoice, reductionRate: 101 }), RangeError);
  assert.throws(() => calculateAiSavings({ ...invoice, cashShare: -1 }), RangeError);
});
