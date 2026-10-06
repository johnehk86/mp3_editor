// 비파괴 편집 타임라인.
// 원본 AudioBuffer는 그대로 두고, 재생 순서대로 이어 붙일 원본 구간 목록(segments)만 바꾼다.
// 인스턴스는 불변이므로 실행 취소 기록에 그대로 보관할 수 있다.
export class Timeline {
  /**
   * @param {{buffer: AudioBuffer, peaks: import('./peaks.js').Peaks}} source
   * @param {{start: number, end: number}[]} segments 원본 프레임 구간
   */
  constructor(source, segments) {
    this.source = source;
    this.segments = segments;
    this.offsets = new Array(segments.length);
    let acc = 0;
    segments.forEach((s, i) => {
      this.offsets[i] = acc;
      acc += s.end - s.start;
    });
    this.length = acc;
  }

  static fromBuffer(buffer, peaks) {
    return new Timeline({ buffer, peaks }, [{ start: 0, end: buffer.length }]);
  }

  get sampleRate() {
    return this.source.buffer.sampleRate;
  }

  get numberOfChannels() {
    return this.source.buffer.numberOfChannels;
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  toFrame(sec) {
    return Math.max(0, Math.min(this.length, Math.round(sec * this.sampleRate)));
  }

  segmentIndexAt(frame) {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= frame) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 타임라인 프레임 [a, b)를 덮는 원본 구간마다 cb(srcStart, srcEnd, timelineStart) 호출 */
  forEachRange(a, b, cb) {
    if (b <= a || this.segments.length === 0) return;
    for (let i = this.segmentIndexAt(a); i < this.segments.length && this.offsets[i] < b; i++) {
      const seg = this.segments[i];
      const off = this.offsets[i];
      const vs = Math.max(a, off);
      const ve = Math.min(b, off + seg.end - seg.start);
      if (ve > vs) cb(seg.start + vs - off, seg.start + ve - off, vs);
    }
  }

  /** [a, b)만 남긴 새 타임라인 */
  slice(a, b) {
    const segs = [];
    this.forEachRange(a, b, (s, e) => segs.push({ start: s, end: e }));
    return new Timeline(this.source, segs);
  }

  /** [a, b)를 지운 새 타임라인 */
  remove(a, b) {
    const segs = [];
    const push = (s, e) => {
      const last = segs[segs.length - 1];
      if (last && last.end === s) last.end = e;
      else segs.push({ start: s, end: e });
    };
    this.forEachRange(0, a, push);
    this.forEachRange(b, this.length, push);
    return new Timeline(this.source, segs);
  }

  /** 채널 ch의 타임라인 프레임 [a, b)를 out[outOffset..]에 복사 */
  copyChannel(ch, a, b, out, outOffset = 0) {
    const data = this.source.buffer.getChannelData(Math.min(ch, this.numberOfChannels - 1));
    this.forEachRange(a, b, (s, e, v) => out.set(data.subarray(s, e), outOffset + v - a));
  }

  /** 타임라인 프레임 [a, b)의 파형 min/max */
  peakRange(a, b, out) {
    out[0] = Infinity;
    out[1] = -Infinity;
    const peaks = this.source.peaks;
    this.forEachRange(a, b, (s, e) => peaks.range(s, e, out));
    if (out[0] === Infinity) {
      out[0] = 0;
      out[1] = 0;
    }
    return out;
  }
}
