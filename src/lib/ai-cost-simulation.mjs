/** Illustrative capacity estimates; these are not cash savings or profit forecasts. */
export const automationTasks = Object.freeze([
  { id: 'invoice', label: '請求書の処理' },
  { id: 'entry', label: 'データ入力・転記' },
  { id: 'report', label: '集計・レポート作成' },
  { id: 'support', label: '問い合わせの一次対応' },
  { id: 'orders', label: '受発注・営業事務' },
  { id: 'minutes', label: '議事録・社内文書' },
]);

export const simulationDefaults = Object.freeze({
  selectedTasks: Object.freeze(['invoice', 'entry']),
  monthlyHours: 80,
  hourlyCost: 2500,
});

export const simulationAssumptions = Object.freeze({
  timeReductionRate: 50,
  redeploymentHourlyValue: 3000,
});

export const simulationLimits = Object.freeze({
  monthlyHours: 10000,
  hourlyCost: 100000,
});

export function calculateAiSavings(input) {
  for (const [key, maximum] of Object.entries(simulationLimits)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) ||
        input[key] < 0 || input[key] > maximum) {
      throw new RangeError('Invalid simulation input: ' + key);
    }
  }
  const validTasks = new Set(automationTasks.map(task => task.id));
  if (!Array.isArray(input.selectedTasks) || input.selectedTasks.length === 0 ||
      input.selectedTasks.some(id => !validTasks.has(id))) {
    throw new RangeError('Choose at least one valid task');
  }
  const selectedTasks = [...new Set(input.selectedTasks)];
  // Hours are the aggregate for all checked tasks, never hours per task.
  const savedHours = input.monthlyHours * simulationAssumptions.timeReductionRate / 100;
  const remainingHours = input.monthlyHours - savedHours;
  return {
    selectedTasks,
    savedHours,
    remainingHours,
    laborValue: savedHours * input.hourlyCost,
    redeploymentValue: savedHours * simulationAssumptions.redeploymentHourlyValue,
  };
}
