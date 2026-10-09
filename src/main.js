import './style.css';
import { Peaks } from './audio/peaks.js';
import { Timeline } from './audio/timeline.js';
import { Player } from './audio/player.js';
import { makeEnvelope } from './audio/envelope.js';
import { exportAudio } from './audio/exporter.js';
import { removeVocals, detectBpm, amplify, measureLevel, gainToDb } from './audio/tools.js';
import { WaveformView } from './ui/waveform.js';
import { TimeField } from './ui/timeField.js';
import { formatTime, clamp } from './util/time.js';
import { isNative, initAds, maybeShowInterstitial, saveToDevice } from './native.js';

const MIN_SEL = 0.1; // 최소 선택 길이(초)
const MIN_VIEW = 0.05; // 최대 확대 시 화면 폭(초)
const HISTORY_LIMIT = 50;

const $ = (sel) => document.querySelector(sel);
const els = {
  app: $('#app'),
  dropzone: $('#dropzone'),
  editor: $('#editor'),
  fileInput: $('#fileInput'),
  closeBtn: $('#closeBtn'),
  fileName: $('#fileName'),
  selDuration: $('#selDuration'),
  viewStartLabel: $('#viewStartLabel'),
  viewEndLabel: $('#viewEndLabel'),
  trimBtn: $('#trimBtn'),
  deleteBtn: $('#deleteBtn'),
  undoBtn: $('#undoBtn'),
  redoBtn: $('#redoBtn'),
  playBtn: $('#playBtn'),
  formatBtn: $('#formatBtn'),
  formatLabel: $('#formatLabel'),
  formatMenu: $('#formatMenu'),
  saveBtn: $('#saveBtn'),
  busy: $('#busy'),
  busyText: $('#busyText'),
  progress: $('#progress'),
  cancelBtn: $('#cancelBtn'),
  help: $('#help'),
  toast: $('#toast'),
  fadeLen: $('#fadeLen'),
  keepBass: $('#keepBass'),
  bpmValue: $('#bpmValue'),
  bpmNote: $('#bpmNote'),
  gainRange: $('#gainRange'),
  gainValue: $('#gainValue'),
  levelInfo: $('#levelInfo'),
  limitCheck: $('#limitCheck'),
};

const state = {
  ctx: null,
  player: null,
  timeline: null,
  fileName: '',
  sel: { start: 0, end: 0 },
  cursor: 0,
  view: { start: 0, end: 1 },
  fade: { in: false, out: false, len: 2 },
  format: 'mp3',
  kbps: 192,
  tool: 'cut',
  undo: [],
  redo: [],
};

const envelope = () => makeEnvelope(state.sel, state.fade);
const useHours = () => (state.timeline?.duration ?? 0) >= 3600;
const fmt = (t) => formatTime(t, { hours: useHours() });
const isPlaying = () => state.player?.playing ?? false;
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

// ---------- 컴포넌트 ----------
const waveform = new WaveformView($('#wave'), $('#scrollbar'), state, {
  getEnvelope: envelope,
  onSeek: seek,
  onSelect: (start, end, opts) => setSelection(start, end, opts),
  onView: setView,
  onToggleFade: (which) => {
    state.fade[which] = !state.fade[which];
    afterSelectionChange(true);
  },
});

const startField = new TimeField($('#startField'), {
  getHours: useHours,
  onChange: (v) => setSelection(v, state.sel.end, { final: true, edge: 'start', reveal: true }),
});
const endField = new TimeField($('#endField'), {
  getHours: useHours,
  onChange: (v) => setSelection(state.sel.start, v, { final: true, edge: 'end', reveal: true }),
});

// ---------- 파일 ----------
function ensureAudio() {
  if (state.ctx) return;
  try {
    state.ctx = new AudioContext({ sampleRate: 44100 });
  } catch {
    state.ctx = new AudioContext();
  }
  state.player = new Player(state.ctx);
}

async function loadFile(file) {
  if (!file) return;
  if (state.timeline && state.undo.length && !confirm('편집 중인 내용을 버리고 새 파일을 열까요?')) return;
  ensureAudio();
  stop();
  showBusy('파일을 불러오는 중…');
  try {
    const data = await file.arrayBuffer();
    const buffer = await state.ctx.decodeAudioData(data);
    showBusy('파형을 분석하는 중…');
    await nextFrame();
    const peaks = new Peaks(buffer);
    const timeline = Timeline.fromBuffer(buffer, peaks);

    Object.assign(state, {
      timeline,
      fileName: file.name,
      sel: { start: 0, end: timeline.duration },
      cursor: 0,
      view: { start: 0, end: timeline.duration },
      undo: [],
      redo: [],
    });
    els.fileName.textContent = file.name;
    els.fileName.title = `${file.name} · ${buffer.numberOfChannels === 1 ? '모노' : '스테레오'} · ${buffer.sampleRate} Hz`;
    els.bpmValue.textContent = '--';
    els.dropzone.hidden = true;
    els.editor.hidden = false;
    els.closeBtn.hidden = false;
    waveform.resize();
    syncUI();
  } catch (err) {
    console.error(err);
    toast('이 파일을 열 수 없어요. 지원되는 오디오 형식인지 확인해 주세요.');
  } finally {
    hideBusy();
    els.fileInput.value = '';
  }
}

function closeFile() {
  if (state.undo.length && !confirm('편집 중인 내용을 버리고 파일을 닫을까요?')) return;
  stop();
  state.timeline = null;
  state.undo = [];
  state.redo = [];
  els.editor.hidden = true;
  els.closeBtn.hidden = true;
  els.dropzone.hidden = false;
}

// ---------- 선택 / 보기 ----------
function setSelection(start, end, { final = true, edge = null, reveal = false } = {}) {
  const tl = state.timeline;
  if (!tl) return;
  const dur = tl.duration;
  const minLen = Math.min(MIN_SEL, dur);
  start = clamp(start, 0, dur);
  end = clamp(end, 0, dur);
  if (end - start < minLen) {
    if (edge === 'end') end = Math.min(dur, start + minLen);
    else start = Math.max(0, end - minLen);
    if (end - start < minLen) end = Math.min(dur, start + minLen);
  }
  state.sel = { start, end };

  if (!isPlaying() && (edge === 'start' || state.cursor < start || state.cursor > end)) {
    state.cursor = start;
  }
  if (reveal) revealTime(edge === 'end' ? end : start);
  afterSelectionChange(final);
}

function afterSelectionChange(final) {
  syncUI();
  // 재생 중이면 바뀐 구간 기준으로 이어서 재생
  if (final && isPlaying()) startPlayback(state.player.position);
}

function setView(start, end) {
  const tl = state.timeline;
  if (!tl) return;
  const dur = tl.duration;
  const span = clamp(end - start, Math.min(MIN_VIEW, dur), dur);
  const s = clamp(start, 0, dur - span);
  state.view = { start: s, end: s + span };
  waveform.invalidate();
  syncScale();
}

function zoom(factor) {
  const { start, end } = state.view;
  const center = isPlaying() || (state.cursor >= start && state.cursor <= end) ? state.cursor : (start + end) / 2;
  const span = (end - start) * factor;
  setView(center - span / 2, center + span / 2);
}

/** t가 화면 밖이면 보이도록 이동 */
function revealTime(t) {
  const { start, end } = state.view;
  if (t >= start && t <= end) return;
  const span = end - start;
  setView(t - span * 0.1, t + span * 0.9);
}

// ---------- 재생 ----------
function seek(t) {
  state.cursor = t;
  if (isPlaying()) startPlayback(t);
  else waveform.requestDraw();
}

function startPlayback(from) {
  const { sel } = state;
  if (!(from >= sel.start && from < sel.end - 0.05)) from = sel.start;
  state.ctx.resume();
  state.player.play(state.timeline, from, sel.end, envelope(), () => {
    state.cursor = state.sel.start;
    syncUI();
  });
  state.cursor = from;
  syncUI();
  requestAnimationFrame(tick);
}

function stop() {
  if (!isPlaying()) return;
  state.cursor = state.player.position;
  state.player.stop();
  syncUI();
}

function togglePlay() {
  if (!state.timeline) return;
  if (isPlaying()) stop();
  else startPlayback(state.cursor);
}

function tick() {
  if (!isPlaying()) return;
  state.cursor = state.player.position;
  // 확대 상태에서 재생 위치가 화면을 벗어나면 다음 화면으로 넘김
  const { start, end } = state.view;
  if (state.cursor > end || state.cursor < start) {
    const span = end - start;
    setView(state.cursor - span * 0.05, state.cursor + span * 0.95);
  }
  waveform.requestDraw();
  requestAnimationFrame(tick);
}

// ---------- 편집 / 기록 ----------
function snapshot() {
  return { timeline: state.timeline, sel: { ...state.sel } };
}

function restore(entry, { keepView = false } = {}) {
  stop();
  state.timeline = entry.timeline;
  state.sel = { ...entry.sel };
  state.cursor = entry.sel.start;
  if (keepView) setView(state.view.start, state.view.end);
  else setView(0, entry.timeline.duration);
  syncUI();
}

function commit(timeline, sel, opts) {
  state.undo.push(snapshot());
  if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
  state.redo = [];
  restore({ timeline, sel }, opts);
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  restore(state.undo.pop());
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  restore(state.redo.pop());
}

const isWholeSelection = () => state.sel.start <= 0.001 && state.sel.end >= state.timeline.duration - 0.001;

function trim() {
  const tl = state.timeline;
  if (!tl) return;
  if (isWholeSelection()) return toast('파일 전체가 선택되어 있어요. 남길 구간을 먼저 골라 주세요.');
  const next = tl.slice(tl.toFrame(state.sel.start), tl.toFrame(state.sel.end));
  commit(next, { start: 0, end: next.duration });
  toast('선택 구간만 남겼어요.');
}

function removeSelection() {
  const tl = state.timeline;
  if (!tl) return;
  if (isWholeSelection()) return toast('파일 전체는 제거할 수 없어요.');
  const next = tl.remove(tl.toFrame(state.sel.start), tl.toFrame(state.sel.end));
  if (next.duration < MIN_SEL) return toast('남는 길이가 너무 짧아요.');
  const at = Math.min(state.sel.start, next.duration);
  commit(next, { start: 0, end: next.duration });
  state.cursor = at;
  waveform.requestDraw();
  toast('선택 구간을 제거했어요.');
}

// ---------- 도구 ----------
async function applyVocalRemoval() {
  const tl = state.timeline;
  if (!tl) return;
  if (tl.numberOfChannels < 2) return toast('보컬 제거는 스테레오 파일에서만 동작해요.');
  stop();
  showBusy('보컬을 제거하는 중…');
  await nextFrame();
  try {
    const buffer = removeVocals(tl, { keepBass: els.keepBass.checked });
    showBusy('파형을 분석하는 중…');
    await nextFrame();
    commit(Timeline.fromBuffer(buffer, new Peaks(buffer)), { ...state.sel }, { keepView: true });
    toast('보컬 제거를 적용했어요. 마음에 들지 않으면 실행 취소하세요.');
  } catch (err) {
    console.error(err);
    toast(err.message || '처리하지 못했어요.');
  } finally {
    hideBusy();
  }
}

// 볼륨 증폭
const VOICE_TARGET_DB = -18; // 음성 평균 음량 목표 (dBFS RMS)
const PEAK_TARGET_DB = -1;

function selectionFrames() {
  const tl = state.timeline;
  return [tl.toFrame(state.sel.start), tl.toFrame(state.sel.end)];
}

function setGainDb(db) {
  const v = clamp(Math.round(db * 2) / 2, Number(els.gainRange.min), Number(els.gainRange.max));
  els.gainRange.value = String(v);
  els.gainValue.textContent = `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  return v;
}

function syncLevelInfo() {
  if (!state.timeline || state.tool !== 'gain') return;
  const [a, b] = selectionFrames();
  const p = state.timeline.peakRange(a, b, [0, 0]);
  const peakDb = gainToDb(Math.max(-p[0], p[1]));
  els.levelInfo.textContent = `선택 구간 최대 ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : '-∞'} dB`;
}

async function applyGain(db, message) {
  const tl = state.timeline;
  if (!tl) return;
  if (Math.abs(db) < 0.05) return toast('증폭량이 0 dB예요.');
  stop();
  showBusy('볼륨을 조절하는 중…');
  await nextFrame();
  try {
    const [a, b] = selectionFrames();
    const buffer = amplify(tl, a, b, db, { limit: els.limitCheck.checked });
    showBusy('파형을 분석하는 중…');
    await nextFrame();
    commit(Timeline.fromBuffer(buffer, new Peaks(buffer)), { ...state.sel }, { keepView: true });
    syncLevelInfo();
    toast(message ?? `선택 구간을 ${db > 0 ? '+' : ''}${db.toFixed(1)} dB 조절했어요.`);
  } catch (err) {
    console.error(err);
    toast(err.message || '처리하지 못했어요.');
  } finally {
    hideBusy();
  }
}

async function autoGain(mode) {
  const tl = state.timeline;
  if (!tl) return;
  showBusy('음량을 측정하는 중…');
  await nextFrame();
  const [a, b] = selectionFrames();
  const { peak, rms } = measureLevel(tl, a, b);
  hideBusy();
  if (peak < 1e-5) return toast('선택 구간이 무음이에요.');

  if (mode === 'voice') {
    // 평균 음량을 목표치로. 튀는 소리는 리미터가 잡는다.
    els.limitCheck.checked = true;
    const db = setGainDb(VOICE_TARGET_DB - gainToDb(rms));
    if (db < 0.5) return toast('이미 충분히 큰 소리예요.');
    applyGain(db, `작은 음성을 +${db.toFixed(1)} dB 키웠어요.`);
  } else {
    const db = setGainDb(PEAK_TARGET_DB - gainToDb(peak));
    if (Math.abs(db) < 0.5) return toast('이미 최대치에 가까워요.');
    applyGain(db, `최대치에 맞춰 ${db > 0 ? '+' : ''}${db.toFixed(1)} dB 조절했어요.`);
  }
}

async function analyzeBpm() {
  if (!state.timeline) return;
  showBusy('템포를 분석하는 중…');
  await nextFrame();
  try {
    const res = detectBpm(state.timeline, state.sel.start, state.sel.end);
    if (!res) {
      els.bpmValue.textContent = '--';
      els.bpmNote.textContent = '6초 이상의 구간을 선택해 주세요.';
      return;
    }
    els.bpmValue.textContent = res.bpm.toFixed(1);
    const level = res.confidence > 0.35 ? '높음' : res.confidence > 0.15 ? '보통' : '낮음';
    els.bpmNote.textContent = `신뢰도 ${level} · 반/두 배일 수 있어요`;
  } finally {
    hideBusy();
  }
}

const taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 9) taps.shift();
  if (taps.length < 2) {
    els.bpmNote.textContent = '박자에 맞춰 계속 눌러 주세요…';
    return;
  }
  const bpm = (60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]);
  els.bpmValue.textContent = bpm.toFixed(1);
  els.bpmNote.textContent = `탭 ${taps.length}회 평균`;
}

function selectTool(tool) {
  state.tool = tool;
  for (const btn of document.querySelectorAll('.tools .tool')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  for (const panel of document.querySelectorAll('.tool-panel')) {
    panel.hidden = panel.dataset.panel !== tool;
  }
  syncLevelInfo();
}

// ---------- 저장 ----------
let exportAbort = null;

async function save() {
  const tl = state.timeline;
  if (!tl || exportAbort) return;
  stop();
  exportAbort = new AbortController();
  const label = state.format === 'mp3' ? `MP3 ${state.kbps}kbps` : 'WAV';
  showBusy(`${label}로 저장하는 중… 0%`, { progress: 0, cancellable: true });
  try {
    const blob = await exportAudio({
      timeline: tl,
      start: state.sel.start,
      end: state.sel.end,
      env: envelope(),
      format: state.format,
      kbps: state.kbps,
      signal: exportAbort.signal,
      onProgress: (p) => showBusy(`${label}로 저장하는 중… ${Math.floor(p * 100)}%`, { progress: p, cancellable: true }),
    });
    const base = state.fileName.replace(/\.[^.]+$/, '') || 'audio';
    const name = `${base}_편집.${state.format}`;
    const size = `${(blob.size / 1024 / 1024).toFixed(1)} MB`;
    if (isNative) {
      showBusy('기기에 저장하는 중…', { progress: 0 });
      const where = await saveToDevice(blob, name, (p) => showBusy('기기에 저장하는 중…', { progress: p }));
      hideBusy();
      toast(`${where}에 저장했어요 (${size})`);
      maybeShowInterstitial();
    } else {
      download(blob, name);
      toast(`저장했어요 (${size})`);
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('저장을 취소했어요.');
    else {
      console.error(err);
      toast(`저장하지 못했어요: ${err.message}`);
    }
  } finally {
    exportAbort = null;
    hideBusy();
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- UI 동기화 ----------
function syncUI() {
  const tl = state.timeline;
  if (!tl) return;
  startField.set(state.sel.start);
  endField.set(state.sel.end);
  els.selDuration.textContent = fmt(state.sel.end - state.sel.start);
  els.playBtn.classList.toggle('playing', isPlaying());
  els.undoBtn.disabled = !state.undo.length;
  els.redoBtn.disabled = !state.redo.length;
  for (const btn of document.querySelectorAll('.fade-btn')) {
    btn.classList.toggle('active', state.fade[btn.dataset.fade]);
  }
  syncScale();
  syncLevelInfo();
  waveform.requestDraw();
}

function syncScale() {
  els.viewStartLabel.textContent = fmt(state.view.start);
  els.viewEndLabel.textContent = fmt(state.view.end);
}

function syncFormat() {
  els.formatLabel.textContent = state.format;
  for (const b of els.formatMenu.querySelectorAll('button')) {
    const on = b.dataset.format === state.format && (state.format === 'wav' || Number(b.dataset.kbps) === state.kbps);
    b.setAttribute('aria-checked', String(on));
  }
}

function showBusy(text, { progress = null, cancellable = false } = {}) {
  els.busy.hidden = false;
  els.busyText.textContent = text;
  els.progress.hidden = progress === null;
  if (progress !== null) els.progress.firstElementChild.style.width = `${progress * 100}%`;
  els.cancelBtn.hidden = !cancellable;
}

function hideBusy() {
  els.busy.hidden = true;
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ---------- 이벤트 ----------
$('#openBtn').addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => loadFile(els.fileInput.files[0]));
els.closeBtn.addEventListener('click', closeFile);

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('drag-over');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('drag-over');
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});

els.playBtn.addEventListener('click', togglePlay);
$('#toStartBtn').addEventListener('click', () => seek(state.sel.start));
$('#zoomInBtn').addEventListener('click', () => zoom(0.5));
$('#zoomOutBtn').addEventListener('click', () => zoom(2));
els.trimBtn.addEventListener('click', trim);
els.deleteBtn.addEventListener('click', removeSelection);
els.undoBtn.addEventListener('click', undo);
els.redoBtn.addEventListener('click', redo);
els.saveBtn.addEventListener('click', save);
els.cancelBtn.addEventListener('click', () => exportAbort?.abort());
els.fadeLen.addEventListener('change', () => {
  state.fade.len = Number(els.fadeLen.value);
  afterSelectionChange(true);
});
$('#vocalBtn').addEventListener('click', applyVocalRemoval);
$('#bpmBtn').addEventListener('click', analyzeBpm);
$('#tapBtn').addEventListener('click', tapTempo);
els.gainRange.addEventListener('input', () => setGainDb(Number(els.gainRange.value)));
$('#gainApplyBtn').addEventListener('click', () => applyGain(Number(els.gainRange.value)));
$('#voiceAutoBtn').addEventListener('click', () => autoGain('voice'));
$('#normalizeBtn').addEventListener('click', () => autoGain('peak'));

for (const btn of document.querySelectorAll('.tools .tool')) {
  btn.addEventListener('click', () => selectTool(btn.dataset.tool));
}
$('#menuBtn').addEventListener('click', () => {
  els.app.classList.toggle('collapsed');
  if (state.timeline) waveform.resize();
});
$('#helpBtn').addEventListener('click', () => (els.help.hidden = false));
els.help.addEventListener('click', (e) => {
  if (e.target === els.help || e.target.closest('[data-close]')) els.help.hidden = true;
});

els.formatBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  els.formatMenu.hidden = !els.formatMenu.hidden;
});
els.formatMenu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.format = b.dataset.format;
  if (b.dataset.kbps) state.kbps = Number(b.dataset.kbps);
  syncFormat();
  els.formatMenu.hidden = true;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.format-wrap')) els.formatMenu.hidden = true;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.help.hidden = true;
    els.formatMenu.hidden = true;
  }
  if (!state.timeline || !els.busy.hidden) return;
  if (e.target.closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'z' && !e.shiftKey) undo();
  else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
  else if (mod && key === 's') save();
  else if (e.key === ' ') {
    if (e.target.closest('button')) e.target.blur();
    togglePlay();
  } else if (e.key === 'Home') seek(state.sel.start);
  else if (e.key === 'Delete') removeSelection();
  else if (e.key === '+' || e.key === '=') zoom(0.5);
  else if (e.key === '-') zoom(2);
  else return;
  e.preventDefault();
});

window.addEventListener('beforeunload', (e) => {
  if (state.undo.length) e.preventDefault();
});

// ---------- 안드로이드 앱: 광고 ----------
if (isNative) {
  document.documentElement.classList.add('native');
  // 하단 배너 높이만큼 화면을 비워 둔다
  initAds({ onBannerHeight: (h) => document.documentElement.style.setProperty('--ad-height', `${h}px`) });
}

// ---------- 앱 설치 (PWA) ----------
// 서비스 워커는 빌드된 웹 배포본에서만 등록 (개발 서버에서는 캐시가 방해되고, 안드로이드 앱은 필요 없음)
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

let installPrompt = null;
const installBtn = $('#installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installBtn.hidden = true;
  toast('앱으로 설치했어요. 바탕화면이나 시작 메뉴에서 열 수 있어요.');
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});

// 설치된 앱에서 "연결 프로그램"으로 오디오 파일을 열었을 때
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (files?.length) loadFile(await files[0].getFile());
  });
}

syncFormat();
