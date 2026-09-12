import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAiSavings, simulationDefaults, automationTasks } from '../src/lib/ai-cost-simulation.mjs';

test('80 hours at 2500 yen yields 40 hours, 100000 yen of labor and 120000 yen of reuse value', () => {
  const result = calculateAiSavings(simulationDefaults);
  assert.equal(result.savedHours, 40);
  assert.equal(result.remainingHours, 40);
  assert.equal(result.laborValue, 100000);
  assert.equal(result.redeploymentValue, 120000);
});

test('hourly wage changes the labor equivalent, not the fixed 3000 yen reuse value', () => {
  const result = calculateAiSavings({ ...simulationDefaults, hourlyCost: 2000 });
  assert.equal(result.laborValue, 80000);
  assert.equal(result.redeploymentValue, 120000);
});

test('selected tasks share the entered total hours and do not multiply savings', () => {
  const one = calculateAiSavings({ ...simulationDefaults, selectedTasks: ['invoice'] });
  const all = calculateAiSavings({ ...simulationDefaults, selectedTasks: automationTasks.map(task => task.id) });
  const duplicates = calculateAiSavings({ ...simulationDefaults, selectedTasks: ['invoice', 'invoice'] });
  assert.equal(one.savedHours, all.savedHours);
  assert.equal(one.laborValue, all.laborValue);
  assert.equal(one.redeploymentValue, all.redeploymentValue);
  assert.equal(duplicates.savedHours, 40);
  assert.equal(duplicates.selectedTasks.length, 1);
});

test('zero time produces no savings or reuse value; zero wage preserves saved time', () => {
  const zero = calculateAiSavings({ ...simulationDefaults, monthlyHours: 0 });
  assert.equal(zero.savedHours, 0);
  assert.equal(zero.remainingHours, 0);
  assert.equal(zero.laborValue, 0);
  assert.equal(zero.redeploymentValue, 0);
  const free = calculateAiSavings({ ...simulationDefaults, hourlyCost: 0 });
  assert.equal(free.laborValue, 0);
  assert.equal(free.redeploymentValue, 120000);
});

test('fractional hours remain precise until display formatting', () => {
  const result = calculateAiSavings({ ...simulationDefaults, monthlyHours: 1.5 });
  assert.equal(result.savedHours, 0.75);
  assert.equal(result.laborValue, 1875);
  assert.equal(result.redeploymentValue, 2250);
});

test('requires a known task and finite nonnegative values within the limits', () => {
  for (const value of ['', '80', undefined, null, NaN, Infinity, -1, 10001]) {
    assert.throws(() => calculateAiSavings({ ...simulationDefaults, monthlyHours: value }), RangeError);
  }
  for (const selectedTasks of [[], ['unknown'], null, 'invoice']) {
    assert.throws(() => calculateAiSavings({ ...simulationDefaults, selectedTasks }), RangeError);
  }
  assert.throws(() => calculateAiSavings({ ...simulationDefaults, hourlyCost: 100001 }), RangeError);
});
