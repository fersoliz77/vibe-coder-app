export const ACCESSIBILITY_KEY = 'vibe-accessibility';

export function readAccessibility() {
  try {
    return { highContrast: false, reducedMotion: false, ...JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) || '{}') };
  } catch {
    return { highContrast: false, reducedMotion: false };
  }
}

export function applyAccessibility(value) {
  document.body.classList.toggle('high-contrast', Boolean(value.highContrast));
  document.body.classList.toggle('reduced-motion', Boolean(value.reducedMotion));
}

export function saveAccessibility(value) {
  localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(value));
  applyAccessibility(value);
}
