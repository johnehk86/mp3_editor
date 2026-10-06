// 파형 + 선택 핸들 + 페이드 버튼 + 재생 위치 표시.
// 상태는 app의 state 객체를 직접 읽고, 변경은 handlers를 통해 app에 요청한다.
const PAD = 14; // 좌우 핸들 자리
const MIN_DRAG_PX = 4;

export class WaveformView {
  constructor(root, scrollbar, state, handlers) {
    this.root = root;
    this.state = state;
    this.h = handlers;
    this.canvas = root.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.handleL = root.querySelector('.handle.left');
    this.handleR = root.querySelector('.handle.right');
    this.fadeInBtn = root.querySelector('.fade-btn.in');
    this.fadeOutBtn = root.querySelector('.fade-btn.out');
    this.durLabel = root.querySelector('.sel-duration');
    this.scrollbar = scrollbar;
    this.thumb = scrollbar.querySelector('.thumb');
    this.cache = null;
    this.raf = 0;
    this.drag = null;
    this.peak = [0, 0];

    const css = getComputedStyle(document.documentElement);
    this.colors = {
      wave: css.getPropertyValue('--wave').trim(),
      dim: css.getPropertyValue('--wave-dim').trim(),
      selBg: css.getPropertyValue('--sel-bg').trim(),
      playhead: css.getPropertyValue('--playhead').trim(),
    };

    new ResizeObserver(() => this.resize()).observe(root);
    this.bindPointer();
    this.bindWheel();
    this.bindScrollbar();
    for (const btn of [this.fadeInBtn, this.fadeOutBtn]) {
      btn.addEventListener('click', () => this.h.onToggleFade(btn.dataset.fade));
    }
  }

  get innerWidth() {
    return Math.max(1, this.root.clientWidth - PAD * 2);
  }

  timeToX(t) {
    const { start, end } = this.state.view;
    return PAD + ((t - start) / (end - start)) * this.innerWidth;
  }

  xToTime(x, clampToDuration = true) {
    const { start, end } = this.state.view;
    const t = start + ((x - PAD) / this.innerWidth) * (end - start);
    if (!clampToDuration) return t;
    return Math.min(this.state.timeline.duration, Math.max(0, t));
  }

  localX(e) {
    return e.clientX - this.root.getBoundingClientRect().left;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.innerWidth;
    const h = this.root.clientHeight;
    this.canvas.style.left = `${PAD}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.invalidate();
  }

  /** 타임라인/보기 범위가 바뀌어 파형을 다시 계산해야 할 때 */
  invalidate() {
    this.cache = null;
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  computeColumns() {
    const tl = this.state.timeline;
    const W = this.canvas.width;
    const { start, end } = this.state.view;
    const lo = new Float32Array(W);
    const hi = new Float32Array(W);
    const sr = tl.sampleRate;
    const step = (end - start) / W;
    for (let c = 0; c < W; c++) {
      const f0 = Math.floor((start + c * step) * sr);
      const f1 = Math.min(tl.length, Math.max(f0 + 1, Math.floor((start + (c + 1) * step) * sr)));
      tl.peakRange(f0, f1, this.peak);
      lo[c] = this.peak[0];
      hi[c] = this.peak[1];
    }
    this.cache = { lo, hi };
  }

  draw() {
    const { timeline: tl, view, sel } = this.state;
    if (!tl || this.canvas.width === 0) return;
    if (!this.cache) this.computeColumns();

    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const span = view.end - view.start;
    const step = span / W;
    const mid = H / 2;
    const amp = (H * 0.36) / Math.max(0.25, tl.source.peaks.absMax);
    const env = this.h.getEnvelope();
    const { lo, hi } = this.cache;

    g.clearRect(0, 0, W, H);

    const sx = Math.max(0, ((sel.start - view.start) / span) * W);
    const ex = Math.min(W, ((sel.end - view.start) / span) * W);
    if (ex > sx) {
      g.fillStyle = this.colors.selBg;
      g.fillRect(sx, 0, ex - sx, H);
    }

    // 선택 밖 (흐리게)
    g.fillStyle = this.colors.dim;
    for (let c = 0; c < W; c++) {
      if (c >= sx && c < ex) continue;
      const top = mid - hi[c] * amp;
      g.fillRect(c, top, 1, Math.max(1, (hi[c] - lo[c]) * amp));
    }
    // 선택 안 (페이드 곡선 반영)
    g.fillStyle = this.colors.wave;
    for (let c = Math.floor(sx); c < ex; c++) {
      const gain = env.isFlat ? 1 : env.gainAt(view.start + (c + 0.5) * step);
      const top = mid - hi[c] * amp * gain;
      g.fillRect(c, top, 1, Math.max(1, (hi[c] - lo[c]) * amp * gain));
    }

    // 재생 위치
    const cursor = this.state.cursor;
    if (cursor >= view.start && cursor <= view.end) {
      const cx = ((cursor - view.start) / span) * W;
      g.fillStyle = this.colors.playhead;
      g.fillRect(Math.round(cx - dpr / 2), 0, Math.max(1, Math.round(dpr * 1.5)), H);
    }

    this.layoutOverlays();
  }

  layoutOverlays() {
    const { sel, view, timeline } = this.state;
    const iw = this.innerWidth;
    const xs = this.timeToX(sel.start);
    const xe = this.timeToX(sel.end);
    const visible = (x) => x >= PAD - 0.5 && x <= PAD + iw + 0.5;

    this.handleL.style.display = visible(xs) ? '' : 'none';
    this.handleL.style.transform = `translateX(${xs - PAD}px)`;
    this.handleR.style.display = visible(xe) ? '' : 'none';
    this.handleR.style.transform = `translateX(${xe}px)`;

    const wide = xe - xs > 110;
    this.fadeInBtn.style.display = wide && visible(xs) ? '' : 'none';
    this.fadeInBtn.style.transform = `translateX(${xs + 10}px)`;
    this.fadeOutBtn.style.display = wide && visible(xe) ? '' : 'none';
    this.fadeOutBtn.style.transform = `translateX(${xe - 10 - this.fadeOutBtn.offsetWidth}px)`;

    const l = Math.max(xs, PAD);
    const r = Math.min(xe, PAD + iw);
    this.durLabel.style.display = r - l > 60 ? '' : 'none';
    this.durLabel.style.transform = `translateX(${(l + r) / 2}px) translateX(-50%)`;

    // 스크롤바
    const dur = timeline.duration;
    const zoomed = view.end - view.start < dur - 1e-6;
    this.scrollbar.hidden = !zoomed;
    if (zoomed) {
      this.thumb.style.left = `${(view.start / dur) * 100}%`;
      this.thumb.style.width = `${Math.max(1, ((view.end - view.start) / dur) * 100)}%`;
    }
  }

  bindPointer() {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      if (!this.state.timeline || e.button !== 0 || e.target.closest('.fade-btn')) return;
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      const handle = e.target.closest('.handle');
      const x = this.localX(e);
      this.drag = handle ? { mode: handle.dataset.side } : { mode: 'pending', x0: x, t0: this.xToTime(x) };
      root.classList.add('dragging');
    });

    root.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const x = this.localX(e);
      const t = this.xToTime(x);
      const { sel } = this.state;
      if (d.mode === 'left') this.h.onSelect(t, sel.end, { final: false, edge: 'start' });
      else if (d.mode === 'right') this.h.onSelect(sel.start, t, { final: false, edge: 'end' });
      else {
        if (d.mode === 'pending' && Math.abs(x - d.x0) > MIN_DRAG_PX) d.mode = 'create';
        if (d.mode === 'create') {
          this.h.onSelect(Math.min(d.t0, t), Math.max(d.t0, t), { final: false, edge: 'start' });
        }
      }
    });

    const end = () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      root.classList.remove('dragging');
      if (d.mode === 'pending') this.h.onSeek(d.t0);
      else this.h.onSelect(this.state.sel.start, this.state.sel.end, { final: true });
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }

  bindWheel() {
    this.root.addEventListener(
      'wheel',
      (e) => {
        const tl = this.state.timeline;
        if (!tl) return;
        e.preventDefault();
        const { start, end } = this.state.view;
        const span = end - start;
        const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (horizontal) {
          const delta = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
          const dt = (delta / this.innerWidth) * span;
          this.h.onView(start + dt, end + dt);
        } else {
          const t = this.xToTime(this.localX(e), false);
          const newSpan = span * Math.exp(e.deltaY * 0.002);
          const ns = t - ((t - start) * newSpan) / span;
          this.h.onView(ns, ns + newSpan);
        }
      },
      { passive: false },
    );
  }

  bindScrollbar() {
    let drag = null;
    this.thumb.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.thumb.setPointerCapture(e.pointerId);
      drag = { x0: e.clientX, view: { ...this.state.view } };
    });
    this.thumb.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dt = ((e.clientX - drag.x0) / this.scrollbar.clientWidth) * this.state.timeline.duration;
      this.h.onView(drag.view.start + dt, drag.view.end + dt);
    });
    const stop = () => (drag = null);
    this.thumb.addEventListener('pointerup', stop);
    this.thumb.addEventListener('pointercancel', stop);

    this.scrollbar.addEventListener('pointerdown', (e) => {
      if (e.target === this.thumb) return;
      const rect = this.scrollbar.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * this.state.timeline.duration;
      const span = this.state.view.end - this.state.view.start;
      this.h.onView(t - span / 2, t + span / 2);
    });
  }
}
