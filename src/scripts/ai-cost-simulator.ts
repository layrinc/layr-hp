import { automationTasks, calculateAiSavings, simulationLimits } from '../lib/ai-cost-simulation.mjs';

function initAiCostSimulators() {
  document.querySelectorAll<HTMLElement>('[data-ai-cost-calculator]').forEach(root => {
    if (root.dataset.ready === 'true') return;
    root.dataset.ready = 'true';
    const form = root.querySelector<HTMLFormElement>('form')!;
    const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    const checks = [...form.querySelectorAll<HTMLInputElement>('input[name="tasks"]')];
    const results = root.querySelector<HTMLElement>('[data-sim-results]')!;
    const error = root.querySelector<HTMLElement>('[data-sim-error]')!;
    const number = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });
    const yen = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
    const put = (key: string, value: string) => {
      root.querySelectorAll<HTMLElement>('[data-sim-output="' + key + '"]').forEach(node => { node.textContent = value; });
    };

    function update() {
      const selectedTasks = checks.filter(input => input.checked).map(input => input.value);
      const values: Record<string, number> = {};
      let errorText = selectedTasks.length ? '' : '自動化したい業務を1つ以上選んでください。';
      for (const input of inputs) {
        const value = input.value.trim() === '' ? NaN : Number(input.value);
        const max = simulationLimits[input.name as keyof typeof simulationLimits];
        const valid = input.validity.valid && Number.isFinite(value) && value >= 0 && value <= max;
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid && !errorText) errorText = (input.dataset.label || '入力値') + 'を0〜' + yen.format(max) + 'の範囲で入力してください。';
        values[input.name] = value;
      }
      results.hidden = !!errorText;
      error.hidden = !errorText;
      error.textContent = errorText;
      if (errorText) return;
      try {
        const result = calculateAiSavings({ ...values, selectedTasks });
        put('tasks', automationTasks.filter(task => result.selectedTasks.includes(task.id)).map(task => task.label).join('・'));
        put('savedHours', number.format(result.savedHours));
        put('remainingHours', number.format(result.remainingHours));
        put('monthlyHours', number.format(values.monthlyHours));
        put('hourlyCost', yen.format(values.hourlyCost));
        put('laborValue', yen.format(result.laborValue));
        put('redeploymentValue', yen.format(result.redeploymentValue));
        const before = root.querySelector<HTMLElement>('[data-sim-before]')!;
        const after = root.querySelector<HTMLElement>('[data-sim-after]')!;
        before.style.width = values.monthlyHours > 0 ? '100%' : '0%';
        after.style.width = values.monthlyHours > 0 ? String(result.remainingHours / values.monthlyHours * 100) + '%' : '0%';
      } catch {
        results.hidden = true;
        error.hidden = false;
        error.textContent = '業務の選択と入力内容をご確認ください。正しい数値を入力すると再計算します。';
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
