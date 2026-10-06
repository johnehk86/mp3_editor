const pad = (n) => String(n).padStart(2, '0');

/** 초 → "mm:ss.d" 또는 "hh:mm:ss.d" */
export function formatTime(sec, { hours = false } = {}) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const tenths = Math.round(sec * 10);
  const d = tenths % 10;
  const total = Math.floor(tenths / 10);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0 || hours) return `${pad(h)}:${pad(m)}:${pad(s)}.${d}`;
  return `${pad(m)}:${pad(s)}.${d}`;
}

/** "1:02:03.4", "02:03.4", "123.4" 를 초로 변환. 잘못된 입력은 NaN. */
export function parseTime(str) {
  const parts = String(str).trim().split(':');
  if (parts.length > 3) return NaN;
  let total = 0;
  for (const p of parts) {
    if (!/^\d*\.?\d*$/.test(p) || p === '' || p === '.') return NaN;
    total = total * 60 + parseFloat(p);
  }
  return total;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
