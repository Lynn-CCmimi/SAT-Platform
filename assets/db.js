// Backend access. Everything that is per-student and changes over time lives in
// Supabase; the question and textbook images are static files served alongside
// this page, so they are never fetched through here.
//
// Students sign in with a username. Supabase Auth is email-based, so the
// username is expanded to a fixed internal domain - students never see it.

const CONFIG = window.MATH_PLATFORM_CONFIG || {};
const EMAIL_DOMAIN = 'student.mathplatform.local';
const SUBJECT = 'sat';

export const configured = Boolean(CONFIG.url && CONFIG.anonKey);

let client = null;

export async function supabase() {
  if (!configured) throw new Error('Supabase 尚未配置');
  if (client) return client;
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
  );
  client = createClient(CONFIG.url, CONFIG.anonKey);
  return client;
}

const emailFor = username => `${String(username).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export async function signIn(username, password) {
  const db = await supabase();
  const { data, error } = await db.auth.signInWithPassword({
    email: emailFor(username),
    password,
  });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const db = await supabase();
  await db.auth.signOut();
}

export async function currentUser() {
  if (!configured) return null;
  const db = await supabase();
  const { data } = await db.auth.getUser();
  return data?.user || null;
}

export async function profile(userId) {
  const db = await supabase();
  const { data, error } = await db
    .from('profiles')
    .select('id, username, display_name, role, units')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ---------- attempts ----------

export async function myAttempts() {
  const db = await supabase();
  const { data, error } = await db
    .from('attempts')
    .select('*')
    .eq('subject', SUBJECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveAttempt(record) {
  const db = await supabase();
  const { data, error } = await db
    .from('attempts')
    .insert({ ...record, subject: SUBJECT })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Reasons and the correction photo arrive after the attempt row exists, so the
// row is patched rather than re-inserted.
export async function updateAttempt(id, patch) {
  const db = await supabase();
  const { error } = await db.from('attempts').update(patch).eq('id', id);
  if (error) throw error;
}

// ---------- photo of the corrected working ----------

// Phone photos run to several megabytes and the free storage tier is 1GB, so
// they are resized in the browser before upload; 1200px keeps handwriting
// legible at roughly a tenth of the size.
export function shrink(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取照片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('照片格式无法识别'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error('压缩失败'))),
          'image/jpeg',
          quality
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadPhoto(userId, questionId, blob) {
  const db = await supabase();
  const path = `${userId}/${questionId}-${Date.now()}.jpg`;
  const { error } = await db.storage
    .from('corrections')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export async function photoUrl(path) {
  if (!path) return null;
  const db = await supabase();
  const { data, error } = await db.storage
    .from('corrections')
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

// ---------- teacher ----------

export async function allStudents() {
  const db = await supabase();
  const { data, error } = await db
    .from('profiles')
    .select('id, username, display_name, role, units')
    .eq('role', 'student')
    .order('display_name');
  if (error) throw error;
  return data || [];
}

export async function attemptsForClass() {
  const db = await supabase();
  const { data, error } = await db
    .from('attempts')
    .select('*')
    .eq('subject', SUBJECT)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}
