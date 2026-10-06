// 선택 구간을 페이드까지 적용해 MP3/WAV Blob으로 만든다.
// 메모리를 아끼려고 청크 단위로 워커에 넘기고, 워커가 처리할 때까지 기다린다.
const CHUNK = 1152 * 128;

export async function exportAudio({ timeline, start, end, env, format, kbps, onProgress, signal }) {
  const sr = timeline.sampleRate;
  const channels = Math.min(2, timeline.numberOfChannels);
  const a = timeline.toFrame(start);
  const b = timeline.toFrame(end);
  const total = b - a;

  const worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' });
  const call = (msg, transfer = []) =>
    new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.type === 'error' ? reject(new Error(data.message)) : resolve(data));
      worker.onerror = (e) => reject(new Error(e.message || '인코더 오류'));
      worker.postMessage(msg, transfer);
    });

  try {
    await call({ type: 'init', format, channels, sampleRate: sr, kbps });
    const tmp = new Float32Array(CHUNK);
    for (let pos = a; pos < b; pos += CHUNK) {
      if (signal?.aborted) throw new DOMException('취소됨', 'AbortError');
      const n = Math.min(CHUNK, b - pos);
      const pcms = [];
      for (let ch = 0; ch < channels; ch++) {
        timeline.copyChannel(ch, pos, pos + n, tmp, 0);
        const pcm = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          let v = tmp[i];
          if (!env.isFlat) v *= env.gainAt((pos + i) / sr);
          v = v < -1 ? -1 : v > 1 ? 1 : v;
          pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        pcms.push(pcm);
      }
      await call({ type: 'chunk', channels: pcms }, pcms.map((p) => p.buffer));
      onProgress?.((pos + n - a) / total);
    }
    const { parts } = await call({ type: 'end' });
    return new Blob(parts, { type: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' });
  } finally {
    worker.terminate();
  }
}
