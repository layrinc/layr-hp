import { calculateAiSavings, simulationLimits } from '../lib/ai-cost-simulation.mjs';

function initAiCostSimulators() {
  document.querySelectorAll<HTMLElement>('[data-ai-cost-calculator]').forEach(root => {
    if (root.dataset.ready === 'true') return;
    root.dataset.ready = 'true';
    const form = root.querySelector<HTMLFormElement>('form')!;
    const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input[type="number"], input[type="range"]')];
    const plan = form.querySelector<HTMLSelectElement>('select')!;
    const results = root.querySelector<HTMLElement>('[data-sim-results]')!;
    const error = root.querySelector<HTMLElement>('[data-sim-error]')!;
    const number = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
    const yen = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
    const put = (key: string, value: string) => {
      root.querySelectorAll<HTMLElement>('[data-sim-output="' + key + '"]').forEach(node => { node.textContent = value; });
    };

    function update() {
      const values: Record<string, number> = {};
      let errorText = '';
      for (const input of inputs) {
        const value = input.value.trim() === '' ? NaN : Number(input.value);
        const max = simulationLimits[input.name as keyof typeof simulationLimits];
        const valid = input.validity.valid && Number.isFinite(value) && value >= 0 && value <= max;
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid && !errorText) errorText = (input.dataset.label || '入力値') + 'を0〜' + yen.format(max) + 'の範囲で入力してください。';
        values[input.name] = value;
      }
      for (const input of inputs.filter(item => item.type === 'range')) {
        const percentage = number.format(Number(input.value)) + '%';
        put(input.name, percentage);
        input.setAttribute('aria-valuetext', percentage);
      }
      results.hidden = !!errorText;
      error.hidden = !errorText;
      error.textContent = errorText;
      if (errorText) return;
      const option = plan.selectedOptions[0];
      const upfront = Number(option.dataset.upfront);
      const monthlyService = Number(option.dataset.monthly);
      try {
        const result = calculateAiSavings({ ...values, upfront, monthlyService });
        put('yearLabel', result.firstYearNet < 0 ? '初年度の費用超過見込み' : '初年度の経費削減効果');
        put('firstYearNet', yen.format(Math.abs(result.firstYearNet)));
        put('savedHours', number.format(result.savedHours));
        put('timeValue', yen.format(result.timeValue));
        put('monthlyHours', number.format(values.monthlyHours));
        put('remainingHours', number.format(result.remainingHours));
        put('monthlySavings', yen.format(result.monthlySavings) + '円');
        put('monthlyRunningCost', yen.format(result.monthlyRunningCost) + '円');
        put('upfront', yen.format(upfront) + '円');
        put('planCost', '初期 ' + yen.format(upfront) + '円 ／ 月額 ' + yen.format(monthlyService) + '円（税別）');
        put('payback', result.paybackMonths === null ? 'この条件では回収できません'
          : result.paybackMonths === 0 ? '初期費用なし'
          : '約' + yen.format(result.paybackMonths) + 'か月');
        put('yearNote', result.firstYearNet < 0
          ? 'この条件では、初年度の導入・運用費用が削減額を上回ります。'
          : '月の削減見込みから運用費用を引き、12か月分から初期費用を差し引いた目安です。');
        root.dataset.negative = String(result.firstYearNet < 0);
        const before = root.querySelector<HTMLElement>('[data-sim-before]')!;
        const after = root.querySelector<HTMLElement>('[data-sim-after]')!;
        before.style.width = values.monthlyHours > 0 ? '100%' : '0%';
        after.style.width = values.monthlyHours > 0 ? String(result.remainingHours / values.monthlyHours * 100) + '%' : '0%';
      } catch {
        results.hidden = true;
        error.hidden = false;
        error.textContent = '入力内容をご確認ください。正しい数値を入力すると再計算します。';
      }
    }
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('reset', () => requestAnimationFrame(update));
    fieldset.disabled = false;
    update();
  });
}

initAiCostSimulators();
document.addEventListener('astro:page-load', initAiCostSimulators);
