import * as db from './db.js?v=985fa28a';
import * as assign from './assign.js?v=985fa28a';
import * as photos from './photos.js?v=985fa28a';
import * as analysis from './analysis.js?v=985fa28a';
import * as pdf from './pdf.js?v=985fa28a';
import * as history from './history.js?v=985fa28a';

const B = 'data/bank/';
const LEVEL = { easy: '简单', medium: '中等', hard: '困难' };
const REASONS = [
  ['misread', '看错题'], ['slip', '抄错/算错'], ['unknown', '知识点不会'],
  ['stuck', '知道方法但卡住'], ['english', '英文没读懂'], ['time', '时间不够'],
  ['other', '其他'],
];

let DATA = null;
let ME = null;
let ATTEMPTS = [];
let ASSIGNMENTS = [];
let active = null;        // the assignment being worked through, if any
let pickDomain = null;
let pickSkill = null;
const pickLevel = new Set();
let cur = null;          // question on screen
let state = null;        // answer state for cur

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2200);
}

// ------------------------------------------------------------ answer check
// College Board lists every accepted form of a student-produced response in
// one field, comma separated: ".0177, .0178, 4/225" are the same number, while
// "15, -5" are two different valid roots. Either way, matching any one is right.

const decimals = s => (s.split('.')[1] || '').length;

function value(s) {
  const t = s.trim().replace(/^\+/, '');
  const frac = t.match(/^(-?\d*\.?\d+)\/(\d*\.?\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

function accepts(answer, given) {
  // a comma never belongs in a student's entry, but they do type thousands
  // separators out of habit - that is not a wrong answer
  const typed = String(given).trim().replace(/,/g, '');
  if (!answer || !typed) return false;
  const g = value(typed);
  return answer.split(',').map(s => s.trim()).filter(Boolean).some(v => {
    if (v.toLowerCase() === typed.toLowerCase()) return true;
    const a = value(v);
    if (!Number.isFinite(a) || !Number.isFinite(g)) return false;
    if (Math.abs(a - g) < 1e-9) return true;
    // a repeating decimal may be entered truncated or rounded, but only at the
    // precision the student actually typed
    const d = decimals(typed);
    if (d < 3) return false;
    const p = 10 ** d;
    return Math.abs(g - Math.trunc(a * p) / p) < 1e-9
        || Math.abs(g - Math.round(a * p) / p) < 1e-9;
  });
}

export { accepts };   // pure, and the one piece worth testing on its own

// ------------------------------------------------------------------- boot

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
  ME = await db.profile(user.id);
  $('gate').hidden = true;
  $('shell').hidden = false;
  $('who').textContent = ME.display_name;
  $('logout').onclick = async () => { await db.signOut(); location.reload(); };
  $('tabPractice').onclick = () => tab('Practice');
  $('tabWork').onclick = () => { tab('Work'); renderWork(); };
  $('tabWrong').onclick = () => { tab('Wrong'); renderWrong(); };
  $('tabAnalysis').onclick = () => { tab('Analysis'); renderAnalysis(); };

  [ATTEMPTS, ASSIGNMENTS] = await Promise.all([db.myAttempts(), db.myAssignments()]);
  // the dot is the only thing telling a student there is homework, so it has
  // to be set after the data is in, not while wiring up the tabs
  if (ASSIGNMENTS.some(a => assign.progressOf(a, ATTEMPTS).done < a.question_ids.length)) {
    $('tabWork').innerHTML = '作业 <b style="color:var(--bad)">•</b>';
  }
  pickDomain = DATA.domains[0].id;
  renderFilters();
  renderList();
}

function tab(name) {
  for (const key of ['Practice', 'Work', 'Wrong', 'Analysis']) {
    $('tab' + key).setAttribute('aria-selected', key === name);
    $('view' + key).hidden = key !== name;
  }
}

// ------------------------------------------------------------- attempts

const latest = {};   // question id -> most recent attempt
function reindex() {
  for (const k of Object.keys(latest)) delete latest[k];
  for (const a of ATTEMPTS) if (!latest[a.question_id]) latest[a.question_id] = a;
}

const statusOf = id => latest[id] ? (latest[id].result === 'correct' ? 'ok' : 'bad') : null;

// -------------------------------------------------------------- filters

function visible() {
  if (active) {
    const want = new Set(active.question_ids);
    return DATA.questions.filter(q => want.has(q.id));
  }
  return DATA.questions.filter(q =>
    (!pickDomain || q.d === pickDomain)
    && (!pickSkill || q.s === pickSkill)
    && (!pickLevel.size || pickLevel.has(q.x)));
}

function chip(label, on, extra = '') {
  return `<button class="chip" aria-pressed="${on}" ${extra}>${label}</button>`;
}

function renderWork() {
  assign.renderStudentList($('workList'), {
    assignments: ASSIGNMENTS, attempts: ATTEMPTS, onOpen: openAssignment,
  });
}

const LEVEL_EN = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
function pdfSpec(a, kind) {
  const qs = a.question_ids.map(id => DATA.questions.find(q => q.id === id)).filter(Boolean);
  return {
    title: `作业 ${a.title}`,
    fileName: `作业-${a.title.replace(/[\\/:*?"<>|]/g, '')}${kind === 'answers' ? '-答案' : ''}.pdf`,
    lines: [`共 ${qs.length} 题`],
    items: qs.map((q, i) => ({
      label: `Q${i + 1}`,
      note: `${DATA.skills[q.s]?.name || ''} · ${LEVEL_EN[q.x] || q.x}`,
      marks: null,
      images: (kind === 'answers' ? q.r : q.i).map(src => B + src),
    })).filter(it => it.images.length),
  };
}

function openAssignment(a) {
  active = a;
  cur = null;
  tab('Practice');
  $('qpanel').innerHTML = '<div class="empty">从左边选一道题</div>';
  renderFilters();
  renderList();
}

function renderFilters() {
  reindex();
  const bar = $('assignBar');
  bar.innerHTML = '';
  for (const id of ['domains', 'skills', 'levels']) $(id).hidden = Boolean(active);
  if (active) {
    bar.appendChild(assign.banner(active, ATTEMPTS, {
      parts: assign.composition(active, DATA.questions,
        q => [DATA.skills[q.s]?.name].filter(Boolean)),
      onExit: () => {
        active = null;
        cur = null;
        $('qpanel').innerHTML = '<div class="empty">从左边选一道题</div>';
        renderFilters();
        renderList();
      },
    }));
    const tools = document.createElement('div');
    tools.className = 'row';
    tools.style.cssText = 'margin:-4px 0 12px';
    bar.appendChild(tools);
    pdf.buttons(tools, { set: kind => pdfSpec(active, kind), onError: toast });
    return;
  }
  const done = list => list.filter(q => latest[q.id]).length;

  $('domains').innerHTML = DATA.domains.map(d => {
    const qs = DATA.questions.filter(q => q.d === d.id);
    return chip(`${esc(d.name)}<b>${done(qs)}/${qs.length}</b>`,
      pickDomain === d.id, `data-d="${d.id}"`);
  }).join('');

  const dom = DATA.domains.find(d => d.id === pickDomain);
  $('skills').innerHTML = chip('全部知识点', !pickSkill, 'data-s=""')
    + (dom ? dom.skills.map(s => {
      const qs = DATA.questions.filter(q => q.s === s.id);
      return chip(`${esc(s.name)}<b>${done(qs)}/${qs.length}</b>`,
        pickSkill === s.id, `data-s="${s.id}"`);
    }).join('') : '');

  $('levels').innerHTML = Object.entries(LEVEL).map(([k, v]) =>
    chip(v, pickLevel.has(k), `data-x="${k}"`)).join('');

  for (const el of $('domains').children) el.onclick = () => {
    pickDomain = el.dataset.d; pickSkill = null; renderFilters(); renderList();
  };
  for (const el of $('skills').children) el.onclick = () => {
    pickSkill = el.dataset.s || null; renderFilters(); renderList();
  };
  for (const el of $('levels').children) el.onclick = () => {
    const x = el.dataset.x;
    pickLevel.has(x) ? pickLevel.delete(x) : pickLevel.add(x);
    renderFilters(); renderList();
  };
}

// keep=true after an answer is saved: the list is rebuilt for the status dot,
// and the student should stay where they were, not be sent back to the top
function renderList(keep = false) {
  const keepScroll = keep ? $('qlist').scrollTop : 0;
  const qs = visible();
  if (!qs.length) {
    $('qlist').innerHTML = '<div class="empty">没有符合条件的题</div>';
    return;
  }
  $('qlist').innerHTML = qs.map((q, i) => {
    const st = statusOf(q.id);
    return `<div class="item" data-id="${q.id}" aria-current="${cur?.id === q.id}">
      <span class="q">${i + 1}</span>
      <span>${esc(DATA.skills[q.s].name)}</span>
      <span class="meta">
        <span class="diff ${q.x}">${LEVEL[q.x] || q.x}</span>
        ${st ? `<span class="dot ${st}"></span>` : ''}
      </span>
    </div>`;
  }).join('');
  for (const el of $('qlist').children) el.onclick = () => show(el.dataset.id);
  $('qlist').scrollTop = keepScroll;
}

// ------------------------------------------------------------- question

function show(id) {
  cur = DATA.questions.find(q => q.id === id);
  state = { chosen: null, submitted: false, right: false, attempt: null,
            reasons: new Set(), weak: false, up: null };
  renderList(true);        // only the highlight changes; stay put
  renderPanel();
  $('qpanel').scrollIntoView({ block: 'nearest' });
}

function renderPanel() {
  const q = cur;
  const skill = DATA.skills[q.s];
  $('qpanel').innerHTML = `
    <div class="qhead">
      <h2>${esc(skill.domain)} · ${esc(skill.name)}</h2>
      <span class="diff ${q.x}">${LEVEL[q.x] || q.x}</span>
    </div>
    <div id="hist" hidden></div>
    ${q.i.map(src => `<img class="paper" loading="lazy" src="${B}${src}" alt="题目">`).join('')}
    <div class="assess" id="answer"></div>
    <div id="after"></div>`;
  history.render($('hist'), ATTEMPTS.filter(a => a.question_id === q.id), {
    reasonLabel: k => (REASONS.find(r => r[0] === k) || [, k])[1],
    word: r => (r === 'correct' ? '做对' : '做错'),
    extra: a => (a.note ? '填的 ' + a.note : null),
  });
  renderAnswer();
}

function renderAnswer() {
  const q = cur;
  const done = state.submitted;
  $('answer').innerHTML = `
    <h3>你的答案</h3>
    ${q.t === 'mcq'
      ? `<div class="choices">${['A', 'B', 'C', 'D'].map(c =>
          `<button class="choice" data-c="${c}" aria-pressed="${state.chosen === c}" ${
            done ? 'disabled' : ''}>${c}</button>`).join('')}</div>`
      : `<input class="spr" id="spr" placeholder="例如 6 或 3/4" ${done ? 'disabled' : ''}
                value="${esc(state.chosen || '')}" inputmode="text">`}
    ${done ? '' : '<div class="row" style="margin-top:12px">'
        + '<button class="act" id="submit">提交</button>'
        + '<span class="hint">提交后才能看解析</span></div>'}`;

  if (q.t === 'mcq') {
    for (const el of $('answer').querySelectorAll('.choice')) {
      el.onclick = () => { state.chosen = el.dataset.c; renderAnswer(); };
    }
  } else if (!done) {
    const box = $('spr');
    box.oninput = () => { state.chosen = box.value; };
    box.onkeydown = e => { if (e.key === 'Enter') submit(); };
  }
  if (!done) $('submit').onclick = submit;
}

async function submit() {
  const q = cur;
  const given = q.t === 'mcq' ? state.chosen : ($('spr')?.value || '').trim();
  if (!given) return toast(q.t === 'mcq' ? '先选一个选项' : '先填一个答案');

  state.chosen = given;
  state.right = q.t === 'mcq' ? given === q.a : accepts(q.a, given);
  state.submitted = true;
  renderAnswer();
  renderAfter();

  try {
    state.attempt = await db.saveAttempt({
      student_id: ME.id,
      question_id: q.id,
      unit: q.d,
      result: state.right ? 'correct' : 'unknown',
      marks: state.right ? 1 : 0,
      assignment_id: active?.id ?? null,
      note: given,
    });
    ATTEMPTS.unshift(state.attempt);
    reindex();
    renderFilters();
    renderList(true);
  } catch (err) {
    toast('记录没存上：' + (err.message || err));
  }
}

function renderAfter() {
  const q = cur;
  const skill = DATA.skills[q.s];
  $('after').innerHTML = `
    <div class="verdict ${state.right ? 'ok' : 'no'}">
      ${state.right ? '✓ 正确' : '✗ 不对'}
      <span class="key">正确答案：${esc(q.a || '—')}${
        q.t === 'spr' && (q.a || '').includes(',') ? '（任一即可）' : ''}</span>
    </div>
    ${q.r.length ? `<details class="solution" ${state.right ? '' : 'open'}>
      <summary>官方解析</summary>
      ${q.r.map(src => `<img class="paper" loading="lazy" src="${B}${src}" alt="解析">`).join('')}
    </details>` : ''}
    ${state.right ? '' : `
      <div class="assess">
        <h3>为什么错了？</h3>
        <div class="picks" id="reasons">${REASONS.map(([k, v]) =>
          `<button class="pick" data-k="${k}" aria-pressed="false">${v}</button>`).join('')}</div>
        <input class="spr" id="otherNote" hidden placeholder="写一下是什么问题"
               style="width:100%;max-width:480px;margin-top:8px;font-size:14px" maxlength="120">

        <div class="ref"><div class="h">这道题考的知识点</div>
          <div class="picks"><button class="pick sec" id="weak" aria-pressed="false">${
            esc(skill.name)}<span class="hint" style="margin-left:6px">点一下表示没掌握</span></button></div>
        </div>

        <div class="ref"><div class="h">照着解析订正一遍，拍照传上来<span
              class="hint">写了两页就传两张，最多 6 张</span></div>
          <div id="shots"></div>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="act" id="save">存进错题本</button>
        </div>
      </div>`}`;

  if (state.right) return;
  for (const el of $('reasons').children) {
    el.onclick = () => {
      const k = el.dataset.k;
      state.reasons.has(k) ? state.reasons.delete(k) : state.reasons.add(k);
      el.setAttribute('aria-pressed', state.reasons.has(k));
      if (k === 'other') {
        $('otherNote').hidden = !state.reasons.has('other');
        if (!$('otherNote').hidden) $('otherNote').focus();
      }
    };
  }
  $('weak').onclick = () => {
    state.weak = !state.weak;
    $('weak').setAttribute('aria-pressed', state.weak);
  };
  state.up = photos.uploader($('shots'), { onError: toast });
  $('save').onclick = saveDetail;
}

async function saveDetail() {
  if (!state.attempt) return toast('这次记录没存上，刷新后重做一次');
  const btn = $('save');
  btn.disabled = true;
  try {
    const patch = {
      reasons: [...state.reasons],
      reason_note: state.reasons.has('other') ? ($('otherNote')?.value.trim() || null) : null,
      weak_sections: state.weak ? [cur.s] : [],
    };
    if (state.up?.blobs.length) {
      patch.photo_paths = await photos.uploadAll(ME.id, cur.id, state.up.blobs);
    }
    await db.updateAttempt(state.attempt.id, patch);
    Object.assign(state.attempt, patch);
    reindex();
    toast('已存进错题本');
  } catch (err) {
    toast('没存上：' + (err.message || err));
  }
  btn.disabled = false;
}

// ------------------------------------------------------------------ analysis

function renderAnalysis() {
  const skillName = id => DATA.skills[id]?.name || id;
  analysis.render($('analysis'), {
    attempts: ATTEMPTS,
    questions: DATA.questions,
    topicsOf: q => [q.s],
    topicName: skillName,
    sectionName: skillName,
    reasonLabel: k => (REASONS.find(r => r[0] === k) || [, k])[1],
    onOpenQuestion: id => { tab('Practice'); show(id); },
  });
}

// ----------------------------------------------------------- error notebook
// Three levels: knowledge point, then each wrong question, then the question
// itself. Everything starts collapsed so the shape is readable at a glance.

let wrongReason = null;

function renderWrong() {
  reindex();
  const wrong = ATTEMPTS.filter(a => a.result !== 'correct');

  $('wrongFilter').innerHTML = chip('全部', !wrongReason, 'data-k=""')
    + REASONS.map(([k, v]) => {
        const n = wrong.filter(a => (a.reasons || []).includes(k)).length;
        return n ? chip(`${v}<b>${n}</b>`, wrongReason === k, `data-k="${k}"`) : '';
      }).join('');
  for (const el of $('wrongFilter').children) el.onclick = () => {
    wrongReason = el.dataset.k || null; renderWrong();
  };

  const rows = wrongReason
    ? wrong.filter(a => (a.reasons || []).includes(wrongReason)) : wrong;
  if (!rows.length) {
    $('wrongList').innerHTML = '<div class="empty">还没有错题</div>';
    return;
  }

  // group by the point the student flagged, else by the question's own skill
  const groups = {};
  for (const a of rows) {
    const q = DATA.questions.find(x => x.id === a.question_id);
    const key = (a.weak_sections || [])[0] || q?.s || 'other';
    (groups[key] = groups[key] || []).push(a);
  }
  const order = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  $('wrongList').innerHTML = order.map(([key, list]) => {
    const s = DATA.skills[key];
    return `<details class="grp">
      <summary><span class="caret">▶</span>
        ${s ? `${esc(s.domain)} · ${esc(s.name)}` : '其他'}
        <span class="n">${list.length} 题</span></summary>
      ${list.map(a => {
        const q = DATA.questions.find(x => x.id === a.question_id);
        return `<details class="qitem">
          <summary><span class="caret">▶</span>
            <strong>${q ? esc(DATA.skills[q.s].name) : esc(a.question_id)}</strong>
            ${q ? `<span class="diff ${q.x}">${LEVEL[q.x]}</span>` : ''}
            ${(a.reasons || []).map(k =>
              `<span class="badge g">${k === 'other' && a.reason_note
                ? '其他：' + esc(a.reason_note)
                : (REASONS.find(r => r[0] === k) || [, k])[1]}</span>`).join('')}
            <span class="n">${new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
          </summary>
          <div class="qbody" data-a="${a.id}"></div>
        </details>`;
      }).join('')}
    </details>`;
  }).join('');

  for (const el of $('wrongList').querySelectorAll('.qitem')) {
    el.addEventListener('toggle', () => el.open && fillWrongBody(el), { once: true });
  }
}

async function fillWrongBody(item) {
  const body = item.querySelector('.qbody');
  const a = ATTEMPTS.find(x => String(x.id) === body.dataset.a);
  const q = DATA.questions.find(x => x.id === a.question_id);
  body.innerHTML = (q
      ? q.i.map(src => `<img class="paper" loading="lazy" src="${B}${src}" alt="题目">`).join('')
        + `<div class="hint">你的答案：${esc(a.note || '—')}　正确答案：${esc(q.a || '—')}</div>`
        + (q.r.length ? `<details class="solution"><summary>官方解析</summary>${
            q.r.map(src => `<img class="paper" loading="lazy" src="${B}${src}" alt="解析">`).join('')
          }</details>` : '')
      : '')
    + '<div class="ref"><div class="h">订正照片</div><div data-shots></div></div>';

  // editable here: a blurry shot or an extra page should not mean redoing the
  // question just to attach a better photo
  await photos.gallery(body.querySelector('[data-shots]'), a, {
    editable: true,
    userId: ME.id,
    onChange: (paths, err, action) =>
      toast(err || (action === 'remove' ? '照片已删除' : '照片已保存')),
  });
}

boot();
