// 보컬 제거 / 템포(BPM) 분석

/**
 * 센터 채널 상쇄로 보컬을 줄인 새 AudioBuffer를 만든다.
 * keepBass: 150Hz 이하의 가운데 성분(베이스·킥)은 남긴다.
 */
export function removeVocals(timeline, { keepBass = true } = {}) {
  if (timeline.numberOfChannels < 2) throw new Error('스테레오 파일에서만 사용할 수 있어요.');
  const n = timeline.length;
  const sr = timeline.sampleRate;
  const out = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  timeline.copyChannel(0, 0, n, L);
  timeline.copyChannel(1, 0, n, R);

  const a = Math.exp((-2 * Math.PI * 150) / sr);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;
    let low = 0;
    if (keepBass) {
      y1 = (1 - a) * mid + a * y1;
      y2 = (1 - a) * y1 + a * y2;
      low = y2;
    }
    L[i] = side + low;
    R[i] = side + low;
  }
  return out;
}

/**
 * start~end(초) 구간(최대 90초)의 템포를 추정한다.
 * 에너지 증가량(onset) 곡선의 자기상관에서 가장 강한 주기를 찾는다.
 */
export function detectBpm(timeline, start, end) {
  const sr = timeline.sampleRate;
  const a = timeline.toFrame(start);
  const b = Math.min(timeline.toFrame(end), a + 90 * sr);
  if (b - a < 6 * sr) return null;

  const len = b - a;
  const mono = new Float32Array(len);
  const tmp = new Float32Array(len);
  timeline.copyChannel(0, a, b, mono);
  if (timeline.numberOfChannels > 1) {
    timeline.copyChannel(1, a, b, tmp);
    for (let i = 0; i < len; i++) mono[i] = (mono[i] + tmp[i]) * 0.5;
  }

  const hop = 256;
  const frameRate = sr / hop;
  const frames = Math.floor(len / hop);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) sum += mono[i] * mono[i];
    energy[f] = Math.log(1e-10 + sum);
  }

  // onset 강도: 에너지가 올라간 양, 주변 평균을 빼서 정규화
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  const win = Math.round(frameRate * 0.5);
  const smoothed = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += onset[f];
    if (f >= win) acc -= onset[f - win];
    smoothed[f] = Math.max(0, onset[f] - acc / Math.min(f + 1, win));
  }

  const minLag = Math.floor((frameRate * 60) / 200);
  const maxLag = Math.ceil((frameRate * 60) / 60);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = 0; lag < ac.length && lag < frames; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += smoothed[i] * smoothed[i + lag];
    ac[lag] = s / (frames - lag);
  }

  let best = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = ac[lag] + 0.5 * (ac[lag * 2] || 0);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0 || ac[0] === 0) return null;

  // 포물선 보간으로 lag을 소수점 단위로 보정
  const y0 = ac[best - 1];
  const y1 = ac[best];
  const y2 = ac[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const lag = denom !== 0 ? best + (0.5 * (y0 - y2)) / denom : best;

  let bpm = (60 * frameRate) / lag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return { bpm, confidence: Math.min(1, ac[best] / ac[0]) };
}

export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** 타임라인 프레임 [a, b)의 최대 진폭(0~1)과 RMS */
export function measureLevel(timeline, a, b) {
  const peak = timeline.peakRange(a, b, [0, 0]);
  const chans = Math.min(2, timeline.numberOfChannels);
  const CHUNK = 1 << 18;
  const tmp = new Float32Array(CHUNK);
  let sum = 0;
  for (let pos = a; pos < b; pos += CHUNK) {
    const n = Math.min(CHUNK, b - pos);
    for (let ch = 0; ch < chans; ch++) {
      timeline.copyChannel(ch, pos, pos + n, tmp, 0);
      for (let i = 0; i < n; i++) sum += tmp[i] * tmp[i];
    }
  }
  const count = (b - a) * chans;
  return { peak: Math.max(-peak[0], peak[1]), rms: count ? Math.sqrt(sum / count) : 0 };
}

/**
 * 타임라인 프레임 [a, b)를 gainDb만큼 키운 새 AudioBuffer.
 * limit: 0.98(-0.2 dBFS)을 넘는 부분은 리미터로 눌러 찌그러짐(클리핑)을 막는다.
 */
export function amplify(timeline, a, b, gainDb, { limit = true } = {}) {
  const n = timeline.length;
  const sr = timeline.sampleRate;
  const chans = timeline.numberOfChannels;
  const out = new AudioBuffer({ length: n, numberOfChannels: chans, sampleRate: sr });
  const data = [];
  for (let ch = 0; ch < chans; ch++) {
    data.push(out.getChannelData(ch));
    timeline.copyChannel(ch, 0, n, data[ch]);
  }

  const gain = dbToGain(gainDb);
  const threshold = 0.98;
  const release = Math.exp(-1 / (0.08 * sr));
  let env = 1;
  for (let i = a; i < b; i++) {
    if (limit) {
      let x = 0;
      for (let ch = 0; ch < chans; ch++) x = Math.max(x, Math.abs(data[ch][i]));
      x *= gain;
      const target = x > threshold ? threshold / x : 1;
      // 즉시 줄이고, 천천히 원래대로 회복
      env = target < env ? target : target + (env - target) * release;
    }
    const g = gain * env;
    for (let ch = 0; ch < chans; ch++) {
      const v = data[ch][i] * g;
      data[ch][i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
  return out;
}
