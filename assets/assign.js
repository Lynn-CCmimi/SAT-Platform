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

import * as db from './db.js?v=b4da5f2b';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- progress

// Doing the question is what completes it, so progress is read out of attempts
// rather than tracked separately. A question answered twice still counts once.
export function progressOf(assignment, attempts, studentId) {
  const want = new Set(assignment.question_ids);
  const done = new Set();
  let right = 0;
  for (const a of attempts) {
    if (studentId && a.student_id !== studentId) continue;
    if (!want.has(a.question_id) || done.has(a.question_id)) continue;
    done.add(a.question_id);
    if (a.result === 'correct') right += 1;
  }
  return { done: done.size, total: want.size, right };
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

// The list of what has been set, with each named student's progress.
export function renderTeacherList(el, { assignments, attempts, students, onDeleted }) {
  if (!assignments.length) {
    el.innerHTML = '<div class="empty">还没有布置过作业</div>';
    return;
  }
  const name = id => students.find(s => s.id === id)?.display_name || '（已删除的学生）';

  el.innerHTML = assignments.map(a => `
    <details class="grp">
      <summary><span class="caret">▶</span>${esc(a.title)}
        <span class="n">${a.question_ids.length} 题 · ${a.student_ids.length} 人${
          a.due_on ? ' · ' + esc(dueLabel(a.due_on)) : ''}</span></summary>
      <div style="padding:6px 16px 14px">
        <table><tbody>${a.student_ids.map(sid => {
          const p = progressOf(a, attempts, sid);
          return `<tr><td style="width:30%">${esc(name(sid))}</td>
            <td>${gauge(p.done, p.total)}</td>
            <td style="width:22%" class="hint">做对 ${p.right}</td></tr>`;
        }).join('')}</tbody></table>
        <div class="row" style="margin-top:10px">
          <button class="plain" data-del="${a.id}">删除这份作业</button>
          <span class="hint">删除不会动学生已有的练习记录</span>
        </div>
      </div>
    </details>`).join('');

  for (const b of el.querySelectorAll('[data-del]')) {
    b.onclick = async () => {
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
