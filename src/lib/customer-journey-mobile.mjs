// A single scroll progress controls the phone's horizontal journey.
// Hold each card long enough to read it; bloom only after LINE has arrived.
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export const mobileStepProgress = [0.08, 0.42, 0.70];

export function mobileJourneyState(value) {
  const progress = clamp(Number.isFinite(value) ? value : 0);
  return {
    position: smooth((progress - 0.20) / 0.18) + smooth((progress - 0.50) / 0.18),
    phase: progress < 0.29 ? 0 : progress < 0.59 ? 1 : 2,
    messageProgress: clamp((progress - 0.68) / 0.18),
    bloomProgress: clamp((progress - 0.86) / 0.10),
    complete: progress >= 0.96,
  };
}
