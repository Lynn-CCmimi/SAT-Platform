// Mock papers, shared by every exam board.
//
// A student assembles a paper shaped like the real thing - same number of
// questions, same climb in marks from first to last, same spread of topics -
// out of questions from many different real papers, then marks it themselves
// question by question and gets a total out of 75.
//
// The shape ("blueprint") is not invented here: the exporter reads it off the
// real papers of each unit. This module only fills it in.
//
// blueprint: { total, slots: [{marks, min, max}], topics: {id: share} }
// The site describes its own questions with accessors:
//   marksOf(q) -> number, topicsOf(q) -> id[], paperOf(q) -> string

import * as db from './db.js?v=b7deeab1';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------- generation

// Fill the blueprint slot by slot. Each slot takes the candidate that best
// closes the gap between marks-so-far-per-topic and the blueprint's targets,
// nudged toward the slot's typical mark value and away from questions already
// done. Two hard rules: no two questions from one real paper, and the total
// must land exactly on the blueprint's total - the feasibility check keeps the
// remaining slots able to reach it. Several randomised runs, best one wins.
export function generate(blueprint, pool, { marksOf, topicsOf, paperOf,
                                            doneIds = new Set(), tries = 80 } = {}) {
  const slots = blueprint.slots;
  const total = blueprint.total;
  const target = {};
  for (const [t, share] of Object.entries(blueprint.topics)) target[t] = share * total;

  const suffixMin = [], suffixMax = [], suffixTarget = [];
  for (let i = slots.length; i >= 0; i--) {
    suffixMin[i] = i === slots.length ? 0 : suffixMin[i + 1] + slots[i].min;
    suffixMax[i] = i === slots.length ? 0 : suffixMax[i + 1] + slots[i].max;
    suffixTarget[i] = i === slots.length ? 0 : suffixTarget[i + 1] + slots[i].marks;
  }
  // slot medians rarely sum to the total; spread that slack over the paper
  // instead of dumping it on the last question
  const slack = (total - suffixTarget[0]) / slots.length;

  let best = null;
  for (let run = 0; run < tries; run++) {
    const picked = [], papers = new Set(), have = {};
    let sum = 0, ok = true;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      let bestQ = null, bestScore = -Infinity;
      for (const q of pool) {
        const m = marksOf(q);
        if (picked.includes(q) || papers.has(paperOf(q))) continue;
        if (m < slot.min || m > slot.max) continue;
        const rem = total - sum - m;
        if (rem < suffixMin[i + 1] || rem > suffixMax[i + 1]) continue;

        const ts = topicsOf(q);
        let gain = 0;
        for (const t of ts) gain += Math.min(m / ts.length, Math.max(0, (target[t] || 0) - (have[t] || 0)));
        // gain as a fraction of the question's own marks, otherwise big
        // questions always win the early slots and the paper's climb from
        // short to long questions is lost
        const score = 3 * (gain / m)
          - 0.8 * Math.abs(m - (slot.marks + slack))
          - 0.3 * Math.abs(rem - (suffixTarget[i + 1] + slack * (slots.length - i - 1)))
          - (doneIds.has(q.id) ? 2.5 : 0)
          + Math.random() * 0.8;
        if (score > bestScore) { bestScore = score; bestQ = q; }
      }
      if (!bestQ) { ok = false; break; }
      picked.push(bestQ);
      papers.add(paperOf(bestQ));
      sum += marksOf(bestQ);
      const ts = topicsOf(bestQ);
      for (const t of ts) have[t] = (have[t] || 0) + marksOf(bestQ) / ts.length;
    }
    if (!ok || sum !== total) continue;

    let err = 0;
    for (const t of new Set([...Object.keys(target), ...Object.keys(have)])) {
      err += Math.abs((have[t] || 0) - (target[t] || 0));
    }
    const fresh = picked.filter(q => !doneIds.has(q.id)).length;
    const quality = -err + fresh * 0.5;
    if (!best || quality > best.quality) best = { ids: picked.map(q => q.id), quality, err };
  }
  return best;
}

// ------------------------------------------------------------------ score

export function scoreOf(paper) {
  const scores = paper.scores || {};
  let earned = 0, scored = 0;
  for (const id of paper.question_ids) {
    if (id in scores) { scored += 1; earned += Number(scores[id]) || 0; }
  }
  return { scored, total: paper.question_ids.length, earned, max: paper.max_marks,
           finished: scored >= paper.question_ids.length };
}

const when = t => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

function gauge(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="row" style="gap:8px">
    <div class="bar-gauge" style="flex:1"><span style="width:${pct}%"></span></div>
    <span class="hint">${done}/${total}</span></div>`;
}

// ------------------------------------------------------------ student list

export function renderList(el, { papers, unitName = u => u, onOpen, onDelete }) {
  if (!papers.length) {
    el.innerHTML = '<div class="empty">还没有模拟卷，上面选个单元生成一套</div>';
    return;
  }
  el.innerHTML = papers.map(p => {
    const s = scoreOf(p);
    return `<div class="card" style="margin-bottom:10px">
      <div class="qhead">
        <h2>${esc(unitName(p.unit))} 模拟卷</h2>
        <span class="badge g">${when(p.created_at)}</span>
        ${s.finished
          ? `<span class="badge">${s.earned} / ${s.max} 分</span>`
          : `<span class="badge w">做到第 ${s.scored + 1} 题</span>`}
      </div>
      ${gauge(s.scored, s.total)}
      <div class="row" style="margin-top:12px">
        <button class="act" data-open="${p.id}">${s.finished ? '回看' : '继续做'}</button>
        ${s.scored && !s.finished ? `<span class="hint">目前 ${s.earned} 分</span>` : ''}
        <span class="spacer"></span>
        <button class="plain" data-del="${p.id}">删除</button>
      </div>
    </div>`;
  }).join('');
  for (const b of el.querySelectorAll('[data-open]')) {
    b.onclick = () => onOpen(papers.find(p => String(p.id) === b.dataset.open));
  }
  for (const b of el.querySelectorAll('[data-del]')) {
    b.onclick = () => onDelete(papers.find(p => String(p.id) === b.dataset.del));
  }
}

// A strip above the practice list while a mock paper is open.
export function banner(paper, { unitName = u => u, onExit }) {
  const s = scoreOf(paper);
  const el = document.createElement('div');
  el.className = 'card';
  el.style.cssText = 'margin-bottom:12px;padding:12px 15px';
  el.innerHTML = `
    <div class="qhead" style="margin-bottom:8px">
      <h2>模拟卷：${esc(unitName(paper.unit))} · ${when(paper.created_at)}</h2>
      ${s.finished
        ? `<span class="badge">完成 · ${s.earned} / ${s.max} 分</span>`
        : `<span class="badge g">目前 ${s.earned} 分</span>`}
      <span class="spacer"></span>
      <button class="plain" data-exit>退出</button>
    </div>
    ${gauge(s.scored, s.total)}
    <div class="hint" style="margin-top:8px">按顺序做，每题对完答案填自己拿了几分。做完全部才出总分。</div>`;
  el.querySelector('[data-exit]').onclick = onExit;
  return el;
}

// Record one question's marks. Finishing is implicit: the last score sets
// finished_at.
export async function score(paper, questionId, marks) {
  const scores = { ...(paper.scores || {}), [questionId]: marks };
  const done = paper.question_ids.every(id => id in scores);
  const patch = { scores, finished_at: done ? new Date().toISOString() : null };
  await db.updateMockPaper(paper.id, patch);
  Object.assign(paper, patch);
  return scoreOf(paper);
}

// ------------------------------------------------------------ teacher view

export function renderTeacherRows(papers, { unitName = u => u } = {}) {
  if (!papers.length) return '';
  return `<h3 style="font-size:14px;margin:16px 0 6px">模拟卷</h3>
    <table><tbody>${papers.slice(0, 20).map(p => {
      const s = scoreOf(p);
      return `<tr>
        <td style="width:28%">${esc(unitName(p.unit))} · ${when(p.created_at)}</td>
        <td>${s.finished ? `<strong>${s.earned} / ${s.max}</strong>`
                         : `<span class="hint">做到第 ${s.scored + 1} 题，目前 ${s.earned} 分</span>`}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}
