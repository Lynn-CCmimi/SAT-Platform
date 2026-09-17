// What happened the previous times a student did this question.
//
// One attempt row is written each time, so a question done three times has
// three rows. Showing only the latest hides the pattern that matters: was it
// the same mistake twice, or a different one each time, or wrong and then
// right? The strip reads left to right in time; opening it lists each go.

import * as photos from './photos.js?v=77cc52cb';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MARK = { correct: '✓', partial: '△', unknown: '✗' };
const WORD = { correct: '全对', partial: '部分对', unknown: '不会' };
const day = t => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric',
                                                          hour: '2-digit', minute: '2-digit' });

// attempts: this question's rows, newest first (as the app keeps them)
// max:      full marks, or null where unscored
// reasonLabel: k => string
// word:     verdict word per result (SAT says 做对/做错)
// extra:    a => string|null   one more thing to show per go, e.g. the answer given
export function render(el, attempts, { max = null, reasonLabel = k => k,
                                       word = r => WORD[r] || r, extra = () => null } = {}) {
  if (!attempts.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const seq = [...attempts].reverse();      // oldest first
  const face = a => a.marks != null && max != null ? `${a.marks}/${max}` : MARK[a.result] || '?';
  const reasons = a => (a.reasons || []).map(k =>
    k === 'other' && a.reason_note ? '其他：' + a.reason_note : reasonLabel(k));

  el.innerHTML = `
    <details class="hist">
      <summary>
        <span>做过 ${seq.length} 次</span>
        ${seq.map((a, i) => `${i ? '<span class="arrow">→</span>' : ''}
          <span class="step ${a.result}" title="${esc(day(a.created_at))} ${esc(word(a.result))}${
            reasons(a).length ? ' · ' + esc(reasons(a).join('、')) : ''}">${face(a)}<small>${esc(day(a.created_at))}</small></span>`).join('')}
        <span class="hint">点开看每次</span>
      </summary>
      <div data-list></div>
    </details>`;

  const list = el.querySelector('[data-list]');
  el.querySelector('details').addEventListener('toggle', function fill() {
    if (!this.open || list.childElementCount) return;
    list.innerHTML = seq.map((a, i) => `
      <div class="try">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <span class="badge ${a.result === 'correct' ? '' : a.result === 'partial' ? 'w' : 'b'}">第 ${i + 1} 次 · ${
            a.marks != null && max != null ? `${a.marks}/${max} 分` : esc(word(a.result))}</span>
          ${reasons(a).map(r => `<span class="badge g">${esc(r)}</span>`).join('')}
          ${extra(a) ? `<span class="hint">${esc(extra(a))}</span>` : ''}
          <span class="hint" style="margin-left:auto">${when(a.created_at)}</span>
        </div>
        <div data-shots="${a.id}"></div>
      </div>`).join('');
    for (const box of list.querySelectorAll('[data-shots]')) {
      const a = seq.find(x => String(x.id) === box.dataset.shots);
      if (photos.pathsOf(a).length) photos.gallery(box, a);
    }
  });
}
