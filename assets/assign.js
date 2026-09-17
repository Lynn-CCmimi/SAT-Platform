// Teacher-set practice, shared by every exam board.
//
// The boards filter questions along different dimensions - A-Level by unit and
// topic, SAT by domain, skill and difficulty - so each site passes in a `facets`
// description and everything here stays board-agnostic. Adding a board means
// writing that description, not another picker.
//
// facets: [{ id, name, values: q => string[], display: v => string, order? }]
//         values() returns every value a question belongs to, so a question
//         covering three topics shows up under all three.
// label:   q => string     main line in the question list
// note:    q => string     short right-hand note, e.g. difficulty
// preview: q => string[]   image urls, so the teacher picks by seeing the question

import * as db from './db.js?v=77cc52cb';
import * as pdf from './pdf.js?v=77cc52cb';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- progress

// Doing the question is what completes it, so progress is read out of attempts
// rather than tracked separately. Only work done inside the assignment counts:
// the student app stamps `assignment_id` on those rows, so a question
// practised on one's own beforehand is still owed.
//
// Rows from before the stamp existed have no id. For those, being made after
// the assignment was set is the best available sign; the cut-off keeps this
// guess from ever applying to newer rows, which are stamped or not.
const STAMPED_SINCE = '2026-09-17T01:16:54Z';

export function belongs(assignment, a) {
  if (a.assignment_id != null) return a.assignment_id === assignment.id;
  return a.created_at < STAMPED_SINCE
    && a.created_at >= assignment.created_at
    && assignment.question_ids.includes(a.question_id);
}

// The attempts made in an assignment, newest first, optionally for one student.
export function attemptsIn(assignment, attempts, studentId) {
  return attempts.filter(a =>
    (!studentId || a.student_id === studentId) && belongs(assignment, a));
}

// A question answered twice still counts once; its latest attempt speaks.
export function progressOf(assignment, attempts, studentId) {
  const done = new Set();
  let right = 0;
  for (const a of attemptsIn(assignment, attempts, studentId)) {
    if (done.has(a.question_id)) continue;
    done.add(a.question_id);
    if (a.result === 'correct') right += 1;
  }
  return { done: done.size, total: assignment.question_ids.length, right };
}

const dueLabel = d => {
  if (!d) return '';
  const days = Math.round((new Date(d + 'T23:59:59') - Date.now()) / 86400000);
  if (days < 0) return `已过期 ${-days} 天`;
  return days === 0 ? '今天截止' : `还有 ${days} 天`;
};

function gauge(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="row" style="gap:8px">
    <div class="bar-gauge" style="flex:1"><span style="width:${pct}%"></span></div>
    <span class="hint">${done}/${total}</span></div>`;
}

// ------------------------------------------------------------ student view

export function renderStudentList(el, { assignments, attempts, onOpen }) {
  if (!assignments.length) {
    el.innerHTML = '<div class="empty">老师还没有布置作业</div>';
    return;
  }
  const rows = assignments.map(a => {
    const p = progressOf(a, attempts);
    const finished = p.done >= p.total;
    return { a, p, finished };
  });
  // unfinished first, then by due date, then newest
  rows.sort((x, y) => x.finished - y.finished
    || (x.a.due_on || '9999').localeCompare(y.a.due_on || '9999')
    || y.a.id - x.a.id);

  el.innerHTML = rows.map(({ a, p, finished }) => `
    <div class="card" style="margin-bottom:10px">
      <div class="qhead">
        <h2>${esc(a.title)}</h2>
        ${finished ? '<span class="badge">已完成</span>'
                   : `<span class="badge w">还差 ${p.total - p.done} 道</span>`}
        ${a.due_on ? `<span class="badge g">${esc(dueLabel(a.due_on))}</span>` : ''}
      </div>
      ${gauge(p.done, p.total)}
      <div class="row" style="margin-top:12px">
        <button class="act" data-open="${a.id}">${finished ? '再看一遍' : '开始做'}</button>
        <span class="hint">做对 ${p.right} 道</span>
      </div>
    </div>`).join('');

  for (const b of el.querySelectorAll('[data-open]')) {
    b.onclick = () => onOpen(assignments.find(a => String(a.id) === b.dataset.open));
  }
}

// A strip shown above the practice list while an assignment is open.
//
// `parts` lists what the set covers, e.g. [['Trigonometry', 4], ...]. They are
// labels, not filters: filtering inside a set of ten questions buys little, and
// a student who filters and forgets sees an empty list and thinks they are done.
export function banner(assignment, attempts, { onExit, parts = [] }) {
  const p = progressOf(assignment, attempts);
  const el = document.createElement('div');
  el.className = 'card';
  el.style.cssText = 'margin-bottom:12px;padding:12px 15px';
  el.innerHTML = `
    <div class="qhead" style="margin-bottom:8px">
      <h2>作业：${esc(assignment.title)}</h2>
      ${assignment.due_on ? `<span class="badge g">${esc(dueLabel(assignment.due_on))}</span>` : ''}
      <span class="spacer"></span>
      <button class="plain" data-exit>退出作业</button>
    </div>
    ${gauge(p.done, p.total)}
    ${parts.length ? `<div class="picks" style="margin-top:10px">
      <span class="hint" style="align-self:center">涉及</span>
      ${parts.map(([name, n]) =>
        `<span class="badge g">${esc(name)} ${n}道</span>`).join('')}
    </div>` : ''}`;
  el.querySelector('[data-exit]').onclick = onExit;
  return el;
}

// What a set covers, biggest group first. `of` returns the group names a
// question belongs to, so a question spanning two topics counts under both.
export function composition(assignment, questions, of) {
  const want = new Set(assignment.question_ids);
  const seen = new Map();
  for (const q of questions) {
    if (!want.has(q.id)) continue;
    for (const name of of(q)) seen.set(name, (seen.get(name) || 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]);
}

// ------------------------------------------------------------ teacher view

export function mountPicker(el, { questions, facets, label, note, preview, students, onSaved }) {
  const chosen = new Set();          // question ids
  const who = new Set();             // student ids
  const filter = {};                 // facet id -> value

  const matches = q => facets.every(f =>
    !filter[f.id] || f.values(q).includes(filter[f.id]));

  function visible() {
    return questions.filter(matches);
  }

  // Values offered for one facet, given the filters set on the others, so the
  // rows narrow each other instead of offering dead ends.
  function optionsFor(f) {
    const others = facets.filter(g => g.id !== f.id);
    const pool = questions.filter(q =>
      others.every(g => !filter[g.id] || g.values(q).includes(filter[g.id])));
    const seen = new Map();
    for (const q of pool) {
      for (const v of f.values(q)) seen.set(v, (seen.get(v) || 0) + 1);
    }
    const rank = v => (f.order ? f.order.indexOf(v) : -1);
    return [...seen.entries()].sort((a, b) => {
      // a fixed order where one reads naturally (P1, P2, P3 / easy, hard),
      // otherwise the fullest buckets first
      const [ra, rb] = [rank(a[0]), rank(b[0])];
      if (ra !== rb && (ra >= 0 || rb >= 0)) return (ra < 0 ? 1e9 : ra) - (rb < 0 ? 1e9 : rb);
      return b[1] - a[1];
    });
  }

  let previewing = null;

  function draw() {
    const list = visible();
    // a redraw replaces the list; keep the teacher where they were in it
    const keepList = el.querySelector('.list')?.scrollTop || 0;
    const keepPage = window.scrollY;
    el.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 8px;font-size:15px">布置给谁</h3>
        <div class="picks" id="who">${students.map(s =>
          `<button class="pick" data-s="${s.id}" aria-pressed="${who.has(s.id)}">${
            esc(s.display_name)}</button>`).join('')
          || '<span class="hint">这个体系下还没有学生</span>'}</div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 8px;font-size:15px">挑题</h3>
        ${facets.map(f => `
          <div class="hint" style="margin:8px 0 4px">${esc(f.name)}</div>
          <div class="chips" style="margin-bottom:0" data-f="${f.id}">
            <button class="chip" data-v="" aria-pressed="${!filter[f.id]}">全部</button>
            ${optionsFor(f).map(([v, n]) =>
              `<button class="chip" data-v="${esc(v)}" aria-pressed="${filter[f.id] === v}">${
                esc(f.display ? f.display(v) : v)}<b>${n}</b></button>`).join('')}
          </div>`).join('')}

        <div class="row" style="margin:14px 0 10px">
          <span class="badge">已选 ${chosen.size} 道</span>
          <span class="hint">当前筛选出 ${list.length} 道</span>
          <span class="spacer"></span>
          <button class="plain" id="pickAll">全选这些</button>
          <button class="plain" id="pickRand">随机抽</button>
          <input id="randN" class="spr" style="width:64px;padding:6px 8px" value="10">
          <button class="plain" id="pickNone">清空</button>
        </div>

        <div class="split">
          <div class="list" style="max-height:60vh">${list.length ? list.map(q =>
            `<div class="item" data-q="${esc(q.id)}"
                  aria-current="${previewing === q.id}">
               <span class="q">${chosen.has(q.id) ? '✓' : ''}</span>
               <span>${esc(label(q))}</span>
               <span class="meta">${note ? esc(note(q)) : ''}</span>
             </div>`).join('') : '<div class="empty">没有符合条件的题</div>'}</div>
          <div class="card" id="preview"><div class="empty">点左边一道题看看内容</div></div>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <input id="title" class="spr" style="width:260px" placeholder="作业名称，例如「二次函数 10 题」">
          <input id="due" type="date" class="spr" style="width:170px">
          <button class="act" id="save">布置</button>
        </div>
        <div class="hint" style="margin-top:8px">截止日期可以不填。学生做完题自动算完成，不用交作业。</div>
      </div>`;

    for (const b of el.querySelectorAll('#who .pick')) {
      b.onclick = () => {
        who.has(b.dataset.s) ? who.delete(b.dataset.s) : who.add(b.dataset.s);
        b.setAttribute('aria-pressed', who.has(b.dataset.s));
      };
    }
    for (const row of el.querySelectorAll('.chips[data-f]')) {
      for (const b of row.children) {
        b.onclick = () => { filter[row.dataset.f] = b.dataset.v || null; previewing = null; draw(); };
      }
    }
    // Clicking a row previews it. Adding is a deliberate second click, so
    // browsing through the questions never changes the set by accident.
    for (const it of el.querySelectorAll('.item[data-q]')) {
      it.onclick = () => { previewing = it.dataset.q; draw(); };
    }
    if (previewing) drawPreview(questions.find(q => q.id === previewing));
    const listEl = el.querySelector('.list');
    if (listEl) listEl.scrollTop = keepList;
    window.scrollTo(0, keepPage);

    el.querySelector('#pickAll').onclick = () => { for (const q of visible()) chosen.add(q.id); draw(); };
    el.querySelector('#pickNone').onclick = () => { chosen.clear(); draw(); };
    el.querySelector('#pickRand').onclick = () => {
      const n = Math.max(1, parseInt(el.querySelector('#randN').value, 10) || 10);
      const pool = visible().filter(q => !chosen.has(q.id));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (const q of pool.slice(0, n)) chosen.add(q.id);
      draw();
    };
    el.querySelector('#save').onclick = save;
  }

  function drawPreview(q) {
    if (!q) return;
    const on = chosen.has(q.id);
    const box = el.querySelector('#preview');
    box.innerHTML = `
      <div class="qhead">
        <h2>${esc(label(q))}</h2>
        ${note ? `<span class="badge g">${esc(note(q))}</span>` : ''}
        <span class="spacer"></span>
        <button class="act ${on ? 'ghost' : ''}" id="toggle">${on ? '移出作业' : '加入作业'}</button>
      </div>
      ${(preview ? preview(q) : []).map(src =>
        `<img class="paper" loading="lazy" src="${src}" alt="题目">`).join('')
        || '<div class="hint">这道题没有图片</div>'}`;
    box.querySelector('#toggle').onclick = () => {
      chosen.has(q.id) ? chosen.delete(q.id) : chosen.add(q.id);
      draw();
    };
  }

  async function save() {
    const title = el.querySelector('#title').value.trim();
    const due = el.querySelector('#due').value || null;
    if (!who.size) return onSaved(null, '先选至少一个学生');
    if (!chosen.size) return onSaved(null, '先选至少一道题');
    if (!title) return onSaved(null, '给作业起个名字');
    const btn = el.querySelector('#save');
    btn.disabled = true;
    try {
      const row = await db.saveAssignment({
        title, due_on: due,
        student_ids: [...who],
        question_ids: [...chosen],
      });
      chosen.clear();
      who.clear();
      draw();
      onSaved(row, `已布置「${title}」`);
    } catch (err) {
      btn.disabled = false;
      onSaved(null, '没保存上：' + (err.message || err));
    }
  }

  draw();
}

// The list of what has been set. Each set opens into a student × question
// grid of the work done inside it, so the teacher sees at a glance who has
// done what, which question tripped everyone, and can open any cell.
//
// board: {
//   marksOf:  q => number|null     full marks, null where questions are unscored (SAT)
//   heading:  q => string          one line naming the question
//   question: (el, q) => void      fill `el` with the question itself
//   attempt:  (el, a, q) => void   fill `el` with one attempt's details (photos etc.)
//   reasonLabel: k => string
// }
// `pdfSpec(assignment, kind)` is optional; when given, each set gets the
// download buttons so the teacher can hand out paper copies.
export function renderTeacherList(el, { assignments, attempts, students, questions, board,
                                        onDeleted, pdfSpec = null, onError = () => {} }) {
  if (!assignments.length) {
    el.innerHTML = '<div class="empty">还没有布置过作业</div>';
    return;
  }
  const name = id => students.find(s => s.id === id)?.display_name || '（已删除的学生）';
  const opened = new Set([...el.querySelectorAll('details[open]')].map(d => d.dataset.id));

  el.innerHTML = assignments.map(a => `
    <details class="grp" data-id="${a.id}" ${opened.has(String(a.id)) ? 'open' : ''}>
      <summary><span class="caret">▶</span>${esc(a.title)}
        <span class="n">${a.question_ids.length} 题 · ${a.student_ids.length} 人${
          a.due_on ? ' · ' + esc(dueLabel(a.due_on)) : ''}</span></summary>
      <div style="padding:6px 16px 14px">
        <div data-grid></div>
        <div data-panel></div>
        <div class="row" style="margin-top:12px">
          ${pdfSpec ? `<span class="row" data-pdf-for="${a.id}"></span>` : ''}
          <button class="plain" data-all>展开全部题目</button>
          <span class="spacer"></span>
          <button class="plain" data-del="${a.id}">删除这份作业</button>
          <span class="hint">不会动学生已有的练习记录</span>
        </div>
      </div>
    </details>`).join('');

  for (const box of el.querySelectorAll('details.grp')) {
    const a = assignments.find(x => String(x.id) === box.dataset.id);
    mountGrid(box, a, { attempts, students, questions, board, name });
  }
  if (pdfSpec) {
    for (const box of el.querySelectorAll('[data-pdf-for]')) {
      const a = assignments.find(x => String(x.id) === box.dataset.pdfFor);
      pdf.buttons(box, { set: kind => pdfSpec(a, kind), onError });
    }
  }
  for (const b of el.querySelectorAll('[data-del]')) {
    b.onclick = async () => {
      if (!confirm('删除这份作业？')) return;
      b.disabled = true;
      try {
        await db.deleteAssignment(Number(b.dataset.del));
        onDeleted(null);
      } catch (err) {
        b.disabled = false;
        onDeleted(err.message || String(err));
      }
    };
  }
}

const RESULT_MARK = { correct: '✓', partial: '△', unknown: '✗' };
const RESULT_WORD = { correct: '全对', partial: '部分对', unknown: '不会' };
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric',
                                                          hour: '2-digit', minute: '2-digit' });

function mountGrid(box, a, { attempts, students, questions, board, name }) {
  const grid = box.querySelector('[data-grid]');
  const panel = box.querySelector('[data-panel]');
  const qs = a.question_ids.map(id => questions.find(q => q.id === id) || { id, missing: true });
  const scored = qs.some(q => !q.missing && board.marksOf(q) != null);

  // student -> question -> attempts in this set, newest first
  const cell = new Map();
  for (const sid of a.student_ids) cell.set(sid, new Map());
  for (const x of attemptsIn(a, attempts)) {
    const row = cell.get(x.student_id);
    if (!row) continue;
    if (!row.has(x.question_id)) row.set(x.question_id, []);
    row.get(x.question_id).push(x);
  }

  const cellHtml = (sid, q) => {
    const list = cell.get(sid).get(q.id) || [];
    if (!list.length) return '<td class="cell none">·</td>';
    const last = list[0];
    const max = q.missing ? null : board.marksOf(q);
    const face = scored && max != null && last.marks != null
      ? `${last.marks}<span class="of">/${max}</span>` : RESULT_MARK[last.result] || '?';
    return `<td class="cell ${last.result}" data-s="${sid}" data-q="${esc(q.id)}" role="button"
      title="${esc(name(sid))} · ${RESULT_WORD[last.result] || ''}${list.length > 1 ? ` · 做了 ${list.length} 次` : ''}">${
      face}${list.length > 1 ? `<sup>×${list.length}</sup>` : ''}</td>`;
  };

  // how many students' latest go at each question was not fully right
  const missed = q => a.student_ids.filter(sid => {
    const last = (cell.get(sid).get(q.id) || [])[0];
    return last && last.result !== 'correct';
  }).length;
  const undone = q => a.student_ids.filter(sid => !cell.get(sid).has(q.id)).length;

  grid.innerHTML = `
    <div class="gridwrap"><table class="grid">
      <thead><tr><th class="who"></th>${qs.map((q, i) =>
        `<th data-q="${esc(q.id)}" role="button" title="${q.missing ? '题目不在当前题库中' : esc(board.heading(q))}">Q${i + 1}${
          scored && !q.missing && board.marksOf(q) != null ? `<small>${board.marksOf(q)}分</small>` : ''}</th>`).join('')}
        <th class="sum">完成</th></tr></thead>
      <tbody>${a.student_ids.map(sid => {
        const p = progressOf(a, attempts, sid);
        return `<tr><td class="who">${esc(name(sid))}</td>${qs.map(q => cellHtml(sid, q)).join('')}
          <td class="sum">${p.done}/${p.total}</td></tr>`;
      }).join('')}
      <tr class="foot"><td class="who">失分人数</td>${qs.map(q => {
        const m = missed(q), u = undone(q);
        return `<td class="${m ? 'hot' : ''}">${m || '<span class="hint">0</span>'}${
          u ? `<small title="还没做的人数">未做 ${u}</small>` : ''}</td>`;
      }).join('')}<td class="sum"></td></tr></tbody>
    </table></div>
    <div class="hint" style="margin-top:6px">点格子看那次作答，点 Q 序号看题目${scored ? '；格子里是得分/满分' : ''}</div>`;

  let showing = null;   // 'q:<id>' | 'a:<sid>:<qid>' | 'all'
  const open = (key, fill) => {
    if (showing === key) { showing = null; panel.innerHTML = ''; return; }
    showing = key;
    panel.innerHTML = '<div class="card" style="margin-top:10px" data-body></div>';
    fill(panel.querySelector('[data-body]'));
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const questionBlock = (q, i) => {
    const body = document.createElement('div');
    body.innerHTML = `<div class="qhead"><h2>Q${i + 1}</h2>
      <span class="hint">${q.missing ? '题目不在当前题库中' : esc(board.heading(q))}</span></div>`;
    if (!q.missing) {
      const slot = document.createElement('div');
      body.appendChild(slot);
      board.question(slot, q);
    }
    return body;
  };

  for (const th of grid.querySelectorAll('th[data-q]')) {
    th.onclick = () => {
      const i = qs.findIndex(q => q.id === th.dataset.q);
      open('q:' + th.dataset.q, el => el.appendChild(questionBlock(qs[i], i)));
    };
  }
  box.querySelector('[data-all]').onclick = () => open('all', el => {
    qs.forEach((q, i) => {
      const b = questionBlock(q, i);
      if (i) b.style.cssText = 'border-top:1px solid var(--line);margin-top:14px;padding-top:12px';
      el.appendChild(b);
    });
  });

  for (const td of grid.querySelectorAll('td.cell[data-s]')) {
    td.onclick = () => {
      const sid = td.dataset.s, qid = td.dataset.q;
      const i = qs.findIndex(q => q.id === qid);
      const q = qs[i];
      const list = cell.get(sid).get(qid) || [];
      open(`a:${sid}:${qid}`, el => {
        el.innerHTML = `<div class="qhead"><h2>${esc(name(sid))} · Q${i + 1}</h2>
          <span class="hint">${q.missing ? '' : esc(board.heading(q))}</span>
          <span class="badge g">做了 ${list.length} 次</span></div>`;
        // oldest first, so the story reads forward: wrong, then wrong again, then right
        [...list].reverse().forEach((x, n) => {
          const item = document.createElement('div');
          item.className = 'try';
          const max = q.missing ? null : board.marksOf(q);
          item.innerHTML = `
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <span class="badge ${x.result === 'correct' ? '' : x.result === 'partial' ? 'w' : 'b'}">第 ${n + 1} 次 · ${
                x.marks != null && max != null ? `${x.marks}/${max} 分` : RESULT_WORD[x.result] || x.result}</span>
              ${(x.reasons || []).map(k => `<span class="badge g">${
                k === 'other' && x.reason_note ? '其他：' + esc(x.reason_note) : esc(board.reasonLabel(k))}</span>`).join('')}
              <span class="hint" style="margin-left:auto">${when(x.created_at)}</span>
            </div>
            <div data-more></div>`;
          el.appendChild(item);
          board.attempt(item.querySelector('[data-more]'), x, q.missing ? null : q);
        });
      });
    };
  }
}
