// 파형 표시용 min/max 피라미드. 긴 파일도 줌 레벨에 맞는 해상도로 빠르게 그릴 수 있다.
const BASE = 256;
const FACTOR = 16;

export class Peaks {
  constructor(buffer) {
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
      channels.push(buffer.getChannelData(c));
    }
    this.channels = channels;
    this.length = buffer.length;

    let count = Math.ceil(buffer.length / BASE);
    let min = new Float32Array(count);
    let max = new Float32Array(count);
    let absMax = 0;
    for (let b = 0; b < count; b++) {
      const s = b * BASE;
      const e = Math.min(buffer.length, s + BASE);
      let lo = Infinity;
      let hi = -Infinity;
      for (const ch of channels) {
        for (let i = s; i < e; i++) {
          const v = ch[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      min[b] = lo;
      max[b] = hi;
      if (hi > absMax) absMax = hi;
      if (-lo > absMax) absMax = -lo;
    }
    this.absMax = absMax;
    this.levels = [{ block: BASE, min, max }];

    // 상위 레벨: 블록 FACTOR개씩 묶는다
    let block = BASE;
    while (count > FACTOR * 4) {
      const next = Math.ceil(count / FACTOR);
      const nmin = new Float32Array(next);
      const nmax = new Float32Array(next);
      for (let b = 0; b < next; b++) {
        let lo = Infinity;
        let hi = -Infinity;
        const end = Math.min(count, (b + 1) * FACTOR);
        for (let i = b * FACTOR; i < end; i++) {
          if (min[i] < lo) lo = min[i];
          if (max[i] > hi) hi = max[i];
        }
        nmin[b] = lo;
        nmax[b] = hi;
      }
      block *= FACTOR;
      count = next;
      min = nmin;
      max = nmax;
      this.levels.push({ block, min, max });
    }
  }

  /** 원본 프레임 [s, e) 구간의 min/max를 out[0], out[1]에 누적한다. */
  range(s, e, out, maxLevel = this.levels.length - 1) {
    if (e <= s) return;
    // 구간 안에 통째로 들어가는 블록만 쓰고, 양 끝은 더 촘촘한 레벨(또는 원본 샘플)로 계산
    let li = maxLevel;
    while (li >= 0 && this.levels[li].block * 2 > e - s) li--;
    if (li >= 0) {
      const lv = this.levels[li];
      const b0 = Math.ceil(s / lv.block);
      const b1 = Math.min(lv.min.length, Math.floor(e / lv.block));
      if (b1 > b0) {
        let lo = out[0];
        let hi = out[1];
        for (let b = b0; b < b1; b++) {
          if (lv.min[b] < lo) lo = lv.min[b];
          if (lv.max[b] > hi) hi = lv.max[b];
        }
        out[0] = lo;
        out[1] = hi;
        this.range(s, b0 * lv.block, out, li - 1);
        this.range(Math.max(s, b1 * lv.block), e, out, li - 1);
        return;
      }
    }
    let lo = out[0];
    let hi = out[1];
    for (const ch of this.channels) {
      for (let i = s; i < e; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    out[0] = lo;
    out[1] = hi;
  }
}
