// 선택 구간의 페이드 인/아웃 볼륨 곡선 (구간별 선형)
export function makeEnvelope(sel, fade) {
  const len = sel.end - sel.start;
  const both = fade.in && fade.out;
  const fadeIn = fade.in ? Math.min(fade.len, both ? len / 2 : len) : 0;
  const fadeOut = fade.out ? Math.min(fade.len, both ? len / 2 : len) : 0;
  const { start, end } = sel;

  return {
    start,
    end,
    fadeIn,
    fadeOut,
    isFlat: fadeIn === 0 && fadeOut === 0,
    gainAt(t) {
      let g = 1;
      if (fadeIn > 0 && t < start + fadeIn) g = Math.min(g, Math.max(0, (t - start) / fadeIn));
      if (fadeOut > 0 && t > end - fadeOut) g = Math.min(g, Math.max(0, (end - t) / fadeOut));
      return g;
    },
    breakpoints() {
      return [start, start + fadeIn, end - fadeOut, end].sort((a, b) => a - b);
    },
  };
}
