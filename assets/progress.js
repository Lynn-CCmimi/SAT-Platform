// Recording how far a student has got in each textbook.
//
// The point is not bookkeeping: it is that exam questions mix chapters, so
// without this the site hands a student who has covered two chapters a
// question that needs five. Each row shows what setting a chapter actually
// unlocks, so the number is chosen against the consequence, not in the dark.

import * as db from './db.js?v=e286b7b4';
import * as scope from './scope.js?v=e286b7b4';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// units: [{ id, name }]  as the board orders them
export function render(el, { student, units, questions, sections, chapterNames = () => null,
                             onSaved, onError = () => {} }) {
  let now = { ...db.progressOf(student) };

  function draw() {
    const rows = units.map(u => {
      const table = scope.reachTable(u.id, questions, sections, now);
      const at = now[u.id];
      const total = questions.filter(q => q.unit === u.id).length;
      if (!table.length || !total) return '';
      const open = at == null ? total : table.find(r => r.chapter === at)?.n ?? total;
      return `<tr>
        <td style="width:16%"><strong>${esc(u.id)}</strong><br><span class="hint">${esc(u.name || '')}</span></td>
        <td><div class="chips" style="margin:0" data-u="${esc(u.id)}">
          <button class="chip" data-ch="" aria-pressed="${at == null}">未设置</button>
          ${table.map(r => `<button class="chip" data-ch="${r.chapter}" aria-pressed="${at === r.chapter}"
              title="${esc(chapterNames(u.id, r.chapter) || '')}">Ch${r.chapter}<b>${r.n}</b></button>`).join('')}
        </div></td>
        <td style="width:22%" class="hint">${at == null
          ? '不筛选，全部 ' + total + ' 道'
          : `能做 ${open} / ${total} 道`}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <h3 style="font-size:14px;margin:16px 0 4px">学到哪儿了</h3>
      <p class="hint" style="margin:0 0 8px">选到他学完的那一章。数字是选了之后他能做的题数——真卷常常一道题跨好几章，所以开头几章能做的题很少，这是正常的。</p>
      <table><tbody>${rows || '<tr><td class="empty">没有可设置的单元</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:10px">
        <button class="act" data-save>保存进度</button>
        <span class="hint" data-msg></span>
      </div>`;

    for (const box of el.querySelectorAll('.chips[data-u]')) {
      for (const b of box.querySelectorAll('[data-ch]')) {
        b.onclick = () => {
          const v = b.dataset.ch;
          if (v === '') delete now[box.dataset.u];
          else now[box.dataset.u] = Number(v);
          draw();
        };
      }
    }
    el.querySelector('[data-save]').onclick = async e => {
      e.target.disabled = true;
      try {
        await db.saveProgress(student.id, now);
        student.progress = { ...(student.progress || {}), ...{} };
        onSaved(now);
        el.querySelector('[data-msg]').textContent = '已保存';
      } catch (err) {
        e.target.disabled = false;
        onError(err.message || String(err));
      }
    };
  }

  draw();
}
