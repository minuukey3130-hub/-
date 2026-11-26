'use strict';

// ===== 保存（IndexedDB。画像を入れても容量に余裕がある） =====
const DB_NAME = 'exam-prep-app';
const LEGACY_KEY = 'exam-prep-app-v1';
const SETTINGS_KEY = 'exam-prep-settings';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let dbPromise = null;
function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getSettings() {
  try { return { model: 'claude-opus-5-5', apiKey: '', firebaseConfig: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch (e) { return { model: 'claude-opus-5-5', apiKey: '', firebaseConfig: '' }; }
}
function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { alert('設定を保存できませんでした'); }
  return next;
}

// ===== AIの利用料金の記録（この端末のみ） =====
const USAGE_KEY = 'exam-prep-ai-usage';
function getUsageLog() {
  try { return { total: 0, count: 0, months: {}, history: [], ...JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') }; }
  catch (e) { return { total: 0, count: 0, months: {}, history: [] }; }
}
function recordUsage(u, subjectName) {
  const log = getUsageLog();
  const cost = u.cost || 0;
  const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  log.total += cost;
  log.count += 1;
  log.months[month] = (log.months[month] || 0) + cost;
  log.history.unshift({ at: Date.now(), subject: subjectName, model: u.model, input: u.input, output: u.output, cost: u.cost });
  log.history = log.history.slice(0, 50);
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(log)); } catch (e) { /* 記録できなくても生成は続ける */ }
  return log;
}
function usd(n) {
  if (n === null || n === undefined) return '不明';
  return '$' + (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2));
}

function sampleData() {
  const q = (o) => ({ id: uid(), stats: { correct: 0, wrong: 0 }, explanation: '', ...o });
  return {
    subjects: [{
      id: uid(),
      sample: true,
      name: 'サンプル：統計学入門',
      examDate: '',
      questions: [
        q({ type: 'choice', question: 'データの中央の値を表す代表値で、外れ値の影響を受けにくいものはどれか。',
          choices: ['平均値', '中央値', '最頻値', '分散'], answer: 1,
          explanation: '中央値（メディアン）はデータを順に並べたときの真ん中の値で、極端な値の影響を受けにくい。' }),
        q({ type: 'text', question: '標準偏差 $\\sigma$ を2乗した $\\sigma^2$ を何というか。', answer: '分散|variance',
          explanation: '分散の正の平方根が標準偏差。' }),
        q({ type: 'choice', question: '母平均 $\\mu$、母分散 $\\sigma^2$ の母集団から大きさ $n$ の標本をとるとき、標本平均 $\\bar{X}$ の分散はどれか。',
          choices: ['$\\sigma^2$', '$\\dfrac{\\sigma^2}{n}$', '$\\dfrac{\\sigma}{\\sqrt{n}}$', '$n\\sigma^2$'], answer: 1,
          explanation: '$$V(\\bar{X}) = \\frac{\\sigma^2}{n}$$ 標準誤差はその平方根 $\\sigma/\\sqrt{n}$。' }),
        q({ type: 'choice', question: '帰無仮説が正しいのに棄却してしまう誤りを何というか。',
          choices: ['第一種の過誤', '第二種の過誤', '標本誤差', '系統誤差'], answer: 0,
          explanation: '第一種の過誤（α過誤）。その確率が有意水準 $\\alpha$。' }),
      ],
    }],
  };
}

function normalizeState(s) {
  s = s && typeof s === 'object' ? s : {};
  s.subjects = Array.isArray(s.subjects) ? s.subjects : [];
  s.studyLog = s.studyLog && typeof s.studyLog === 'object' ? s.studyLog : {};
  s.deleted = s.deleted && typeof s.deleted === 'object' ? s.deleted : {};
  s.subjects.forEach((sub) => {
    sub.id = sub.id || uid();
    sub.examDate = sub.examDate || '';
    sub.updatedAt = sub.updatedAt || 0;
    sub.questions = (sub.questions || []).map((q) => ({ ...q, id: q.id || uid(), stats: q.stats || { correct: 0, wrong: 0 } }));
  });
  return s;
}

let state = { subjects: [], studyLog: {}, deleted: {} };

async function loadState() {
  let data = null;
  try { data = await idbGet('state'); } catch (e) { console.warn('IndexedDB を使えません', e); }
  if (!data) {
    try { const raw = localStorage.getItem(LEGACY_KEY); if (raw) data = JSON.parse(raw); } catch (e) { /* 旧データなし */ }
  }
  state = normalizeState(data || sampleData());
  rememberSnapshots();
  persist();
}

// 科目ごとの内容を覚えておき、変わった科目だけ updatedAt を更新して同期する
const snapshots = new Map();
let studyLogSnap = '';
const subjectSig = (s) => JSON.stringify({ ...s, updatedAt: 0 });
function rememberSnapshots(ids) {
  state.subjects.forEach((s) => { if (!ids || ids.includes(s.id)) snapshots.set(s.id, subjectSig(s)); });
  studyLogSnap = JSON.stringify(state.studyLog);
}

let persistWarned = false;
function persist() {
  idbSet('state', state).catch((e) => {
    if (!persistWarned) { persistWarned = true; alert('保存に失敗しました: ' + e.message); }
  });
}

function save() {
  const now = Date.now();
  const changed = [];
  for (const s of state.subjects) {
    const sig = subjectSig(s);
    if (snapshots.get(s.id) !== sig) { s.updatedAt = now; snapshots.set(s.id, sig); changed.push(s.id); }
  }
  for (const id of [...snapshots.keys()]) {
    if (!state.subjects.some((s) => s.id === id)) { state.deleted[id] = now; snapshots.delete(id); changed.push(id); }
  }
  const logSig = JSON.stringify(state.studyLog);
  const metaChanged = logSig !== studyLogSnap || changed.some((id) => state.deleted[id] === now);
  studyLogSnap = logSig;
  persist();
  Sync.onLocalChange(changed, metaChanged);
}

// 同期: リモートの内容を取り込み、ローカルの方が新しい科目IDを返す
function applyRemote(remote) {
  let touched = false;
  for (const [id, t] of Object.entries(remote.deleted || {})) {
    if (!state.deleted[id] || state.deleted[id] < t) { state.deleted[id] = t; touched = true; }
  }
  for (const [day, bySubject] of Object.entries(remote.studyLog || {})) {
    const local = state.studyLog[day] || (state.studyLog[day] = {});
    for (const [sid, n] of Object.entries(bySubject)) {
      if ((local[sid] || 0) < n) { local[sid] = n; touched = true; }
    }
  }
  const replaced = [];
  for (const r of remote.subjects) {
    if ((state.deleted[r.id] || 0) >= (r.updatedAt || 0)) continue;
    const i = state.subjects.findIndex((s) => s.id === r.id);
    if (i < 0) { state.subjects.push(normalizeState({ subjects: [r] }).subjects[0]); replaced.push(r.id); }
    else if ((r.updatedAt || 0) > (state.subjects[i].updatedAt || 0)) { state.subjects[i] = normalizeState({ subjects: [r] }).subjects[0]; replaced.push(r.id); }
  }
  const before = state.subjects.length;
  state.subjects = state.subjects.filter((s) => !state.deleted[s.id] || state.deleted[s.id] < (s.updatedAt || 0));
  for (const id of [...snapshots.keys()]) if (!state.subjects.some((s) => s.id === id)) snapshots.delete(id);

  rememberSnapshots(replaced);
  if (replaced.length || touched || before !== state.subjects.length) {
    persist();
    const view = location.hash.slice(1).split('/')[0];
    if (!['quiz', 'edit', 'generate', 'settings'].includes(view)) route();
  }
  const remoteById = new Map(remote.subjects.map((r) => [r.id, r]));
  return state.subjects
    .filter((s) => !(s.sample && !s.updatedAt)) // 未編集のサンプル科目はクラウドに上げない
    .filter((s) => !remoteById.has(s.id) || (s.updatedAt || 0) > (remoteById.get(s.id).updatedAt || 0))
    .map((s) => s.id);
}

const findSubject = (id) => state.subjects.find((s) => s.id === id);

// ===== ユーティリティ =====
const app = document.getElementById('app');

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderMath(el) {
  if (!el || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  } catch (e) { /* 数式の失敗は無視して原文を表示 */ }
}
window.renderMath = renderMath;

function view(html) {
  app.innerHTML = html;
  renderMath(app);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 記述問題の判定：空白・全角半角・大文字小文字の差を無視。「|」区切りで別解OK
function normalize(s) {
  return String(s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
function isTextCorrect(input, answer) {
  const n = normalize(input);
  return n !== '' && String(answer).split('|').some((a) => normalize(a) === n);
}

const answeredCount = (q) => q.stats.correct + q.stats.wrong;
function accuracy(q) {
  const t = answeredCount(q);
  return t === 0 ? null : q.stats.correct / t;
}
const isWeak = (q) => q.stats.lastResult === 'wrong';
const isMastered = (q) => q.stats.lastResult === 'correct';
const correctAnswerText = (q) => (q.type === 'choice' ? q.choices[q.answer] : String(q.answer).split('|')[0]);

// 画像を縮小して data URL にする（保存容量・同期のため）
function resizeImage(file, maxSize = 1200) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('画像ファイルを選んでください'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}
const imgTag = (src, alt) => (src ? `<img class="q-image" src="${esc(src)}" alt="${esc(alt)}">` : '');

// ===== 学習記録・試験日・プラン =====
const dateKey = (d = new Date()) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD（ローカル時刻）
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}
function logStudy(subjectId) {
  const day = dateKey();
  const log = state.studyLog[day] || (state.studyLog[day] = {});
  log[subjectId] = (log[subjectId] || 0) + 1;
}
const dayTotal = (day) => Object.values(state.studyLog[day] || {}).reduce((a, b) => a + b, 0);
function streak() {
  const d = new Date();
  if (!dayTotal(dateKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (dayTotal(dateKey(d)) > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function planFor(s) {
  const daysLeft = daysUntil(s.examDate);
  const remaining = s.questions.filter((q) => !isMastered(q)).length;
  const doneToday = (state.studyLog[dateKey()] || {})[s.id] || 0;
  if (daysLeft === null || daysLeft < 0) return { daysLeft, remaining, doneToday, target: null, left: 0 };
  // 試験前日までに全問を一度正解できるペース（試験当日なら今日中）。
  // 今日解いた分を足し戻して計算し、解くたびに目標が変わらないようにする
  const studyDays = Math.max(1, daysLeft);
  const target = remaining ? Math.ceil((remaining + doneToday) / studyDays) : 0;
  return { daysLeft, remaining, doneToday, target, left: Math.min(remaining, Math.max(0, target - doneToday)) };
}
// 今日解く問題：間違えた問題 → 未回答 → それ以外の未習得、の順
function pickToday(s, n) {
  const notMastered = s.questions.filter((q) => !isMastered(q));
  const weak = shuffle(notMastered.filter(isWeak));
  const fresh = shuffle(notMastered.filter((q) => answeredCount(q) === 0));
  const rest = shuffle(notMastered.filter((q) => !isWeak(q) && answeredCount(q) > 0));
  return [...weak, ...fresh, ...rest].slice(0, Math.max(1, n));
}
const countdownBadge = (s) => {
  const d = daysUntil(s.examDate);
  if (d === null) return '';
  if (d < 0) return '<span class="badge muted-badge">試験終了</span>';
  if (d === 0) return '<span class="badge ng">今日が試験！</span>';
  return `<span class="badge ${d <= 3 ? 'ng' : d <= 7 ? 'warn' : ''}">試験まで ${d}日</span>`;
};

// ===== 画面: ホーム =====
function renderHome() {
  const upcoming = state.subjects
    .filter((s) => s.examDate && daysUntil(s.examDate) >= 0)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  const others = state.subjects.filter((s) => !upcoming.includes(s));

  const planRows = upcoming.map((s) => {
    const p = planFor(s);
    return `
      <div class="plan-item row spread">
        <div style="flex:1;min-width:0">
          <strong>${esc(s.name)}</strong> ${countdownBadge(s)}
          <div class="muted">${!p.remaining
            ? '全問習得済み。間違えた問題の見直しで仕上げましょう'
            : p.left ? `未習得 ${p.remaining}問 ・ 今日の目標 <strong>${p.target}問</strong>（あと ${p.left}問）`
            : `今日の目標 ${p.target}問 達成 ✓（未習得 ${p.remaining}問）`}</div>
        </div>
        ${p.left ? `<button data-today="${s.id}">今日の分を解く</button>`
          : p.remaining ? `<button class="ghost" data-today="${s.id}">もっと解く</button>` : '<span class="badge">✓ 習得</span>'}
      </div>`;
  }).join('');

  const items = [...upcoming, ...others].map((s) => {
    const total = s.questions.length;
    const mastered = s.questions.filter(isMastered).length;
    const weak = s.questions.filter(isWeak).length;
    const pct = total ? Math.round((mastered / total) * 100) : 0;
    return `
      <div class="card subject-item" data-id="${s.id}">
        <div class="row spread">
          <h2 style="margin:0">${esc(s.name)}</h2>
          <div class="row">${countdownBadge(s)}${weak ? `<span class="badge ng">要復習 ${weak}</span>` : ''}</div>
        </div>
        <div class="muted">${total}問 ・ 習得 ${mastered}/${total}</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  view(`
    <div class="card">
      <h2>今日の学習</h2>
      <div class="stats-row">
        <div><div class="stat">${dayTotal(dateKey())}</div><div class="muted">今日解いた問題</div></div>
        <div><div class="stat">${streak()}<span class="unit">日</span></div><div class="muted">連続学習</div></div>
      </div>
      ${planRows || '<div class="muted">科目のページで試験日を設定すると、残り日数と1日の目標問題数がここに表示されます。</div>'}
    </div>
    <h1>科目一覧</h1>
    ${items || '<div class="empty">まだ科目がありません。下から追加してください。</div>'}
    <div class="card">
      <form id="addSubject" class="row">
        <input type="text" name="name" placeholder="新しい科目名（例：民法総則）" required style="flex:1">
        <button type="submit">追加</button>
      </form>
    </div>`);

  app.querySelectorAll('.subject-item').forEach((el) =>
    el.addEventListener('click', () => go('subject', el.dataset.id)));
  app.querySelectorAll('[data-today]').forEach((b) => b.onclick = () => {
    const s = findSubject(b.dataset.today);
    const p = planFor(s);
    startQuiz(s.id, pickToday(s, p.left || p.target).map((q) => q.id), { shuffleChoices: true });
  });
  app.querySelector('#addSubject').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    state.subjects.push({ id: uid(), name, examDate: '', questions: [], updatedAt: 0 });
    save();
    renderHome();
  });
}

// ===== 画面: 科目詳細 =====
function renderSubject(id) {
  const s = findSubject(id);
  if (!s) return go('home');
  const weakCount = s.questions.filter(isWeak).length;
  const unansweredCount = s.questions.filter((q) => answeredCount(q) === 0).length;
  const p = planFor(s);

  const list = s.questions.map((q, i) => {
    const acc = accuracy(q);
    return `
      <div class="q-list-item">
        <div class="row spread" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <span class="muted">Q${i + 1} ・ ${q.type === 'choice' ? '選択式' : '記述式'}${q.image ? ' ・ 🖼' : ''}</span>
            ${isWeak(q) ? '<span class="badge ng">要復習</span>' : isMastered(q) ? '<span class="badge">習得</span>' : ''}
            <div class="clamp">${esc(q.question)}</div>
            <div class="muted">${acc === null ? '未回答' : `正答率 ${Math.round(acc * 100)}%（${q.stats.correct}/${answeredCount(q)}）`}</div>
          </div>
          <div class="row">
            <button class="ghost" data-edit="${q.id}">編集</button>
            <button class="danger" data-del="${q.id}">削除</button>
          </div>
        </div>
      </div>`;
  }).join('');

  view(`
    <div class="row spread">
      <h1>${esc(s.name)}</h1>
      <div class="row">
        <button class="ghost" id="renameBtn">名前変更</button>
        <button class="danger" id="deleteSubjectBtn">科目を削除</button>
      </div>
    </div>

    <div class="card">
      <h2>試験日と学習プラン</h2>
      <div class="row" style="margin-bottom:8px">
        <input type="date" id="examDate" value="${esc(s.examDate)}" style="width:auto">
        ${s.examDate ? '<button class="ghost" id="clearDate">クリア</button>' : ''}
        ${countdownBadge(s)}
      </div>
      ${p.target !== null && p.remaining
        ? `<div>未習得 ${p.remaining}問 → <strong>今日の目標 ${p.target}問</strong>。このペースで試験前日までに全問を一度正解できます（今日 ${p.doneToday}問 解答${p.left ? `、あと ${p.left}問` : '、目標達成 ✓'}）</div>
           <div class="row" style="margin-top:8px"><button id="startToday" ${p.left ? '' : 'class="ghost"'}>${p.left ? `今日の分（${p.left}問）を解く` : 'もっと解く'}</button></div>`
        : p.target !== null ? '<div>全問習得済みです 🎉 間違えた問題の復習や全問演習で仕上げましょう。</div>'
        : '<div class="muted">試験日を設定すると、1日に何問解けばよいかを計算します。</div>'}
    </div>

    <div class="card">
      <h2>演習を始める</h2>
      <div class="row" style="margin-bottom:12px">
        <label class="row"><input type="checkbox" id="optShuffle" checked> 出題順をシャッフル</label>
        <label class="row"><input type="checkbox" id="optShuffleChoices" checked> 選択肢をシャッフル</label>
      </div>
      <div class="row" style="margin-bottom:12px">
        <span class="muted">出題数</span>
        <input type="number" id="optCount" min="1" value="${s.questions.length || 1}" style="width:90px">
      </div>
      <div class="row">
        <button id="startAll" ${s.questions.length ? '' : 'disabled'}>全問から出題</button>
        <button id="startWeak" class="ghost" ${weakCount ? '' : 'disabled'}>間違えた問題だけ（${weakCount}）</button>
        <button id="startUnanswered" class="ghost" ${unansweredCount ? '' : 'disabled'}>未回答のみ（${unansweredCount}）</button>
      </div>
    </div>

    <div class="card">
      <div class="row spread" style="margin-bottom:8px">
        <h2 style="margin:0">問題一覧（${s.questions.length}）</h2>
        <div class="row">
          <button class="ghost" id="resetStats">成績リセット</button>
          <button class="ghost" id="genQ">✨ AIで作成</button>
          <button id="addQ">＋ 問題を追加</button>
        </div>
      </div>
      ${list || '<div class="empty">問題がありません。「問題を追加」か「AIで作成」から作りましょう。</div>'}
    </div>`);

  const startWith = (pool) => {
    const opts = { shuffleChoices: app.querySelector('#optShuffleChoices').checked };
    const count = Math.max(1, parseInt(app.querySelector('#optCount').value, 10) || pool.length);
    const qs = (app.querySelector('#optShuffle').checked ? shuffle(pool) : pool.slice()).slice(0, count);
    startQuiz(s.id, qs.map((q) => q.id), opts);
  };

  app.querySelector('#examDate').onchange = (e) => { s.examDate = e.target.value; save(); renderSubject(id); };
  const clr = app.querySelector('#clearDate');
  if (clr) clr.onclick = () => { s.examDate = ''; save(); renderSubject(id); };
  const today = app.querySelector('#startToday');
  if (today) today.onclick = () => startQuiz(s.id, pickToday(s, p.left || p.target).map((q) => q.id), { shuffleChoices: true });

  app.querySelector('#startAll').onclick = () => startWith(s.questions);
  app.querySelector('#startWeak').onclick = () => startWith(s.questions.filter(isWeak));
  app.querySelector('#startUnanswered').onclick = () => startWith(s.questions.filter((q) => answeredCount(q) === 0));
  app.querySelector('#addQ').onclick = () => go('edit', s.id);
  app.querySelector('#genQ').onclick = () => go('generate', s.id);
  app.querySelector('#renameBtn').onclick = () => {
    const name = prompt('新しい科目名', s.name);
    if (name && name.trim()) { s.name = name.trim(); save(); renderSubject(id); }
  };
  app.querySelector('#deleteSubjectBtn').onclick = () => {
    if (confirm(`「${s.name}」と全ての問題を削除します。よろしいですか？`)) {
      state.subjects = state.subjects.filter((x) => x.id !== s.id);
      save(); go('home');
    }
  };
  app.querySelector('#resetStats').onclick = () => {
    if (confirm('この科目の成績をリセットしますか？')) {
      s.questions.forEach((q) => { q.stats = { correct: 0, wrong: 0 }; });
      save(); renderSubject(id);
    }
  };
  app.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => go('edit', s.id, b.dataset.edit));
  app.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    if (confirm('この問題を削除しますか？')) {
      s.questions = s.questions.filter((q) => q.id !== b.dataset.del);
      save(); renderSubject(id);
    }
  });
}

// ===== 画面: 問題作成・編集 =====
function renderEdit(subjectId, questionId) {
  const s = findSubject(subjectId);
  if (!s) return go('home');
  const existing = questionId ? s.questions.find((q) => q.id === questionId) : null;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { type: 'choice', question: '', choices: ['', '', '', ''], answer: 0, explanation: '', image: '', explanationImage: '' };
  if (!draft.choices) draft.choices = ['', '', '', ''];

  const imageField = (key, label) => `
    <div class="field">
      <span class="muted">${label}（ファイル選択、またはテキスト欄に画像を貼り付け）</span>
      <div class="row">
        <label class="ghost file-label">画像を選ぶ<input type="file" accept="image/*" data-img="${key}" hidden></label>
        ${draft[key] ? `<button type="button" class="danger" data-img-remove="${key}">画像を削除</button>` : ''}
      </div>
      ${draft[key] ? `<img class="q-image" src="${esc(draft[key])}" alt="">` : ''}
    </div>`;

  function draw() {
    const choicesHtml = draft.choices.map((c, i) => `
      <div class="choice-edit">
        <input type="radio" name="correct" value="${i}" ${draft.answer === i ? 'checked' : ''} title="正解にする">
        <input type="text" data-choice="${i}" value="${esc(c)}" placeholder="選択肢 ${i + 1}">
        <button type="button" class="danger" data-remove="${i}" ${draft.choices.length <= 2 ? 'disabled' : ''}>×</button>
      </div>`).join('');

    view(`
      <h1>${existing ? '問題を編集' : '問題を追加'} <span class="muted">— ${esc(s.name)}</span></h1>
      <form class="card" id="qForm">
        <label class="field"><span>形式</span>
          <select name="type">
            <option value="choice" ${draft.type === 'choice' ? 'selected' : ''}>選択式</option>
            <option value="text" ${draft.type === 'text' ? 'selected' : ''}>記述式（一問一答）</option>
          </select>
        </label>
        <label class="field"><span>問題文　<span class="hint">数式は $x^2$（文中）や $$\\int_0^1 f(x)\\,dx$$（独立）のように書けます</span></span>
          <textarea name="question" data-paste="image" required>${esc(draft.question)}</textarea>
        </label>
        <div class="field"><span class="muted">プレビュー</span><div id="preview" class="preview"></div></div>
        ${imageField('image', '問題の画像（図・グラフなど）')}
        ${draft.type === 'choice' ? `
          <div class="field"><span class="muted">選択肢（左の丸で正解を選択）</span>
            ${choicesHtml}
            <button type="button" class="ghost" id="addChoice">＋ 選択肢を追加</button>
          </div>` : `
          <label class="field"><span>正解（別解は「|」で区切る　例：分散|variance）</span>
            <input type="text" name="answerText" value="${esc(typeof draft.answer === 'string' ? draft.answer : '')}" required>
          </label>`}
        <label class="field"><span>解説（任意）</span>
          <textarea name="explanation" data-paste="explanationImage">${esc(draft.explanation)}</textarea>
        </label>
        ${imageField('explanationImage', '解説の画像')}
        <div class="row">
          <button type="submit">保存</button>
          ${existing ? '' : '<button type="button" class="ghost" id="saveNext">保存して続けて追加</button>'}
          <button type="button" class="ghost" id="cancel">キャンセル</button>
        </div>
      </form>`);

    const form = app.querySelector('#qForm');
    const preview = app.querySelector('#preview');
    const updatePreview = () => {
      preview.innerHTML = esc(form.question.value) || '<span class="muted">（問題文を入力するとここに表示されます）</span>';
      renderMath(preview);
    };
    updatePreview();
    form.question.addEventListener('input', updatePreview);

    const sync = () => {
      draft.question = form.question.value;
      draft.explanation = form.explanation.value;
      if (draft.type === 'choice') {
        form.querySelectorAll('[data-choice]').forEach((el) => { draft.choices[+el.dataset.choice] = el.value; });
        const r = form.querySelector('input[name=correct]:checked');
        draft.answer = r ? +r.value : 0;
      } else {
        draft.answer = form.answerText.value;
      }
    };

    const setImage = async (key, file) => {
      try { sync(); draft[key] = await resizeImage(file); draw(); }
      catch (e) { alert(e.message); }
    };
    form.querySelectorAll('[data-img]').forEach((inp) => inp.onchange = () => inp.files[0] && setImage(inp.dataset.img, inp.files[0]));
    form.querySelectorAll('[data-img-remove]').forEach((b) => b.onclick = () => { sync(); draft[b.dataset.imgRemove] = ''; draw(); });
    form.querySelectorAll('textarea').forEach((ta) => ta.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      setImage(ta.name === 'question' ? 'image' : 'explanationImage', item.getAsFile());
    }));

    form.type.onchange = () => {
      sync();
      draft.type = form.type.value;
      draft.answer = draft.type === 'choice' ? 0 : '';
      draw();
    };
    const addBtn = form.querySelector('#addChoice');
    if (addBtn) addBtn.onclick = () => { sync(); draft.choices.push(''); draw(); };
    form.querySelectorAll('[data-remove]').forEach((b) => b.onclick = () => {
      sync();
      const i = +b.dataset.remove;
      draft.choices.splice(i, 1);
      if (draft.answer === i) draft.answer = 0;
      else if (draft.answer > i) draft.answer--;
      draw();
    });

    const commit = () => {
      sync();
      if (!draft.question.trim()) { alert('問題文を入力してください'); return false; }
      const q = {
        id: existing ? existing.id : uid(),
        type: draft.type,
        question: draft.question.trim(),
        explanation: draft.explanation.trim(),
        image: draft.image || '',
        explanationImage: draft.explanationImage || '',
        stats: existing ? existing.stats : { correct: 0, wrong: 0 },
      };
      if (draft.type === 'choice') {
        const filled = draft.choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c);
        if (filled.length < 2) { alert('選択肢を2つ以上入力してください'); return false; }
        const newIndex = filled.findIndex((x) => x.i === draft.answer);
        if (newIndex < 0) { alert('正解の選択肢が空欄です'); return false; }
        q.choices = filled.map((x) => x.c);
        q.answer = newIndex;
      } else {
        if (!String(draft.answer).trim()) { alert('正解を入力してください'); return false; }
        q.answer = String(draft.answer).trim();
      }
      if (existing) {
        Object.keys(existing).forEach((k) => delete existing[k]);
        Object.assign(existing, q);
      } else s.questions.push(q);
      save();
      return true;
    };

    form.onsubmit = (e) => { e.preventDefault(); if (commit()) go('subject', s.id); };
    const next = form.querySelector('#saveNext');
    if (next) next.onclick = () => { if (commit()) renderEdit(s.id); };
    form.querySelector('#cancel').onclick = () => go('subject', s.id);
  }
  draw();
}

// ===== 画面: AIで問題を作成 =====
function renderGenerate(subjectId) {
  const s = findSubject(subjectId);
  if (!s) return go('home');
  const settings = getSettings();

  if (!settings.apiKey) {
    view(`
      <h1>AIで問題を作成 <span class="muted">— ${esc(s.name)}</span></h1>
      <div class="card">
        <p>授業ノートや講義資料（PDF・画像・テキスト）から、Claude が問題を自動で作ります。</p>
        <p>使うには Claude API のキーが必要です。<a href="https://platform.claude.com/" target="_blank" rel="noopener">Claude Console</a> でキーを作成し、設定画面で入力してください。</p>
        <div class="row"><button id="toSettings">設定を開く</button><button class="ghost" id="back">戻る</button></div>
      </div>`);
    app.querySelector('#toSettings').onclick = () => go('settings');
    app.querySelector('#back').onclick = () => go('subject', s.id);
    return;
  }

  let files = [];
  view(`
    <h1>AIで問題を作成 <span class="muted">— ${esc(s.name)}</span></h1>
    <form class="card" id="genForm">
      <label class="field"><span>授業ノート・要点（貼り付け）</span>
        <textarea name="text" style="min-height:160px" placeholder="講義ノートや教科書の要点を貼り付けてください"></textarea>
      </label>
      <div class="field">
        <span class="muted">資料ファイル（PDF・画像・テキスト、複数可）</span>
        <div class="row">
          <label class="ghost file-label">ファイルを選ぶ<input type="file" id="genFiles" multiple accept=".pdf,application/pdf,image/png,image/jpeg,image/gif,image/webp,.txt,.md,text/plain,text/markdown" hidden></label>
          <span id="fileList" class="muted">未選択</span>
        </div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <label class="row"><span class="muted">問題数</span><input type="number" name="count" min="1" max="50" value="10" style="width:80px"></label>
        <label class="row"><span class="muted">形式</span>
          <select name="kind" style="width:auto">
            <option value="choice">選択式</option><option value="text">記述式</option><option value="mix" selected>混合</option>
          </select></label>
        <label class="row"><span class="muted">難易度</span>
          <select name="difficulty" style="width:auto">
            <option value="basic">基礎</option><option value="standard" selected>標準</option><option value="hard">応用</option>
          </select></label>
      </div>
      <div class="row">
        <button type="submit" id="genBtn">✨ 問題を生成</button>
        <button type="button" class="ghost" id="back">戻る</button>
        <span id="genStatus" class="muted"></span>
      </div>
      <p class="muted small">資料は Claude API（Anthropic）に送信されます。モデル: ${esc(settings.model)}</p>
      <p class="muted small" id="costLine"></p>
    </form>
    <div id="genResult"></div>`);

  const form = app.querySelector('#genForm');
  const status = app.querySelector('#genStatus');
  const renderCostLine = () => {
    const log = getUsageLog();
    const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
    const el = app.querySelector('#costLine');
    if (el) el.textContent = log.count ? `AI利用料金（この端末）: 今月 約${usd(log.months[month] || 0)} ・ 累計 約${usd(log.total)}（${log.count}回）` : '';
  };
  renderCostLine();
  app.querySelector('#back').onclick = () => go('subject', s.id);
  app.querySelector('#genFiles').onchange = (e) => {
    files = [...e.target.files];
    const mb = files.reduce((a, f) => a + f.size, 0) / 1024 / 1024;
    app.querySelector('#fileList').textContent = files.length ? `${files.map((f) => f.name).join('、')}（${mb.toFixed(1)}MB）` : '未選択';
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const totalMB = files.reduce((a, f) => a + f.size, 0) / 1024 / 1024;
    if (totalMB > 24) { alert('ファイルの合計が大きすぎます（24MB以下にしてください）'); return; }
    const btn = app.querySelector('#genBtn');
    btn.disabled = true;
    status.textContent = '生成中…（資料の量によっては1〜2分かかります）';
    try {
      let usage = null;
      const { questions: generated } = await AI.generate({
        apiKey: settings.apiKey,
        model: settings.model,
        subjectName: s.name,
        text: form.text.value,
        files,
        count: Math.min(50, Math.max(1, parseInt(form.count.value, 10) || 10)),
        kind: form.kind.value,
        difficulty: form.difficulty.value,
        onProgress: (n) => { status.textContent = `生成中…（${n.toLocaleString()}文字 受信）`; },
        onUsage: (u) => { usage = u; recordUsage(u, s.name); },
      });
      status.textContent = '';
      showGenerated(s, generated, usage);
    } catch (err) {
      status.textContent = '';
      alert(err.message || String(err));
      renderCostLine();
    } finally {
      btn.disabled = false;
    }
  };
}

function showGenerated(s, generated, usage) {
  const box = app.querySelector('#genResult');
  const log = getUsageLog();
  const costHtml = usage ? `
      <div class="cost-box">
        今回の料金 <strong>約${usd(usage.cost)}</strong>
        <span class="muted small">（入力 ${usage.input.toLocaleString()} ・ 出力 ${usage.output.toLocaleString()} トークン、${esc(usage.model)}）</span>
        <div class="muted small">累計 約${usd(log.total)}（${log.count}回）</div>
      </div>` : '';
  const costEl = app.querySelector('#costLine');
  if (costEl) costEl.textContent = '';
  if (!generated.length) { box.innerHTML = '<div class="card empty">問題を作成できませんでした。資料を増やして再度お試しください。</div>'; return; }
  box.innerHTML = `
    <div class="card">
      <div class="row spread" style="margin-bottom:8px">
        <h2 style="margin:0">生成された問題（${generated.length}）</h2>
        <label class="row"><input type="checkbox" id="checkAll" checked> すべて選択</label>
      </div>
      ${costHtml}
      <p class="muted small">AIの問題は誤りを含むことがあります。追加後に「編集」から直せます。</p>
      ${generated.map((q, i) => `
        <label class="q-list-item gen-item">
          <input type="checkbox" data-gen="${i}" checked>
          <div style="flex:1;min-width:0">
            <span class="muted">${q.type === 'choice' ? '選択式' : '記述式'}</span>
            <div class="question-text" style="margin-bottom:4px">${esc(q.question)}</div>
            ${q.type === 'choice'
              ? `<ol class="gen-choices">${q.choices.map((c, j) => `<li class="${j === q.answer ? 'ok-text' : ''}">${esc(c)}${j === q.answer ? ' ✓' : ''}</li>`).join('')}</ol>`
              : `<div class="ok-text">正解：${esc(q.answer.split('|').join(' / '))}</div>`}
            ${q.explanation ? `<div class="muted explanation">${esc(q.explanation)}</div>` : ''}
          </div>
        </label>`).join('')}
      <div class="row" style="margin-top:12px">
        <button id="addGenerated">選択した問題を追加</button>
      </div>
    </div>`;
  renderMath(box);
  box.scrollIntoView({ behavior: 'smooth' });

  const checks = [...box.querySelectorAll('[data-gen]')];
  box.querySelector('#checkAll').onchange = (e) => checks.forEach((c) => { c.checked = e.target.checked; });
  box.querySelector('#addGenerated').onclick = () => {
    const picked = checks.filter((c) => c.checked).map((c) => generated[+c.dataset.gen]);
    if (!picked.length) { alert('追加する問題を選んでください'); return; }
    picked.forEach((q) => s.questions.push({ ...q, id: uid(), image: '', explanationImage: '', stats: { correct: 0, wrong: 0 } }));
    save();
    go('subject', s.id);
  };
}

// ===== 画面: 設定 =====
function renderSettings() {
  const st = getSettings();
  const loggedIn = !!Sync.user;
  view(`
    <h1>設定</h1>

    <form class="card" id="aiForm">
      <h2>AI問題生成（Claude API）</h2>
      <label class="field"><span>APIキー（この端末にだけ保存されます）</span>
        <input type="password" name="apiKey" value="${esc(st.apiKey)}" placeholder="sk-ant-..." autocomplete="off">
      </label>
      <label class="field"><span>モデル</span>
        <select name="model">${AI_MODELS.map((m) => `<option value="${m.id}" ${m.id === st.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      </label>
      <p class="muted small">キーは <a href="https://platform.claude.com/" target="_blank" rel="noopener">Claude Console</a> で作成できます（従量課金）。共用PCでは保存しないでください。</p>
      <div class="row"><button type="submit">保存</button><span id="aiSaved" class="muted"></span></div>
    </form>

    <div class="card">
      <h2>AI利用料金（この端末）</h2>
      ${(() => {
        const log = getUsageLog();
        if (!log.count) return '<p class="muted">まだ利用していません。</p>';
        const months = Object.entries(log.months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
        return `
          <div class="stats-row">
            <div><div class="stat">${usd(log.months[new Date().toLocaleDateString('sv-SE').slice(0, 7)] || 0)}</div><div class="muted">今月</div></div>
            <div><div class="stat">${usd(log.total)}</div><div class="muted">累計（${log.count}回）</div></div>
          </div>
          <table class="usage-table">
            <thead><tr><th>日時</th><th>科目</th><th>モデル</th><th class="num">トークン（入力/出力）</th><th class="num">料金</th></tr></thead>
            <tbody>${log.history.slice(0, 10).map((h) => `<tr>
              <td>${new Date(h.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td>${esc(h.subject || '')}</td><td>${esc((h.model || '').replace('claude-', ''))}</td>
              <td class="num">${(h.input || 0).toLocaleString()} / ${(h.output || 0).toLocaleString()}</td>
              <td class="num">${usd(h.cost)}</td></tr>`).join('')}</tbody>
          </table>
          ${months.length > 1 ? `<p class="muted small">月別: ${months.map(([m, c]) => `${m} ${usd(c)}`).join(' ・ ')}</p>` : ''}
          <div class="row"><button class="ghost" id="resetUsage">記録をリセット</button></div>`;
      })()}
      <p class="muted small">トークン数と公開料金から計算した目安です（税・為替は含みません）。正確な請求額は <a href="https://platform.claude.com/" target="_blank" rel="noopener">Claude Console</a> で確認できます。別の端末で使った分はここには含まれません。</p>
    </div>

    <form class="card" id="syncForm">
      <h2>ログインと端末間同期（Firebase）</h2>
      <p class="muted small">自分の Firebase プロジェクトを作り、ウェブアプリの設定（firebaseConfig）を貼り付けてください。手順は README に書いてあります。</p>
      <label class="field"><span>firebaseConfig</span>
        <textarea name="firebaseConfig" placeholder='{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'>${esc(st.firebaseConfig)}</textarea>
      </label>
      <div class="row" style="margin-bottom:8px">
        <button type="submit">設定を保存して接続</button>
        ${loggedIn ? '<button type="button" class="ghost" id="logoutBtn">ログアウト</button><button type="button" class="ghost" id="syncNow">今すぐ同期</button>'
          : '<button type="button" class="ghost" id="loginBtn">Googleでログイン</button>'}
      </div>
      <div>状態：<span id="syncStatus">${esc(Sync.status)}</span></div>
    </form>`);

  const resetUsage = app.querySelector('#resetUsage');
  if (resetUsage) resetUsage.onclick = () => {
    if (confirm('AI利用料金の記録をリセットしますか？（実際の請求には影響しません）')) {
      localStorage.removeItem(USAGE_KEY);
      renderSettings();
    }
  };
  app.querySelector('#aiForm').onsubmit = (e) => {
    e.preventDefault();
    setSettings({ apiKey: e.target.apiKey.value.trim(), model: e.target.model.value });
    app.querySelector('#aiSaved').textContent = '保存しました';
  };
  app.querySelector('#syncForm').onsubmit = async (e) => {
    e.preventDefault();
    const raw = e.target.firebaseConfig.value;
    try { Sync.parseConfig(raw); } catch (err) { alert('設定を読み取れません: ' + err.message); return; }
    setSettings({ firebaseConfig: raw });
    await Sync.init(raw);
    renderSettings();
  };
  const login = app.querySelector('#loginBtn');
  if (login) login.onclick = async () => {
    try { await Sync.login(); renderSettings(); } catch (err) { alert('ログインできませんでした: ' + err.message); }
  };
  const logout = app.querySelector('#logoutBtn');
  if (logout) logout.onclick = async () => { await Sync.logout(); renderSettings(); };
  const now = app.querySelector('#syncNow');
  if (now) now.onclick = () => Sync.start();
}

// ===== 画面: 演習 =====
let quiz = null;
let keyHandler = null;

function startQuiz(subjectId, questionIds, opts) {
  if (!questionIds.length) return;
  quiz = { subjectId, ids: questionIds, index: 0, results: [], opts: opts || {} };
  if (location.hash === '#quiz') renderQuestion();
  else location.hash = '#quiz';
}

function renderQuestion() {
  const s = findSubject(quiz.subjectId);
  const q = s && s.questions.find((x) => x.id === quiz.ids[quiz.index]);
  if (!q) return renderResult();

  const order = q.type === 'choice'
    ? (quiz.opts.shuffleChoices ? shuffle(q.choices.map((_, i) => i)) : q.choices.map((_, i) => i))
    : [];

  view(`
    <div class="row spread">
      <span class="muted">${esc(s.name)}</span>
      <span class="muted">${quiz.index + 1} / ${quiz.ids.length}</span>
    </div>
    <div class="progress-bar" style="margin-bottom:16px"><div style="width:${(quiz.index / quiz.ids.length) * 100}%"></div></div>
    <div class="card">
      <div class="question-text">${esc(q.question)}</div>
      ${imgTag(q.image, '問題の図')}
      <div id="answerArea">
        ${q.type === 'choice'
          ? order.map((i, n) => `<button class="choice" data-i="${i}">${n + 1}. ${esc(q.choices[i])}</button>`).join('')
          : `<form id="textForm" class="row">
               <input type="text" name="ans" placeholder="答えを入力" autocomplete="off" style="flex:1">
               <button type="submit">回答</button>
             </form>`}
      </div>
      <div id="feedback"></div>
    </div>
    <div class="row spread">
      <button class="ghost" id="quitBtn">中断して結果を見る</button>
      <span class="muted">${q.type === 'choice' ? 'キー 1〜9 で選択' : 'Enterで回答'}</span>
    </div>`);

  let answered = false;
  const finish = (correct, userAnswer) => {
    if (answered) return;
    answered = true;
    q.stats.correct += correct ? 1 : 0;
    q.stats.wrong += correct ? 0 : 1;
    q.stats.lastResult = correct ? 'correct' : 'wrong';
    logStudy(s.id);
    save();
    quiz.results.push({ id: q.id, correct, userAnswer });

    const fb = app.querySelector('#feedback');
    fb.innerHTML = `
      <div class="feedback ${correct ? 'ok' : 'ng'}">
        <strong>${correct ? '⭕ 正解！' : '❌ 不正解'}</strong>
        ${correct ? '' : `<div>正解：${esc(correctAnswerText(q))}</div>`}
        ${q.explanation ? `<div class="explanation">${esc(q.explanation)}</div>` : ''}
        ${imgTag(q.explanationImage, '解説の図')}
      </div>
      <div class="row" style="margin-top:12px">
        <button id="nextBtn">${quiz.index + 1 < quiz.ids.length ? '次の問題へ →' : '結果を見る'}</button>
        ${!correct && q.type === 'text' ? '<button class="ghost" id="overrideBtn">実は正解だった（自己判定）</button>' : ''}
      </div>`;
    renderMath(fb);
    const nextBtn = app.querySelector('#nextBtn');
    nextBtn.focus();
    nextBtn.onclick = () => { quiz.index++; renderQuestion(); };
    const ov = app.querySelector('#overrideBtn');
    if (ov) ov.onclick = () => {
      q.stats.wrong--; q.stats.correct++; q.stats.lastResult = 'correct'; save();
      quiz.results[quiz.results.length - 1].correct = true;
      quiz.index++; renderQuestion();
    };
  };

  if (q.type === 'choice') {
    const buttons = app.querySelectorAll('.choice');
    const choose = (btn) => {
      if (answered) return;
      const i = +btn.dataset.i;
      buttons.forEach((b) => {
        b.disabled = true;
        if (+b.dataset.i === q.answer) b.classList.add('correct');
      });
      if (i !== q.answer) btn.classList.add('wrong');
      finish(i === q.answer, q.choices[i]);
    };
    buttons.forEach((b) => b.onclick = () => choose(b));
    keyHandler = (e) => {
      const n = parseInt(e.key, 10);
      if (!answered && n >= 1 && n <= buttons.length) choose(buttons[n - 1]);
    };
  } else {
    const form = app.querySelector('#textForm');
    form.ans.focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = form.ans.value;
      form.ans.disabled = true;
      form.querySelector('button').disabled = true;
      finish(isTextCorrect(v, q.answer), v);
    };
    keyHandler = null;
  }

  app.querySelector('#quitBtn').onclick = renderResult;
}

document.addEventListener('keydown', (e) => {
  if (location.hash === '#quiz' && keyHandler && e.target.tagName !== 'INPUT') keyHandler(e);
});

function renderResult() {
  keyHandler = null;
  const s = findSubject(quiz.subjectId);
  const total = quiz.results.length;
  const ok = quiz.results.filter((r) => r.correct).length;
  const wrong = quiz.results.filter((r) => !r.correct);
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const msg = pct === 100 ? '完璧です！🎉' : pct >= 80 ? 'よくできました！' : pct >= 60 ? 'あと一歩！' : '復習して再挑戦しましょう';

  view(`
    <h1>結果 <span class="muted">— ${esc(s ? s.name : '')}</span></h1>
    <div class="card">
      <div class="score">${ok} / ${total}</div>
      <div style="text-align:center">正答率 ${pct}% ・ ${msg}</div>
      <div class="muted" style="text-align:center">今日は合計 ${dayTotal(dateKey())}問 解きました${streak() > 1 ? `（${streak()}日連続）` : ''}</div>
    </div>
    ${wrong.length && s ? `
      <div class="card">
        <h2>間違えた問題</h2>
        ${wrong.map((r) => {
          const q = s.questions.find((x) => x.id === r.id);
          if (!q) return '';
          return `<div class="q-list-item">
            <div class="question-text" style="margin-bottom:4px">${esc(q.question)}</div>
            <div class="muted">あなたの回答：${esc(r.userAnswer || '（空欄）')} ／ 正解：${esc(correctAnswerText(q))}</div>
            ${q.explanation ? `<div class="explanation muted">${esc(q.explanation)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}
    <div class="row">
      ${wrong.length ? '<button id="retryWrong">間違えた問題をもう一度</button>' : ''}
      <button class="ghost" id="backBtn">科目に戻る</button>
    </div>`);

  const r = app.querySelector('#retryWrong');
  if (r) r.onclick = () => startQuiz(quiz.subjectId, shuffle(wrong.map((w) => w.id)), quiz.opts);
  app.querySelector('#backBtn').onclick = () => go('subject', quiz.subjectId);
}

// ===== ルーティング =====
function go(viewName, ...args) {
  const hash = '#' + [viewName, ...args].join('/');
  if (location.hash === hash) route(); else location.hash = hash;
}

function route() {
  keyHandler = null;
  const [name, a, b] = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  if (name === 'subject') return renderSubject(a);
  if (name === 'edit') return renderEdit(a, b);
  if (name === 'generate') return renderGenerate(a);
  if (name === 'settings') return renderSettings();
  if (name === 'quiz' && quiz) return renderQuestion();
  return renderHome();
}

// ===== インポート / エクスポート / ヘッダー =====
document.getElementById('homeBtn').onclick = () => go('home');
document.getElementById('settingsBtn').onclick = () => go('settings');

document.getElementById('exportBtn').onclick = () => {
  const data = { subjects: state.subjects, studyLog: state.studyLog };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `問題集_${dateKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

document.getElementById('importInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.subjects)) throw new Error('形式が正しくありません');
    const incoming = normalizeState({ subjects: data.subjects }).subjects;
    const replace = confirm('OK：現在のデータを置き換える\nキャンセル：現在のデータに追加する');
    if (replace) {
      state.subjects = incoming;
      if (data.studyLog) state.studyLog = data.studyLog;
    } else {
      incoming.forEach((s) => state.subjects.push({ ...s, id: uid() }));
    }
    save();
    go('home');
  } catch (err) {
    alert('読み込みに失敗しました: ' + err.message);
  }
  e.target.value = '';
};

const syncBadge = document.getElementById('syncBadge');
Sync.onStatus((s) => {
  syncBadge.textContent = Sync.user ? (s.startsWith('同期済み') || s.startsWith('同期中') ? '☁️ 同期' : '☁️ ' + s) : '';
  const el = document.getElementById('syncStatus');
  if (el) el.textContent = s;
});

// ===== 起動 =====
(async () => {
  await loadState();
  window.addEventListener('hashchange', route);
  route();
  const cfg = getSettings().firebaseConfig;
  if (cfg) Sync.init(cfg);
})();
