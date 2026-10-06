// 타임라인 재생기. 구간마다 AudioBufferSourceNode를 이어 붙여 예약하고, 페이드는 GainNode 자동화로 처리한다.
export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.sources = [];
    this.gain = null;
    this.playing = false;
    this.token = 0;
  }

  /** 타임라인의 from~to(초)를 재생. env는 makeEnvelope 결과. */
  play(timeline, from, to, env, onEnd) {
    this.stop();
    const { ctx } = this;
    const sr = timeline.sampleRate;
    const a = timeline.toFrame(from);
    const b = timeline.toFrame(to);
    if (b <= a) return false;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.03;
    gain.gain.setValueAtTime(env.gainAt(from), t0);
    for (const bp of env.breakpoints()) {
      if (bp > from && bp < to) gain.gain.linearRampToValueAtTime(env.gainAt(bp), t0 + bp - from);
    }
    gain.gain.linearRampToValueAtTime(env.gainAt(to), t0 + to - from);

    const sources = [];
    timeline.forEachRange(a, b, (s, e, v) => {
      const src = ctx.createBufferSource();
      src.buffer = timeline.source.buffer;
      src.connect(gain);
      src.start(t0 + (v - a) / sr, s / sr, (e - s) / sr);
      sources.push(src);
    });

    const token = ++this.token;
    sources[sources.length - 1].onended = () => {
      if (token !== this.token) return;
      this.stop();
      onEnd?.();
    };
    Object.assign(this, { sources, gain, t0, from, to, playing: true });
    return true;
  }

  /** 현재 재생 위치(초). 재생 중이 아니면 null */
  get position() {
    if (!this.playing) return null;
    return Math.min(this.to, this.from + Math.max(0, this.ctx.currentTime - this.t0));
  }

  stop() {
    this.token++;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // 아직 시작 전인 노드
      }
      s.disconnect();
    }
    this.gain?.disconnect();
    this.sources = [];
    this.gain = null;
    this.playing = false;
  }
}
