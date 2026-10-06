// 시간 입력칸 (직접 입력, ▲▼ 버튼 길게 누르기, 방향키, 마우스 휠)
import { formatTime, parseTime } from '../util/time.js';

const STEP = 0.1;

export class TimeField {
  constructor(root, { onChange, getHours }) {
    this.input = root.querySelector('input');
    this.onChange = onChange;
    this.getHours = getHours;
    this.value = 0;

    this.input.addEventListener('focus', () => this.input.select());
    this.input.addEventListener('blur', () => this.commit());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.commit();
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.render(true);
        this.input.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      }
    });
    root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.nudge(e.deltaY < 0 ? 1 : -1);
      },
      { passive: false },
    );

    for (const btn of root.querySelectorAll('[data-dir]')) {
      const dir = Number(btn.dataset.dir);
      let timer = null;
      const stop = () => {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.nudge(dir);
        timer = setTimeout(() => (timer = setInterval(() => this.nudge(dir), 60)), 400);
      });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
    }
  }

  nudge(steps) {
    this.onChange(Math.round((this.value + steps * STEP) * 10) / 10);
    this.render(true);
  }

  commit() {
    const v = parseTime(this.input.value);
    if (Number.isFinite(v) && Math.abs(v - this.value) > 1e-9) this.onChange(v);
    else this.render(true);
  }

  set(value) {
    this.value = value;
    this.render(false);
  }

  render(force) {
    if (!force && document.activeElement === this.input) return;
    this.input.value = formatTime(this.value, { hours: this.getHours() });
  }
}
