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

import * as db from './db.js?v=985fa28a';
import * as pdf from './pdf.js?v=985fa28a';

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
  if (!assignment.question_ids.includes(a.question_id)) return false;
  if (a.assignment_id != null) return a.assignment_id === assignment.id;
  return a.created_at < STAMPED_SINCE && a.created_at >= assignment.created_at;
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
//
// Lessons are one-to-one, so everything here starts from a student: pick the
// student, and the question list annotates itself with what that student has
// already been set and how their last go at each question went.
//
// board: {
//   marksOf:  q => number|null     full marks, null where questions are unscored (SAT)
//   heading:  q => string          one line naming the question
//   question: (el, q) => void      fill `el` with the question itself
//   attempt:  (el, a, q) => void   fill `el` with one attempt's details (photos etc.)
//   reasonLabel: k => string
// }

const asList = x => (typeof x === 'function' ? x() : x) || [];
const RESULT_MARK = { correct: '✓', partial: '△', unknown: '✗' };
const RESULT_WORD = { correct: '全对', partial: '部分对', unknown: '不会' };
const day = t => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric',
                                                          hour: '2-digit', minute: '2-digit' });

// What one student has already seen of each question: the sets it went into
// (newest first) and their latest attempt at it.
export function historyOf(studentId, assignments, attempts) {
  const sets = new Map();
  for (const a of assignments) {
    if (!a.student_ids.includes(studentId)) continue;
    for (const id of a.question_ids) {
      if (!sets.has(id)) sets.set(id, []);
      sets.get(id).push(a);
    }
  }
  const last = new Map(), flagged = new Set();
  for (const x of attempts) {
    if (x.student_id !== studentId) continue;
    if (!last.has(x.question_id)) last.set(x.question_id, x);
    if ((x.weak_sections || []).length) flagged.add(x.question_id);
  }
  return {
    sets: id => sets.get(id) || [],
    last: id => last.get(id) || null,
    flagged: id => flagged.has(id),
  };
}

// Where to draw questions from, once a student is chosen.
const SOURCES = [
  ['all', '全部题库', () => true],
  ['wrong', '错过的题', (h, id) => { const l = h.last(id); return Boolean(l && l.result !== 'correct'); }],
  ['undone', '布置过没做', (h, id) => h.sets(id).length > 0 && !h.last(id)],
  ['weak', '标了没掌握', (h, id) => h.flagged(id)],
];

function historyTags(h, q, board) {
  if (!h) return '';
  const sets = h.sets(q.id), l = h.last(q.id);
  const out = [];
  if (sets.length) {
    out.push(`<span class="tag" title="${esc(sets.map(a => `${day(a.created_at)} ${a.title}`).join('\n'))}">📝 ${
      sets.length > 1 ? `布置过 ${sets.length} 次` : `${day(sets[0].created_at)} 布置过`}</span>`);
  }
  if (l) {
    const max = board.marksOf(q);
    const reasons = (l.reasons || []).map(k =>
      k === 'other' && l.reason_note ? l.reason_note : board.reasonLabel(k));
    out.push(`<span class="tag ${l.result}" title="${esc(RESULT_WORD[l.result] || '')}${reasons.length ? ' · ' + esc(reasons.join('、')) : ''}">${
      RESULT_MARK[l.result]} ${day(l.created_at)}${l.marks != null && max != null ? ` ${l.marks}/${max}` : ''}${
      reasons.length ? ` <i>${esc(reasons[0])}</i>` : ''}</span>`);
  }
  return out.join('');
}

// ------------------------------------------------------ question chooser
//
// Shared by the new-set form and the in-place editor. Clicking a row shows
// the question; the + / − at its right adds or drops it in one move.
//
// chosen:  Set of question ids the caller owns; this mutates it via onChange
// history: from historyOf(), or null before a student is picked
function questionChooser(host, { questions, facets, label, note, board, chosen, history, onChange }) {
  const filter = {};
  let source = 'all';
  let previewing = null;

  const matches = q => facets.every(f => !filter[f.id] || f.values(q).includes(filter[f.id]));
  const inSource = q => {
    if (!history || source === 'all') return true;
    return SOURCES.find(s => s[0] === source)[2](history, q.id);
  };
  const visible = () => {
    const list = questions.filter(q => matches(q) && inSource(q));
    // in the student's own pools, the most recent goes first
    if (history && source !== 'all') {
      const t = q => history.last(q.id)?.created_at || history.sets(q.id)[0]?.created_at || '';
      list.sort((a, b) => t(b).localeCompare(t(a)));
    }
    return list;
  };

  function optionsFor(f) {
    const others = facets.filter(g => g.id !== f.id);
    const pool = questions.filter(q => inSource(q)
      && others.every(g => !filter[g.id] || g.values(q).includes(filter[g.id])));
    const seen = new Map();
    for (const q of pool) for (const v of f.values(q)) seen.set(v, (seen.get(v) || 0) + 1);
    const rank = v => (f.order ? f.order.indexOf(v) : -1);
    return [...seen.entries()].sort((a, b) => {
      const [ra, rb] = [rank(a[0]), rank(b[0])];
      if (ra !== rb && (ra >= 0 || rb >= 0)) return (ra < 0 ? 1e9 : ra) - (rb < 0 ? 1e9 : rb);
      return b[1] - a[1];
    });
  }

  function draw() {
    const list = visible();
    const keepList = host.querySelector('.list')?.scrollTop || 0;
    const keepPage = window.scrollY;
    const counts = history ? Object.fromEntries(SOURCES.map(([k, , test]) =>
      [k, questions.filter(q => test(history, q.id)).length])) : null;

    host.innerHTML = `
      ${history ? `<div class="chips" style="margin-bottom:4px">${SOURCES.map(([k, v]) =>
        `<button class="chip" data-src="${k}" aria-pressed="${source === k}" ${
          counts[k] ? '' : 'disabled'}>${v}<b>${counts[k]}</b></button>`).join('')}</div>`
        : '<div class="hint" style="margin-bottom:4px">先选学生，这里会标出他布置过、做错过的题</div>'}
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
        <span class="hint">筛出 ${list.length} 道</span>
        <span class="spacer"></span>
        <button class="plain" data-all>全选这些</button>
        <button class="plain" data-rand>随机抽</button>
        <input data-n class="spr" style="width:64px;padding:6px 8px" value="10">
        <button class="plain" data-none>清空</button>
      </div>

      <div class="split">
        <div class="list" style="max-height:60vh">${list.length ? list.map(q => {
          const on = chosen.has(q.id);
          return `<div class="item pickrow" data-q="${esc(q.id)}" aria-current="${previewing === q.id}">
             <span class="q">${on ? '✓' : ''}</span>
             <span class="body"><span>${esc(label(q))}</span>
               <span class="tags">${historyTags(history, q, board)}</span></span>
             <span class="meta">${note ? esc(note(q)) : ''}</span>
             <button class="pm ${on ? 'on' : ''}" data-pm="${esc(q.id)}" title="${on ? '移出' : '加入'}">${on ? '−' : '+'}</button>
           </div>`; }).join('') : '<div class="empty">没有符合条件的题</div>'}</div>
        <div class="card" data-preview><div class="empty">点左边一道题看看内容</div></div>
      </div>`;

    for (const b of host.querySelectorAll('[data-src]')) {
      b.onclick = () => { source = b.dataset.src; previewing = null; draw(); };
    }
    for (const row of host.querySelectorAll('.chips[data-f]')) {
      for (const b of row.children) {
        b.onclick = () => { filter[row.dataset.f] = b.dataset.v || null; previewing = null; draw(); };
      }
    }
    for (const it of host.querySelectorAll('.item[data-q]')) {
      it.onclick = () => { previewing = it.dataset.q; draw(); };
    }
    for (const b of host.querySelectorAll('[data-pm]')) {
      b.onclick = e => { e.stopPropagation(); toggle(b.dataset.pm); };
    }
    host.querySelector('[data-all]').onclick = () => { for (const q of visible()) chosen.add(q.id); changed(); };
    host.querySelector('[data-none]').onclick = () => { chosen.clear(); changed(); };
    host.querySelector('[data-rand]').onclick = () => {
      const n = Math.max(1, parseInt(host.querySelector('[data-n]').value, 10) || 10);
      const pool = visible().filter(q => !chosen.has(q.id));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (const q of pool.slice(0, n)) chosen.add(q.id);
      changed();
    };

    if (previewing) drawPreview(questions.find(q => q.id === previewing));
    const listEl = host.querySelector('.list');
    if (listEl) listEl.scrollTop = keepList;
    window.scrollTo(0, keepPage);
  }

  function drawPreview(q) {
    if (!q) return;
    const on = chosen.has(q.id);
    const box = host.querySelector('[data-preview]');
    box.innerHTML = `
      <div class="qhead">
        <h2>${esc(label(q))}</h2>
        ${note ? `<span class="badge g">${esc(note(q))}</span>` : ''}
        <span class="spacer"></span>
        <button class="act ${on ? 'ghost' : ''}" data-toggle>${on ? '移出作业' : '加入作业'}</button>
      </div>
      <div class="picks" style="margin-bottom:8px">${historyTags(history, q, board)}</div>
      <div data-body></div>`;
    board.question(box.querySelector('[data-body]'), q);
    box.querySelector('[data-toggle]').onclick = () => toggle(q.id);
  }

  function toggle(id) {
    chosen.has(id) ? chosen.delete(id) : chosen.add(id);
    changed();
  }
  function changed() { onChange(); draw(); }

  draw();
  return {
    redraw: draw,
    setHistory(h) { history = h; source = 'all'; previewing = null; draw(); },
  };
}

// ------------------------------------------------------------- new set

export function mountPicker(el, { questions, facets, label, note, board, students,
                                  assignments, attempts, onSaved }) {
  const chosen = new Set();
  let student = null;
  let title = '', due = '';

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;font-size:15px">给谁布置</h3>
      <div class="picks" data-who></div>
    </div>
    <div class="card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;font-size:15px">挑题</h3>
      <div data-chooser></div>
    </div>
    <div class="card">
      <div class="row">
        <input data-title class="spr" style="width:260px" placeholder="作业名称，例如「二次函数 10 题」">
        <input data-due type="date" class="spr" style="width:170px">
        <button class="act" data-save>布置</button>
      </div>
      <div class="hint" style="margin-top:8px">截止日期可以不填。学生做完题自动算完成，不用交作业。</div>
    </div>`;

  const who = el.querySelector('[data-who]');
  function drawWho() {
    who.innerHTML = students.map(s =>
      `<button class="pick" data-s="${s.id}" aria-pressed="${student === s.id}">${esc(s.display_name)}</button>`).join('')
      || '<span class="hint">这个体系下还没有学生</span>';
    for (const b of who.querySelectorAll('[data-s]')) {
      b.onclick = () => {
        student = student === b.dataset.s ? null : b.dataset.s;
        drawWho();
        chooser.setHistory(student ? historyOf(student, asList(assignments), asList(attempts)) : null);
      };
    }
  }
  drawWho();

  const chooser = questionChooser(el.querySelector('[data-chooser]'), {
    questions, facets, label, note, board, chosen, history: null, onChange: () => {},
  });

  const titleEl = el.querySelector('[data-title]'), dueEl = el.querySelector('[data-due]');
  el.querySelector('[data-save]').onclick = async () => {
    title = titleEl.value.trim();
    due = dueEl.value || null;
    if (!student) return onSaved(null, '先选学生');
    if (!chosen.size) return onSaved(null, '先选至少一道题');
    if (!title) return onSaved(null, '给作业起个名字');
    const btn = el.querySelector('[data-save]');
    btn.disabled = true;
    try {
      const row = await db.saveAssignment({
        title, due_on: due, student_ids: [student], question_ids: [...chosen],
      });
      chosen.clear();
      titleEl.value = '';
      dueEl.value = '';
      chooser.redraw();
      onSaved(row, `已布置「${title}」`);
    } catch (err) {
      onSaved(null, '没保存上：' + (err.message || err));
    } finally {
      btn.disabled = false;
    }
  };

  return {
    // history changes when a set is saved or edited; the picker re-reads it
    refresh() { if (student) chooser.setHistory(historyOf(student, asList(assignments), asList(attempts))); },
  };
}

// ------------------------------------------------------------ set list

// Sets grouped by student (lessons are one-to-one), each opening into a grid
// of the work done inside it and, on request, editable in place.
//
// pick: { facets, label, note } - the same description the picker uses, so
//       adding a question inside a set offers the same annotated list.
// onChanged(): a set was saved or deleted; the caller reloads and re-renders.
export function renderTeacherList(el, { assignments, attempts, students, questions, board, pick,
                                        onChanged, pdfSpec = null, onError = () => {} }) {
  if (!assignments.length) {
    el.innerHTML = '<div class="empty">还没有布置过作业</div>';
    return;
  }
  const name = id => students.find(s => s.id === id)?.display_name || '（已删除的学生）';
  const opened = new Set([...el.querySelectorAll('details.grp[open]')].map(d => d.dataset.id));
  const byTime = el.dataset.order === 'time';

  const card = (a, sid) => {
    const p = progressOf(a, attempts, sid);
    return `
    <details class="grp" data-id="${a.id}" ${opened.has(String(a.id)) ? 'open' : ''}>
      <summary><span class="caret">▶</span>${esc(a.title)}
        ${byTime ? `<span class="badge g">${esc(a.student_ids.map(name).join('、'))}</span>` : ''}
        <span class="n">${p.done}/${p.total} 题${p.done ? ` · 对 ${p.right}` : ''} · ${day(a.created_at)} 布置${
          a.due_on ? ' · ' + esc(dueLabel(a.due_on)) : ''}</span></summary>
      <div class="setbody" style="padding:6px 16px 14px"></div>
    </details>`;
  };

  let html = `<div class="row" style="margin-bottom:10px">
    <div class="chips" style="margin:0">
      <button class="chip" data-order="student" aria-pressed="${!byTime}">按学生</button>
      <button class="chip" data-order="time" aria-pressed="${byTime}">按时间</button>
    </div></div>`;
  if (byTime) {
    html += assignments.map(a => card(a, a.student_ids[0])).join('');
  } else {
    const groups = new Map();
    for (const a of assignments) {
      for (const sid of a.student_ids.length ? a.student_ids : ['']) {
        if (!groups.has(sid)) groups.set(sid, []);
        groups.get(sid).push(a);
      }
    }
    const order = [...students.map(s => s.id), ...groups.keys()].filter((v, i, arr) => arr.indexOf(v) === i);
    html += order.filter(sid => groups.has(sid)).map(sid => `
      <div class="stu">
        <h3>${esc(name(sid))}<span class="hint">${groups.get(sid).length} 份</span></h3>
        ${groups.get(sid).map(a => card(a, sid)).join('')}
      </div>`).join('');
  }
  el.innerHTML = html;

  for (const b of el.querySelectorAll('[data-order]')) {
    b.onclick = () => {
      el.dataset.order = b.dataset.order;
      renderTeacherList(el, { assignments, attempts, students, questions, board, pick, onChanged, pdfSpec, onError });
    };
  }
  for (const box of el.querySelectorAll('details.grp')) {
    const a = assignments.find(x => String(x.id) === box.dataset.id);
    mountSet(box.querySelector('.setbody'), a,
      { assignments, attempts, students, questions, board, pick, name, pdfSpec, onError, onChanged });
  }
}

// One set's body: the grid, the tool row, and the in-place editor.
function mountSet(body, a, ctx) {
  let draft = null;          // { title, due_on, question_ids, student_ids, dropQ:Set, dropS:Set }
  const { assignments, attempts, students, questions, board, pick, name, pdfSpec, onError, onChanged } = ctx;

  function view() {
    body.innerHTML = `
      <div data-grid></div>
      <div data-panel></div>
      <div class="row" style="margin-top:12px">
        ${pdfSpec ? '<span class="row" data-pdf></span>' : ''}
        <button class="plain" data-all>展开全部题目</button>
        <button class="plain" data-edit>编辑这份作业</button>
        <span class="spacer"></span>
        <button class="plain" data-del>删除</button>
      </div>`;
    drawGrid(body.querySelector('[data-grid]'), body.querySelector('[data-panel]'), a, null);
    if (pdfSpec) pdf.buttons(body.querySelector('[data-pdf]'), { set: kind => pdfSpec(a, kind), onError });
    body.querySelector('[data-edit]').onclick = () => {
      draft = { title: a.title, due_on: a.due_on || '', question_ids: [...a.question_ids],
                student_ids: [...a.student_ids], dropQ: new Set(), dropS: new Set() };
      edit();
    };
    body.querySelector('[data-del]').onclick = async e => {
      if (!confirm(`删除「${a.title}」？学生已有的练习记录不会动。`)) return;
      e.target.disabled = true;
      try { await db.deleteAssignment(a.id); onChanged(); }
      catch (err) { e.target.disabled = false; onError('删除失败：' + (err.message || err)); }
    };
  }

  function edit() {
    const live = () => ({
      ...a, title: draft.title, due_on: draft.due_on || null,
      question_ids: draft.question_ids.filter(id => !draft.dropQ.has(id)),
      student_ids: draft.student_ids.filter(id => !draft.dropS.has(id)),
    });
    const diff = () => {
      const addQ = draft.question_ids.filter(id => !a.question_ids.includes(id)).length;
      const addS = draft.student_ids.filter(id => !a.student_ids.includes(id)).length;
      const parts = [];
      if (addQ) parts.push(`+${addQ} 题`);
      if (draft.dropQ.size) parts.push(`−${draft.dropQ.size} 题`);
      if (addS) parts.push(`+${addS} 人`);
      if (draft.dropS.size) parts.push(`−${draft.dropS.size} 人`);
      if (draft.title !== a.title) parts.push('改了名称');
      if ((draft.due_on || '') !== (a.due_on || '')) parts.push('改了截止日期');
      return parts;
    };

    body.innerHTML = `
      <div class="row" style="margin:4px 0 10px">
        <input data-title class="spr" style="width:260px" value="${esc(draft.title)}">
        <input data-due type="date" class="spr" style="width:170px" value="${esc(draft.due_on)}">
        <span class="hint">点列头的 × 减题，点学生名旁的 × 减人</span>
      </div>
      <div data-grid></div>
      <div data-panel></div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <button class="plain" data-addq>+ 加题</button>
        ${students.filter(s => !draft.student_ids.includes(s.id)).map(s =>
          `<button class="plain" data-adds="${s.id}">+ ${esc(s.display_name)}</button>`).join('')}
      </div>
      <div data-chooser hidden style="margin-top:10px"></div>
      <div class="row" style="margin-top:14px">
        <span class="hint" data-diff></span>
        <span class="spacer"></span>
        <button class="act" data-save>保存修改</button>
        <button class="plain" data-cancel>撤销</button>
      </div>`;

    const grid = body.querySelector('[data-grid]'), panel = body.querySelector('[data-panel]');
    const redraw = () => {
      drawGrid(grid, panel, live(), {
        draft,
        onDropQ: id => {
          if (a.question_ids.includes(id)) draft.dropQ.has(id) ? draft.dropQ.delete(id) : draft.dropQ.add(id);
          else draft.question_ids = draft.question_ids.filter(x => x !== id);
          chosen.delete(id); if (!draft.dropQ.has(id) && draft.question_ids.includes(id)) chosen.add(id);
          redraw(); chooser?.redraw();
        },
        onDropS: id => {
          if (a.student_ids.includes(id)) draft.dropS.has(id) ? draft.dropS.delete(id) : draft.dropS.add(id);
          else draft.student_ids = draft.student_ids.filter(x => x !== id);
          redraw();
        },
      });
      const d = diff();
      body.querySelector('[data-diff]').textContent = d.length ? d.join(' · ') : '还没有改动';
      body.querySelector('[data-save]').disabled = !d.length || !live().question_ids.length || !live().student_ids.length;
    };

    // the chooser owns a Set of the ids currently in the set; adding there appends a column
    const chosen = new Set(live().question_ids);
    let chooser = null;
    body.querySelector('[data-addq]').onclick = () => {
      const host = body.querySelector('[data-chooser]');
      host.hidden = !host.hidden;
      if (!chooser && !host.hidden) {
        const sid = live().student_ids[0];
        chooser = questionChooser(host, {
          questions, ...pick, board, chosen,
          // this set itself is left out, or every question in it reads as "set before"
          history: sid ? historyOf(sid, assignments.filter(x => x.id !== a.id), attempts) : null,
          onChange: () => {
            for (const id of chosen) {
              if (draft.dropQ.has(id)) draft.dropQ.delete(id);
              else if (!draft.question_ids.includes(id)) draft.question_ids.push(id);
            }
            for (const id of draft.question_ids) {
              if (!chosen.has(id)) {
                if (a.question_ids.includes(id)) draft.dropQ.add(id);
                else draft.question_ids = draft.question_ids.filter(x => x !== id);
              }
            }
            redraw();
          },
        });
      }
    };
    for (const b of body.querySelectorAll('[data-adds]')) {
      b.onclick = () => { draft.student_ids.push(b.dataset.adds); edit(); };
    }
    body.querySelector('[data-title]').oninput = e => { draft.title = e.target.value; redraw(); };
    body.querySelector('[data-due]').onchange = e => { draft.due_on = e.target.value; redraw(); };
    body.querySelector('[data-cancel]').onclick = () => { draft = null; view(); };
    body.querySelector('[data-save]').onclick = async e => {
      const patch = live();
      if (!patch.title.trim()) return onError('作业名称不能为空');
      e.target.disabled = true;
      try {
        await db.updateAssignment(a.id, {
          title: patch.title.trim(), due_on: patch.due_on,
          question_ids: patch.question_ids, student_ids: patch.student_ids,
        });
        onChanged();
      } catch (err) {
        e.target.disabled = false;
        onError('没保存上：' + (err.message || err));
      }
    };
    redraw();
  }

  // The student × question grid. With `editing`, dropped columns/rows stay in
  // place greyed out so the teacher sees what they are about to remove.
  function drawGrid(grid, panel, set, editing) {
    const ids = editing ? editing.draft.question_ids : set.question_ids;
    const sids = editing ? editing.draft.student_ids : set.student_ids;
    const qs = ids.map(id => questions.find(q => q.id === id) || { id, missing: true });
    const scored = qs.some(q => !q.missing && board.marksOf(q) != null);
    const droppedQ = id => editing?.draft.dropQ.has(id);
    const droppedS = id => editing?.draft.dropS.has(id);
    const isNewQ = id => editing && !a.question_ids.includes(id);

    const cell = new Map();
    for (const sid of sids) cell.set(sid, new Map());
    for (const x of attemptsIn({ ...set, question_ids: ids }, attempts)) {
      const row = cell.get(x.student_id);
      if (!row) continue;
      if (!row.has(x.question_id)) row.set(x.question_id, []);
      row.get(x.question_id).push(x);
    }
    const doneBy = q => sids.filter(sid => cell.get(sid).has(q.id)).length;

    const cellHtml = (sid, q) => {
      const list = cell.get(sid).get(q.id) || [];
      const off = droppedQ(q.id) || droppedS(sid) ? ' off' : '';
      if (!list.length) return `<td class="cell none${off}">·</td>`;
      const last = list[0];
      const max = q.missing ? null : board.marksOf(q);
      const face = scored && max != null && last.marks != null
        ? `${last.marks}<span class="of">/${max}</span>` : RESULT_MARK[last.result] || '?';
      return `<td class="cell ${last.result}${off}" data-s="${sid}" data-q="${esc(q.id)}" role="button"
        title="${esc(name(sid))} · ${RESULT_WORD[last.result] || ''}${list.length > 1 ? ` · 做了 ${list.length} 次` : ''}">${
        face}${list.length > 1 ? `<sup>×${list.length}</sup>` : ''}</td>`;
    };
    const missed = q => sids.filter(sid => {
      const last = (cell.get(sid).get(q.id) || [])[0];
      return last && last.result !== 'correct';
    }).length;

    grid.innerHTML = `
      <div class="gridwrap"><table class="grid">
        <thead><tr><th class="who"></th>${qs.map((q, i) =>
          `<th data-q="${esc(q.id)}" role="button" class="${droppedQ(q.id) ? 'off' : ''}${isNewQ(q.id) ? ' new' : ''}"
               title="${q.missing ? '题目不在当前题库中' : esc(board.heading(q))}">Q${i + 1}${
            scored && !q.missing && board.marksOf(q) != null ? `<small>${board.marksOf(q)}分</small>` : ''}${
            editing ? `<button class="x" data-dropq="${esc(q.id)}" title="${droppedQ(q.id) ? '恢复' : (doneBy(q) ? `${doneBy(q)} 人做过，记录保留但不再计入` : '减掉这题')}">${
              droppedQ(q.id) ? '↩' : '×'}</button>` : ''}</th>`).join('')}
          <th class="sum">完成</th></tr></thead>
        <tbody>${sids.map(sid => {
          const p = progressOf({ ...set, question_ids: ids.filter(id => !droppedQ(id)) }, attempts, sid);
          return `<tr class="${droppedS(sid) ? 'off' : ''}"><td class="who">${esc(name(sid))}${
            editing ? `<button class="x" data-drops="${sid}" title="${droppedS(sid) ? '恢复' : '不再给他'}">${droppedS(sid) ? '↩' : '×'}</button>` : ''}</td>${
            qs.map(q => cellHtml(sid, q)).join('')}
            <td class="sum">${p.done}/${p.total}</td></tr>`;
        }).join('')}
        ${sids.length > 1 ? `<tr class="foot"><td class="who">失分人数</td>${qs.map(q => {
          const m = missed(q);
          return `<td class="${m ? 'hot' : ''}">${m || '<span class="hint">0</span>'}</td>`;
        }).join('')}<td class="sum"></td></tr>` : ''}</tbody>
      </table></div>
      <div class="hint" style="margin-top:6px">点格子看那次作答，点 Q 序号看题目${scored ? '；格子里是得分/满分' : ''}</div>`;

    let showing = null;
    const open = (key, fill) => {
      if (showing === key) { showing = null; panel.innerHTML = ''; return; }
      showing = key;
      panel.innerHTML = '<div class="card" style="margin-top:10px" data-body></div>';
      fill(panel.querySelector('[data-body]'));
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const questionBlock = (q, i) => {
      const b = document.createElement('div');
      b.innerHTML = `<div class="qhead"><h2>Q${i + 1}</h2>
        <span class="hint">${q.missing ? '题目不在当前题库中' : esc(board.heading(q))}</span></div>`;
      if (!q.missing) { const slot = document.createElement('div'); b.appendChild(slot); board.question(slot, q); }
      return b;
    };
    for (const th of grid.querySelectorAll('th[data-q]')) {
      th.onclick = () => {
        const i = qs.findIndex(q => q.id === th.dataset.q);
        open('q:' + th.dataset.q, el => el.appendChild(questionBlock(qs[i], i)));
      };
    }
    const all = body.querySelector('[data-all]');
    if (all) all.onclick = () => open('all', el => {
      qs.forEach((q, i) => {
        const b = questionBlock(q, i);
        if (i) b.style.cssText = 'border-top:1px solid var(--line);margin-top:14px;padding-top:12px';
        el.appendChild(b);
      });
    });
    for (const b of grid.querySelectorAll('[data-dropq]')) {
      b.onclick = e => { e.stopPropagation(); editing.onDropQ(b.dataset.dropq); };
    }
    for (const b of grid.querySelectorAll('[data-drops]')) {
      b.onclick = () => editing.onDropS(b.dataset.drops);
    }
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

  view();
}
