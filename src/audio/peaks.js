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
  range(s, e, out) {
    let lo = out[0];
    let hi = out[1];
    if (e - s < BASE * 2) {
      for (const ch of this.channels) {
        for (let i = s; i < e; i++) {
          const v = ch[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    } else {
      let lv = this.levels[0];
      for (const l of this.levels) if (l.block * 2 <= e - s) lv = l;
      const b0 = Math.floor(s / lv.block);
      const b1 = Math.min(lv.min.length, Math.ceil(e / lv.block));
      for (let b = b0; b < b1; b++) {
        if (lv.min[b] < lo) lo = lv.min[b];
        if (lv.max[b] > hi) hi = lv.max[b];
      }
    }
    out[0] = lo;
    out[1] = hi;
  }
}
