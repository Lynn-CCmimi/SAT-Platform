// Paper output, shared by every exam board.
//
// Students wanted to work on paper: a set of questions - a mock paper or an
// assignment - as one PDF, one question per page with the rest of the page
// left blank for working, plus a matching answers PDF. Built in the browser
// from the same question images the site shows; nothing goes through a server.
//
// jsPDF cannot draw Chinese with its built-in fonts, so every piece of text
// is drawn on a canvas by the browser and placed as an image. Slightly larger
// files, no font embedding, any script.

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

const A4 = { w: 210, h: 297 };
const MARGIN = 15;
const CONTENT_W = A4.w - 2 * MARGIN;
const PX_PER_MM = 8;                 // canvas resolution for text strips

let loading = null;
function lib() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF;
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => reject(new Error('PDF 组件加载失败'));
      document.head.appendChild(s);
    });
  }
  return loading;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败：' + url));
    img.src = url;
  });
}

// WebP is not something jsPDF can embed; go through a canvas to JPEG.
function toJpeg(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0);
  return { data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
}

// A strip of text rendered by the browser, returned as an image sized in mm.
function textStrip(lines, { widthMm = CONTENT_W, size = 4.2, bold = false, gap = 1.6, color = '#111' } = {}) {
  const w = Math.round(widthMm * PX_PER_MM);
  const fontPx = size * PX_PER_MM;
  const lineH = fontPx * 1.35;
  const h = Math.round(lines.length * lineH + gap * PX_PER_MM);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.fillStyle = color;
  x.textBaseline = 'top';
  lines.forEach((line, i) => {
    const spec = typeof line === 'string' ? { text: line } : line;
    x.font = `${spec.bold ?? bold ? '600' : '400'} ${(spec.size ?? size) * PX_PER_MM}px -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif`;
    x.fillStyle = spec.color || color;
    if (spec.right) {
      const tw = x.measureText(spec.right).width;
      x.fillText(spec.right, w - tw, i * lineH);
    }
    x.fillText(spec.text, 0, i * lineH);
  });
  return { data: c.toDataURL('image/jpeg', 0.92), w, h, mmW: widthMm, mmH: h / PX_PER_MM };
}

// items: [{ label, marks, note, images: [url] }]
// kind: 'questions' leaves the page blank for working; 'answers' packs pages.
export async function build({ title, lines = [], items, kind = 'questions', fileName }) {
  const JsPDF = await lib();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });

  // ---- cover
  const cover = textStrip([
    { text: title, size: 9, bold: true },
    '',
    ...lines,
    '',
    { text: kind === 'questions' ? '姓名 ________________　　日期 ____________' : '' },
    '',
    { text: kind === 'questions'
        ? '每题一页，请在题目下方空白处作答；空间不够可另附纸。做完回到网站录入分数。'
        : '对照评分方案给自己打分，再回到网站录入分数。', size: 3.6, color: '#555' },
  ], { size: 4.6 });
  doc.addImage(cover.data, 'JPEG', MARGIN, 40, cover.mmW, cover.mmH);

  // ---- one item per page
  for (const item of items) {
    doc.addPage();
    let y = MARGIN;
    const head = textStrip([{
      text: `${item.label}${item.note ? '  ·  ' + item.note : ''}`,
      right: item.marks != null ? (kind === 'questions' ? `___ / ${item.marks}` : `${item.marks} 分`) : '',
      bold: true, size: 4.6,
    }], { gap: 2.5 });
    doc.addImage(head.data, 'JPEG', MARGIN, y, head.mmW, head.mmH);
    y += head.mmH;
    doc.setDrawColor(200);
    doc.line(MARGIN, y, A4.w - MARGIN, y);
    y += 3;

    for (const url of item.images) {
      let img;
      try { img = toJpeg(await loadImage(url)); } catch { continue; }
      let w = CONTENT_W, h = img.h / img.w * w;
      if (h > A4.h - 2 * MARGIN) { h = A4.h - 2 * MARGIN; w = img.w / img.h * h; }
      if (y + h > A4.h - MARGIN) { doc.addPage(); y = MARGIN; }
      doc.addImage(img.data, 'JPEG', MARGIN, y, w, h);
      y += h + 3;
    }
    // a question that fills its page gets a fresh one for the working
    if (kind === 'questions' && y > A4.h - 70) {
      doc.addPage();
      const more = textStrip([{ text: `${item.label}（续）作答区`, color: '#777', size: 3.8 }]);
      doc.addImage(more.data, 'JPEG', MARGIN, MARGIN, more.mmW, more.mmH);
    }
  }

  // page numbers are ASCII, so jsPDF's own font is fine
  const n = doc.getNumberOfPages();
  doc.setFontSize(9); doc.setTextColor(150);
  for (let i = 2; i <= n; i++) {
    doc.setPage(i);
    doc.text(`${i - 1} / ${n - 1}`, A4.w / 2, A4.h - 7, { align: 'center' });
  }
  doc.save(fileName);
}

// The two buttons every set gets. `set()` is called lazily so the caller can
// hand over questions that may not be loaded yet.
export function buttons(el, { set, onError = () => {} }) {
  el.innerHTML = `
    <button class="plain" data-pdf="questions">下载题目 PDF</button>
    <button class="plain" data-pdf="answers">下载答案 PDF</button>`;
  for (const b of el.querySelectorAll('[data-pdf]')) {
    b.onclick = async () => {
      const kind = b.dataset.pdf;
      b.disabled = true;
      const was = b.textContent;
      b.textContent = '生成中…';
      try {
        const spec = set(kind);
        if (!spec.items.length) throw new Error(kind === 'answers' ? '这套题没有评分方案' : '没有题目');
        await build({ ...spec, kind });
      } catch (err) {
        onError(err.message || '生成失败');
      }
      b.disabled = false;
      b.textContent = was;
    };
  }
}
