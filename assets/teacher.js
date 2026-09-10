import * as db from './db.js?v=6263e82a';
import * as assign from './assign.js?v=6263e82a';

const B = 'data/bank/';
const LEVEL = { easy: '简单', medium: '中等', hard: '困难' };
const REASON_LABEL = {
  misread: '看错题', slip: '抄错/算错', unknown: '知识点不会',
  stuck: '知道方法但卡住', english: '英文没读懂', time: '时间不够',
};

let DATA = null;
let students = [];
let rows = [];
let sets = [];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = t => new Date(t).toLocaleDateString('zh-CN');
const skillName = id => DATA.skills[id] ? `${DATA.skills[id].domain} · ${DATA.skills[id].name}` : id;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2200);
}

async function boot() {
  DATA = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
  if (!db.configured) {
    $('gate').hidden = false;
    $('loginErr').textContent = '后台尚未配置';
    return;
  }
  const user = await db.currentUser();
  if (user) return start(user);
  $('gate').hidden = false;
  $('loginBtn').onclick = doLogin;
  $('password').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
}

async function doLogin() {
  const btn = $('loginBtn');
  btn.disabled = true;
  $('loginErr').textContent = '';
  try {
    await start(await db.signIn($('username').value.trim(), $('password').value));
  } catch (err) {
    $('loginErr').textContent = /Invalid/i.test(err.message || '')
      ? '用户名或密码不对' : (err.message || '登录失败');
    btn.disabled = false;
  }
}

async function start(user) {
  const me = await db.profile(user.id);
  if (me.role !== 'teacher') {
    $('gate').hidden = false;
    $('loginErr').textContent = '这个账号不是老师，请到学生页面';
    return;
  }
  $('gate').hidden = true;
  $('shell').hidden = false;
  $('logout').onclick = async () => { await db.signOut(); location.reload(); };
  $('tabClass').onclick = () => tab('Class');
  $('tabWeak').onclick = () => tab('Weak');
  $('tabAssign').onclick = () => tab('Assign');

  [students, rows, sets] = await Promise.all(
    [db.allStudents(), db.attemptsForClass(), db.myAssignments()]);
  renderClass();
  renderWeak();
  mountAssign();
}

function tab(name) {
  for (const key of ['Class', 'Weak', 'Assign']) {
    $('tab' + key).setAttribute('aria-selected', key === name);
    $('view' + key).hidden = key !== name;
  }
}

// ------------------------------------------------------------ class view

function statsFor(id) {
  const mine = rows.filter(r => r.student_id === id);
  const correct = mine.filter(r => r.result === 'correct').length;
  return {
    total: mine.length,
    correct,
    wrong: mine.length - correct,
    rate: mine.length ? Math.round((correct / mine.length) * 100) : null,
    last: mine[0]?.created_at || null,
  };
}

function renderClass() {
  const active = new Set(rows.map(r => r.student_id)).size;
  $('summary').innerHTML = `
    <span class="badge">${students.length} 名学生</span>
    <span class="badge g">${rows.length} 次练习</span>
    <span class="badge g">${active} 人已开始</span>`;

  $('students').innerHTML = students.length ? `
    <thead><tr><th>学生</th><th>练习</th><th>正确率</th><th>错题</th><th>最近</th></tr></thead>
    <tbody>${students.map(s => {
      const st = statsFor(s.id);
      return `<tr data-id="${s.id}" style="cursor:pointer">
        <td><strong>${esc(s.display_name)}</strong><br>
            <span class="hint">${esc(s.username)}</span></td>
        <td>${st.total}</td>
        <td>${st.rate === null ? '<span class="hint">—</span>' :
          `<div class="row" style="gap:6px"><div class="bar-gauge">
             <span style="width:${st.rate}%"></span></div>${st.rate}%</div>`}</td>
        <td>${st.wrong || '<span class="hint">0</span>'}</td>
        <td class="hint">${st.last ? day(st.last) : '未开始'}</td>
      </tr>`;
    }).join('')}</tbody>`
    : '<tbody><tr><td class="empty">还没有学生账号</td></tr></tbody>';

  for (const tr of $('students').querySelectorAll('tr[data-id]')) {
    tr.onclick = () => showStudent(tr.dataset.id);
  }
}

function showStudent(id) {
  const s = students.find(x => x.id === id);
  const mine = rows.filter(r => r.student_id === id);
  const st = statsFor(id);

  if (!mine.length) {
    $('detail').innerHTML = `<h2 style="margin:0 0 8px;font-size:16px">${esc(s.display_name)}</h2>
      <div class="empty">还没有练习记录</div>`;
    return;
  }

  // where the misses actually land, whether or not the student flagged it
  const miss = {};
  for (const r of mine.filter(r => r.result !== 'correct')) {
    const q = DATA.questions.find(x => x.id === r.question_id);
    const key = q?.s || (r.weak_sections || [])[0];
    if (key) miss[key] = (miss[key] || 0) + 1;
  }
  const missTop = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const flagged = new Set(mine.flatMap(r => r.weak_sections || []));
  const reasons = {};
  for (const r of mine) for (const k of r.reasons || []) reasons[k] = (reasons[k] || 0) + 1;

  $('detail').innerHTML = `
    <div class="qhead">
      <h2>${esc(s.display_name)}</h2>
      <span class="badge">${st.total} 次练习</span>
      <span class="badge g">正确率 ${st.rate}%</span>
      <span class="badge ${st.wrong ? 'w' : 'g'}">${st.wrong} 道错题</span>
    </div>

    ${missTop.length ? `<h3 style="font-size:14px;margin:14px 0 6px">错得最多的知识点</h3>
      <p class="hint" style="margin:0 0 6px">带底色的是他自己也标了「没掌握」</p>
      <div class="picks">${missTop.map(([sid, n]) =>
        `<span class="badge ${flagged.has(sid) ? 'w' : 'g'}">${esc(skillName(sid))} ×${n}</span>`
      ).join('')}</div>` : ''}

    ${Object.keys(reasons).length ? `<h3 style="font-size:14px;margin:14px 0 6px">错因分布</h3>
      <div class="picks">${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
        `<span class="badge g">${REASON_LABEL[k] || k} ×${n}</span>`).join('')}</div>` : ''}

    <h3 style="font-size:14px;margin:16px 0 6px">练习记录</h3>
    ${mine.slice(0, 40).map(r => {
      const q = DATA.questions.find(x => x.id === r.question_id);
      return `<details class="qitem" style="margin-left:0">
        <summary>
          <span class="caret">▶</span>
          <strong>${q ? esc(skillName(q.s)) : esc(r.question_id)}</strong>
          ${q ? `<span class="diff ${q.x}">${LEVEL[q.x]}</span>` : ''}
          <span class="badge ${r.result === 'correct' ? '' : 'b'}">${
            r.result === 'correct' ? '做对' : '做错'}</span>
          ${(r.reasons || []).map(k =>
            `<span class="badge g">${REASON_LABEL[k] || k}</span>`).join('')}
          <span class="n">${day(r.created_at)}</span>
        </summary>
        <div class="qbody" data-q="${esc(r.question_id)}" data-ans="${esc(r.note || '')}"
             data-photo="${esc(r.photo_path || '')}"></div>
      </details>`;
    }).join('')}`;

  for (const el of $('detail').querySelectorAll('.qitem')) {
    el.addEventListener('toggle', () => el.open && fillBody(el), { once: true });
  }
}

async function fillBody(item) {
  const body = item.querySelector('.qbody');
  const q = DATA.questions.find(x => x.id === body.dataset.q);
  const photo = body.dataset.photo;
  body.innerHTML = (q
      ? q.i.map(src => `<img class="paper" loading="lazy" src="${B}${src}" alt="题目">`).join('')
        + `<div class="hint">他填的：${esc(body.dataset.ans || '—')}　正确答案：${esc(q.a || '—')}</div>`
      : '')
    + (photo ? '<div class="hint" data-slot="1">订正照片加载中…</div>' : '');
  if (photo) {
    const url = await db.photoUrl(photo);
    const slot = body.querySelector('[data-slot]');
    if (slot) {
      slot.outerHTML = url
        ? `<img class="paper" loading="lazy" src="${url}" alt="学生订正">`
        : '<div class="hint">照片打不开</div>';
    }
  }
}

// ------------------------------------------------------- class weak spots

function renderWeak() {
  // Two different signals: what the class actually gets wrong, and what they
  // admit to not understanding. They do not always agree.
  const miss = {}, flag = {};
  for (const r of rows) {
    const q = DATA.questions.find(x => x.id === r.question_id);
    if (q) {
      miss[q.s] = miss[q.s] || { n: 0, wrong: 0, who: new Set() };
      miss[q.s].n += 1;
      if (r.result !== 'correct') { miss[q.s].wrong += 1; miss[q.s].who.add(r.student_id); }
    }
    for (const sid of r.weak_sections || []) flag[sid] = (flag[sid] || 0) + 1;
  }
  const ranked = Object.entries(miss)
    .filter(([, v]) => v.wrong)
    .sort((a, b) => b[1].who.size - a[1].who.size || b[1].wrong - a[1].wrong);

  $('weakSections').innerHTML = `
    <h3 style="margin:0 0 4px;font-size:15px">全班薄弱知识点</h3>
    <p class="hint" style="margin:0 0 12px">按错的人数排序；「自己标」是学生主动勾了没掌握的次数</p>
    ${ranked.length ? `<table><thead><tr>
        <th>知识点</th><th>错/做</th><th>人数</th><th>自己标</th></tr></thead>
      <tbody>${ranked.slice(0, 25).map(([sid, v]) =>
        `<tr><td>${esc(skillName(sid))}</td>
          <td>${v.wrong}/${v.n}</td><td>${v.who.size}</td>
          <td>${flag[sid] || '<span class="hint">0</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">还没有数据</div>'}`;

  const reasons = {};
  for (const r of rows) for (const k of r.reasons || []) reasons[k] = (reasons[k] || 0) + 1;
  const total = Object.values(reasons).reduce((a, b) => a + b, 0);

  $('reasonMix').innerHTML = `
    <h3 style="margin:0 0 4px;font-size:15px">错因分布</h3>
    <p class="hint" style="margin:0 0 12px">多是「抄错/算错」是习惯问题，多是「知识点不会」才要回去讲</p>
    ${total ? `<table><tbody>${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<tr><td style="width:34%">${REASON_LABEL[k] || k}</td>
        <td><div class="row" style="gap:8px"><div class="bar-gauge" style="flex:1">
          <span style="width:${Math.round((n / total) * 100)}%"></span></div>
          <span class="hint">${n}</span></div></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">还没有数据</div>'}`;
}

// ------------------------------------------------------------- assignments
// Only the board-specific description lives here; the picker itself is shared.

function mountAssign() {
  assign.mountPicker($('picker'), {
    questions: DATA.questions,
    students,
    facets: [
      { id: 'd', name: '领域', values: q => [q.d],
        display: v => DATA.domains.find(x => x.id === v)?.name || v },
      { id: 's', name: '知识点', values: q => [q.s],
        display: v => DATA.skills[v]?.name || v },
      { id: 'x', name: '难度', values: q => [q.x], display: v => LEVEL[v] || v },
    ],
    label: q => DATA.skills[q.s]?.name || q.id,
    note: q => LEVEL[q.x] || q.x,
    preview: q => q.i.map(src => B + src),
    onSaved: async (row, msg) => {
      toast(msg);
      if (row) { sets = await db.myAssignments(); renderAssignList(); }
    },
  });
  renderAssignList();
}

function renderAssignList() {
  assign.renderTeacherList($('assignList'), {
    assignments: sets, attempts: rows, students,
    onDeleted: async err => {
      if (err) return toast('删除失败：' + err);
      sets = await db.myAssignments();
      renderAssignList();
      toast('已删除');
    },
  });
}

boot();
