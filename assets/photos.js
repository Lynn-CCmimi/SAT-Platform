// Correction photos, shared by every exam board.
//
// A student photographs their corrected working. One photo per attempt turned
// out to be too few - working runs over two pages, and a blurry shot could only
// be fixed by redoing the whole question - so an attempt now carries a list.
//
// Rows written before that change still have the old single `photo_path`;
// pathsOf() hides the difference, and any edit writes the row back in the new
// shape.

import * as db from './db.js?v=d0f2b5ef';

const MAX = 6;

export function pathsOf(attempt) {
  if (attempt?.photo_paths?.length) return attempt.photo_paths;
  return attempt?.photo_path ? [attempt.photo_path] : [];
}

// ------------------------------------------------------------- before saving

// Photos chosen but not yet uploaded. Returns { blobs } - the same array it
// keeps mutating, so the caller can read it at save time.
export function uploader(el, { onError = () => {} } = {}) {
  const blobs = [];

  function draw() {
    el.innerHTML = `
      ${blobs.length ? `<div class="shots">${blobs.map((b, i) =>
        `<div class="shot"><img src="${URL.createObjectURL(b)}" alt="订正">
           <button class="plain" data-drop="${i}">删掉</button></div>`).join('')}</div>` : ''}
      ${blobs.length < MAX
        ? `<div class="drop" data-add>${blobs.length ? '再拍一张' : '点这里拍照或选图片'}</div>`
        : `<div class="hint">最多 ${MAX} 张</div>`}
      <input type="file" accept="image/*" capture="environment" multiple hidden>`;

    const file = el.querySelector('input[type=file]');
    el.querySelector('[data-add]')?.addEventListener('click', () => file.click());
    file.onchange = async e => {
      for (const f of [...e.target.files].slice(0, MAX - blobs.length)) {
        try {
          blobs.push(await db.shrink(f));
        } catch (err) {
          onError(err.message || '照片处理失败');
        }
      }
      file.value = '';
      draw();
    };
    for (const b of el.querySelectorAll('[data-drop]')) {
      b.onclick = () => { blobs.splice(Number(b.dataset.drop), 1); draw(); };
    }
  }

  draw();
  return { blobs };
}

export async function uploadAll(userId, questionId, blobs) {
  const out = [];
  for (const b of blobs) out.push(await db.uploadPhoto(userId, questionId, b));
  return out;
}

// -------------------------------------------------------------- after saving

// Photos already stored on an attempt. With `editable`, the owner can add more
// or delete one; `onChange(paths, err, action)` reports what happened, where
// action is 'add' or 'remove'.
export async function gallery(el, attempt, { editable = false, userId = null,
                                             onChange = () => {} } = {}) {
  let paths = pathsOf(attempt);
  let busy = false;

  async function draw() {
    const urls = await Promise.all(paths.map(p => db.photoUrl(p)));
    el.innerHTML = `
      ${paths.length ? `<div class="shots">${paths.map((p, i) => urls[i]
          ? `<div class="shot"><img loading="lazy" src="${urls[i]}" alt="订正">
               ${editable ? `<button class="plain" data-del="${i}">删掉</button>` : ''}</div>`
          : '<div class="hint">照片打不开</div>').join('')}</div>`
        : (editable ? '' : '<div class="hint">没有订正照片</div>')}
      ${editable && paths.length < MAX
        ? `<div class="drop" data-add>${paths.length ? '补拍一张' : '补一张订正照片'}</div>
           <input type="file" accept="image/*" capture="environment" multiple hidden>`
        : ''}`;

    const file = el.querySelector('input[type=file]');
    el.querySelector('[data-add]')?.addEventListener('click', () => file.click());
    if (file) {
      file.onchange = async e => {
        if (busy) return;
        busy = true;
        const add = [...e.target.files].slice(0, MAX - paths.length);
        file.value = '';
        try {
          const blobs = [];
          for (const f of add) blobs.push(await db.shrink(f));
          const added = await uploadAll(userId, attempt.question_id, blobs);
          paths = [...paths, ...added];
          await persist('add');
        } catch (err) {
          onChange(null, err.message || '上传失败');
        }
        busy = false;
        draw();
      };
    }
    for (const b of el.querySelectorAll('[data-del]')) {
      b.onclick = async () => {
        if (busy) return;
        busy = true;
        b.disabled = true;
        const gone = paths[Number(b.dataset.del)];
        paths = paths.filter(p => p !== gone);
        try {
          await persist('remove');
          await db.deletePhoto(gone);   // row first, then the file
        } catch (err) {
          onChange(null, err.message || '删除失败');
        }
        busy = false;
        draw();
      };
    }
  }

  async function persist(action) {
    // write back in the new shape, so an old single-photo row is migrated the
    // first time it is touched
    await db.updateAttempt(attempt.id, { photo_paths: paths, photo_path: null });
    attempt.photo_paths = paths;
    attempt.photo_path = null;
    onChange(paths, null, action);
  }

  await draw();
}
