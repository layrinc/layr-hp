/** Pure, assumption-based estimates. Hours are not automatically cash savings. */
export const simulationDefaults = Object.freeze({
  monthlyHours: 80, hourlyCost: 2500, reductionRate: 50,
  cashShare: 50, monthlyTools: 0,
});

export const simulationLimits = Object.freeze({
  monthlyHours: 10000, hourlyCost: 100000, reductionRate: 100,
  cashShare: 100, monthlyTools: 10000000,
  upfront: 1000000000, monthlyService: 10000000,
});

export function calculateAiSavings(input) {
  for (const [key, maximum] of Object.entries(simulationLimits)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) ||
        input[key] < 0 || input[key] > maximum) {
      throw new RangeError('Invalid simulation input: ' + key);
    }
  }
  const savedHours = input.monthlyHours * input.reductionRate / 100;
  const remainingHours = input.monthlyHours - savedHours;
  const timeValue = savedHours * input.hourlyCost;
  const monthlySavings = timeValue * input.cashShare / 100;
  const monthlyRunningCost = input.monthlyService + input.monthlyTools;
  const monthlyNet = monthlySavings - monthlyRunningCost;
  const firstYearNet = monthlyNet * 12 - input.upfront;
  const paybackMonths = input.upfront === 0 && monthlyNet >= 0 ? 0
    : monthlyNet > 0 ? Math.ceil(input.upfront / monthlyNet) : null;
  return {
    savedHours, remainingHours, timeValue, monthlySavings,
    monthlyRunningCost, monthlyNet, firstYearNet, paybackMonths,
  };
}
