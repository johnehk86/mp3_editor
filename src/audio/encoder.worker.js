// 인코딩 워커: 16bit PCM 청크를 받아 MP3 또는 WAV 바이트로 만든다.
import { Mp3Encoder } from '@breezystack/lamejs';

let format;
let channels;
let sampleRate;
let encoder;
let parts;
let dataBytes;

function wavHeader(bytes) {
  const view = new DataView(new ArrayBuffer(44));
  const writeStr = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, bytes, true);
  return view.buffer;
}

const copyBytes = (out) => new Uint8Array(out.buffer, out.byteOffset, out.length).slice();

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      ({ format, channels, sampleRate } = data);
      parts = [];
      dataBytes = 0;
      if (format === 'mp3') encoder = new Mp3Encoder(channels, sampleRate, data.kbps);
    } else if (data.type === 'chunk') {
      const [left, right] = data.channels;
      if (format === 'mp3') {
        const out = channels === 2 ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
        if (out.length) parts.push(copyBytes(out));
      } else {
        const pcm = new Int16Array(left.length * channels);
        if (channels === 2) {
          for (let i = 0; i < left.length; i++) {
            pcm[i * 2] = left[i];
            pcm[i * 2 + 1] = right[i];
          }
        } else {
          pcm.set(left);
        }
        parts.push(pcm.buffer);
        dataBytes += pcm.byteLength;
      }
    } else if (data.type === 'end') {
      if (format === 'mp3') {
        const out = encoder.flush();
        if (out.length) parts.push(copyBytes(out));
      } else {
        parts.unshift(wavHeader(dataBytes));
      }
      self.postMessage({ type: 'done', parts });
      return;
    }
    self.postMessage({ type: 'ok' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
