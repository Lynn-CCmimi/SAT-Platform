// What a student has actually been taught, and which questions fit inside it.
//
// Syllabus topics are not the same shape as textbook chapters - one topic can
// swallow four chapters - and real papers mix chapters inside a single
// question. So "has this student covered it?" cannot be answered from the
// topic label; it has to come from the section each sub-question is anchored
// to. A question is in reach when every unit it touches has been covered at
// least as far as the deepest chapter it needs.
//
// progress: { unit: chapter } - a unit that is absent is not filtered at all,
// so nothing is hidden until the teacher actually records where someone is.

const chapterOf = sectionId => {
  const n = Number(String(sectionId).split('.')[1]);
  return Number.isFinite(n) ? n : null;
};

// The deepest chapter this question needs, per unit: { P2: 7, P3: 4 }.
// `roles` narrows it to what is actually examined; the default counts the
// methods and prerequisites too, since a student who cannot do those is stuck
// all the same.
export function reachOf(q, sections, roles = null) {
  const need = {};
  for (const p of q.points || []) {
    if (roles && !roles.includes(p.role)) continue;
    const s = sections[p.section];
    const ch = chapterOf(p.section);
    if (!s || ch == null) continue;
    const u = s.unit || q.unit;
    need[u] = Math.max(need[u] || 0, ch);
  }
  // a question with no anchors at all still belongs to its own paper
  if (!Object.keys(need).length) need[q.unit] = 0;
  return need;
}

export function inReach(q, progress, sections) {
  if (!progress || !Object.keys(progress).length) return true;
  const need = reachOf(q, sections);
  for (const [u, ch] of Object.entries(need)) {
    const has = progress[u];
    if (has == null) continue;            // unit not recorded: do not filter
    if (ch > has) return false;
  }
  return true;
}

// Why a question is out of reach, for the "N 道超出范围" explanations.
export function beyond(q, progress, sections) {
  const need = reachOf(q, sections);
  return Object.entries(need)
    .filter(([u, ch]) => progress?.[u] != null && ch > progress[u])
    .map(([u, ch]) => `${u} 第 ${ch} 章`);
}

// How many of that unit's questions open up at each chapter of it - the table behind
// the chapter picker, so the teacher sees what setting a level actually does.
export function reachTable(unit, questions, sections, progress = {}) {
  const chapters = new Set();
  for (const s of Object.values(sections)) {
    if (s.unit === unit) chapters.add(Number(String(s.section).split('.')[0]));
  }
  const max = Math.max(0, ...[...chapters].filter(Number.isFinite));
  const rows = [];
  for (let n = 1; n <= max; n++) {
    const at = { ...progress, [unit]: n };
    rows.push({ chapter: n,
                n: questions.filter(q => q.unit === unit && inReach(q, at, sections)).length });
  }
  return rows;
}
