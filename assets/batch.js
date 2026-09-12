// Scoring a whole set in one go, shared by every exam board that self-marks.
//
// A student who printed a set and worked on paper comes back with a page of
// marks, not with ten separate moments to stop and reflect. This takes the
// marks as a table; the site turns each row into the same attempt record the
// one-at-a-time flow would have written. Reasons and photos can be added
// afterwards, question by question, for the ones that lost marks.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// items: [{ id, label, max, prev }]  prev = marks already recorded, if any
// onSave(entries) -> entries: [{ id, marks, max }] for the rows that were filled
export function render(el, { items, onSave, onCancel }) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="qhead">
        <h2>整套录分</h2>
        <span class="hint">对照答案，每题填拿了几分；没做的留空</span>
        <span class="spacer"></span>
        <button class="plain" data-fill>全部满分</button>
      </div>
      <table><thead><tr><th style="width:8%">题</th><th>题目</th><th style="width:12%">满分</th><th style="width:22%">得分</th></tr></thead>
      <tbody>${items.map((it, i) => `
        <tr>
          <td><strong>Q${i + 1}</strong></td>
          <td class="hint">${esc(it.label)}</td>
          <td>${it.max}</td>
          <td><input class="spr" type="number" inputmode="numeric" min="0" max="${it.max}"
                     data-id="${esc(it.id)}" value="${it.prev ?? ''}"
                     style="width:76px;padding:6px 8px;text-align:center"></td>
        </tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:14px">
        <button class="act" data-save>保存</button>
        <button class="plain" data-cancel>取消</button>
        <span class="hint" data-sum></span>
      </div>
    </div>`;

  const inputs = [...el.querySelectorAll('input[data-id]')];
  const byId = new Map(items.map(it => [it.id, it]));
  const clamp = inp => {
    if (inp.value === '') return;
    const max = byId.get(inp.dataset.id).max;
    inp.value = Math.max(0, Math.min(max, Math.round(Number(inp.value) || 0)));
  };
  const sum = () => {
    let got = 0, max = 0, n = 0;
    for (const inp of inputs) {
      if (inp.value === '') continue;
      n += 1; got += Number(inp.value); max += byId.get(inp.dataset.id).max;
    }
    el.querySelector('[data-sum]').textContent = n
      ? `已填 ${n} / ${items.length} 题，${got} / ${max} 分` : '';
  };
  for (const inp of inputs) {
    inp.oninput = sum;
    inp.onchange = () => { clamp(inp); sum(); };
    // Enter moves down the column, like a spreadsheet
    inp.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = inputs[inputs.indexOf(inp) + 1];
        next ? next.focus() : el.querySelector('[data-save]').click();
      }
    };
  }
  el.querySelector('[data-fill]').onclick = () => {
    for (const inp of inputs) if (inp.value === '') inp.value = byId.get(inp.dataset.id).max;
    sum();
  };
  el.querySelector('[data-cancel]').onclick = () => onCancel?.();
  el.querySelector('[data-save]').onclick = async () => {
    for (const inp of inputs) clamp(inp);
    const entries = inputs.filter(i => i.value !== '')
      .map(i => ({ id: i.dataset.id, marks: Number(i.value), max: byId.get(i.dataset.id).max }));
    if (!entries.length) return onSave([]);
    const btn = el.querySelector('[data-save]');
    btn.disabled = true;
    try { await onSave(entries); } finally { btn.disabled = false; }
  };
  sum();
  inputs.find(i => i.value === '')?.focus();
}

// After saving: the questions that lost marks, each a way back into the
// notebook to add a reason or a photo. Optional, never required.
export function renderFollowUp(el, { lost, onOpen }) {
  if (!lost.length) {
    el.innerHTML = '<div class="card" style="margin-bottom:12px"><div class="hint">全部满分，没有需要补充的。</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="qhead"><h2>丢分的题</h2>
        <span class="hint">愿意的话，点进去标一下错因、拍张订正照片</span></div>
      <div class="picks">${lost.map(x =>
        `<button class="pick" data-a="${x.attemptId}">${esc(x.label)} · 丢 ${x.lost} 分</button>`).join('')}</div>
    </div>`;
  for (const b of el.querySelectorAll('[data-a]')) b.onclick = () => onOpen(Number(b.dataset.a));
}
