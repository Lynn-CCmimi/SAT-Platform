// A student's own picture of their practice, shared by every exam board.
//
// The teacher dashboard already computes weak topics and reason mixes for the
// class; students never saw any of it and could not tell where their marks
// were going. This puts the same reading in front of them.
//
// Board-specific bits come in as accessors, like assign.js:
//   topicsOf(q) -> id[], topicName(id) -> string, sectionName(id) -> string,
//   reasonLabel(key) -> string; papers + gradeOf are optional (A-Level only).

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DAY = 86400000;

function gauge(pct, tone = '') {
  return `<div class="bar-gauge" style="flex:1"><span style="width:${pct}%${
    tone ? `;background:var(--${tone})` : ''}"></span></div>`;
}

export function render(el, { attempts, questions, topicsOf, topicName, reasonLabel,
                             sectionName = id => id, papers = [], gradeOf = null,
                             boundaries = null, onOpenQuestion = null }) {
  if (!attempts.length) {
    el.innerHTML = '<div class="empty">还没有练习记录，做几道题再来看</div>';
    return;
  }
  const byId = new Map(questions.map(q => [q.id, q]));
  const now = Date.now();
  const recent = attempts.filter(a => now - new Date(a.created_at) < 30 * DAY);

  // ---- headline
  const correct = attempts.filter(a => a.result === 'correct').length;
  const distinct = new Set(attempts.map(a => a.question_id)).size;
  const rate = Math.round((correct / attempts.length) * 100);
  const rateRecent = recent.length
    ? Math.round((recent.filter(a => a.result === 'correct').length / recent.length) * 100) : null;

  // ---- by topic: every attempt counts, a topic spanning question counts once per topic
  const topic = new Map();
  for (const a of attempts) {
    const q = byId.get(a.question_id);
    if (!q) continue;
    for (const t of topicsOf(q)) {
      const row = topic.get(t) || { n: 0, wrong: 0, flagged: 0 };
      row.n += 1;
      if (a.result !== 'correct') row.wrong += 1;
      topic.set(t, row);
    }
  }
  // "I don't get this" flags land on sections; roll them up to their topic
  // when the site can tell us, otherwise list them on their own
  const flagged = new Map();
  for (const a of attempts) {
    for (const w of a.weak_sections || []) flagged.set(w, (flagged.get(w) || 0) + 1);
  }
  const topics = [...topic.entries()]
    .filter(([, r]) => r.n >= 2)
    .sort((a, b) => (b[1].wrong / b[1].n) - (a[1].wrong / a[1].n) || b[1].wrong - a[1].wrong);

  // ---- reasons
  const reasons = new Map();
  for (const a of attempts) for (const r of a.reasons || []) reasons.set(r, (reasons.get(r) || 0) + 1);
  const reasonTotal = [...reasons.values()].reduce((x, y) => x + y, 0);

  // ---- wrong more than once
  const wrongCount = new Map();
  for (const a of attempts) {
    if (a.result === 'correct') continue;
    wrongCount.set(a.question_id, (wrongCount.get(a.question_id) || 0) + 1);
  }
  const repeat = [...wrongCount.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  // ---- mock papers
  const done = papers.filter(p => p.finished_at).sort((a, b) => a.created_at.localeCompare(b.created_at));

  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="gap:14px">
        <span class="badge g">做过 ${distinct} 道题 · ${attempts.length} 次</span>
        <span class="badge ${rate >= 70 ? '' : 'w'}">总正确率 ${rate}%</span>
        ${rateRecent !== null ? `<span class="badge g">最近 30 天 ${recent.length} 次 · 正确率 ${rateRecent}%</span>` : ''}
      </div>
    </div>

    <div class="split">
      <div class="card">
        <h3 style="margin:0 0 4px;font-size:15px">哪些知识点最容易错</h3>
        <p class="hint" style="margin:0 0 10px">按错误率排，只算做过 2 题以上的</p>
        ${topics.length ? `<table><tbody>${topics.slice(0, 12).map(([t, r]) => {
          const pct = Math.round((r.wrong / r.n) * 100);
          return `<tr><td style="width:44%">${esc(topicName(t))}</td>
            <td><div class="row" style="gap:8px">${gauge(pct, pct >= 50 ? 'bad' : pct >= 25 ? 'warn' : '')}
              <span class="hint" style="white-space:nowrap">错 ${r.wrong}/${r.n}</span></div></td></tr>`;
        }).join('')}</tbody></table>` : '<div class="hint">还没有哪个知识点做够 2 题</div>'}

        ${flagged.size ? `
          <h3 style="margin:18px 0 4px;font-size:15px">自己标过「没掌握」的</h3>
          <div class="picks">${[...flagged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w, n]) =>
            `<span class="badge w">${esc(sectionName(w))}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</div>` : ''}
      </div>

      <div>
        <div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 4px;font-size:15px">错在哪一类</h3>
          <p class="hint" style="margin:0 0 10px">「跳步」「答案形式」是习惯问题，改起来最快；「知识点不会」才需要回去学</p>
          ${reasonTotal ? `<table><tbody>${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) =>
            `<tr><td style="width:40%">${esc(reasonLabel(r))}</td>
              <td><div class="row" style="gap:8px">${gauge(Math.round((n / reasonTotal) * 100))}
                <span class="hint">${n}</span></div></td></tr>`).join('')}</tbody></table>`
            : '<div class="hint">错题时点一下错因，这里才会有内容</div>'}
        </div>

        ${repeat.length ? `<div class="card" style="margin-bottom:12px">
          <h3 style="margin:0 0 4px;font-size:15px">错过不止一次的题</h3>
          <p class="hint" style="margin:0 0 10px">同一道题错两次，多半是知识点没真懂</p>
          <div class="picks">${repeat.slice(0, 10).map(([id, n]) => {
            const q = byId.get(id);
            const label = q ? topicsOf(q).map(topicName).join(' / ') : id;
            return onOpenQuestion
              ? `<button class="pick" data-q="${esc(id)}">${esc(label)} ×${n}</button>`
              : `<span class="badge b">${esc(label)} ×${n}</span>`;
          }).join('')}</div>
        </div>` : ''}

        ${done.length ? `<div class="card">
          <h3 style="margin:0 0 10px;font-size:15px">模拟卷</h3>
          <table><tbody>${done.slice(-8).map(p => {
            const earned = Object.values(p.scores || {}).reduce((x, y) => x + (Number(y) || 0), 0);
            const g = gradeOf && boundaries ? gradeOf(earned, p.unit, boundaries) : null;
            return `<tr><td style="width:36%">${esc(p.unit)} · ${new Date(p.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</td>
              <td><strong>${earned} / ${p.max_marks}</strong></td>
              <td>${g ? `<span class="badge ${g.grade === 'U' ? 'b' : ''}">${g.grade}</span>` : ''}</td></tr>`;
          }).join('')}</tbody></table>
        </div>` : ''}
      </div>
    </div>`;

  if (onOpenQuestion) {
    for (const b of el.querySelectorAll('[data-q]')) b.onclick = () => onOpenQuestion(b.dataset.q);
  }
}
