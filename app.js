'use strict';

// ===== データ =====
const STORAGE_KEY = 'exam-prep-app-v1';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function sampleData() {
  return {
    subjects: [
      {
        id: uid(),
        name: 'サンプル：統計学入門',
        questions: [
          {
            id: uid(), type: 'choice',
            question: 'データの中央の値を表す代表値で、外れ値の影響を受けにくいものはどれか。',
            choices: ['平均値', '中央値', '最頻値', '分散'],
            answer: 1,
            explanation: '中央値（メディアン）はデータを順に並べたときの真ん中の値で、極端な値の影響を受けにくい。',
            stats: { correct: 0, wrong: 0 },
          },
          {
            id: uid(), type: 'text',
            question: '標準偏差を2乗したものを何というか。',
            answer: '分散',
            explanation: '分散の正の平方根が標準偏差。',
            stats: { correct: 0, wrong: 0 },
          },
          {
            id: uid(), type: 'choice',
            question: '帰無仮説が正しいのに棄却してしまう誤りを何というか。',
            choices: ['第一種の過誤', '第二種の過誤', '標本誤差', '系統誤差'],
            answer: 0,
            explanation: '第一種の過誤（α過誤）。その確率が有意水準α。',
            stats: { correct: 0, wrong: 0 },
          },
        ],
      },
    ],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* 読めなければ初期データ */ }
  return sampleData();
}

let state = load();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { alert('保存に失敗しました: ' + e.message); }
}

const findSubject = (id) => state.subjects.find((s) => s.id === id);

// ===== ユーティリティ =====
const app = document.getElementById('app');

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
  return String(answer).split('|').some((a) => normalize(a) === n && n !== '');
}

function accuracy(q) {
  const t = q.stats.correct + q.stats.wrong;
  return t === 0 ? null : q.stats.correct / t;
}
const isWeak = (q) => q.stats.wrong > 0 && q.stats.lastResult === 'wrong';

// ===== 画面: ホーム =====
function renderHome() {
  const items = state.subjects.map((s) => {
    const total = s.questions.length;
    const answered = s.questions.filter((q) => q.stats.correct + q.stats.wrong > 0).length;
    const weak = s.questions.filter(isWeak).length;
    const pct = total ? Math.round((answered / total) * 100) : 0;
    return `
      <div class="card subject-item" data-id="${s.id}">
        <div class="row spread">
          <h2 style="margin:0">${esc(s.name)}</h2>
          ${weak ? `<span class="badge ng">要復習 ${weak}</span>` : ''}
        </div>
        <div class="muted">${total}問 ・ 学習済み ${answered}/${total}</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <h1>科目一覧</h1>
    ${items || '<div class="empty">まだ科目がありません。下から追加してください。</div>'}
    <div class="card">
      <form id="addSubject" class="row">
        <input type="text" name="name" placeholder="新しい科目名（例：民法総則）" required style="flex:1">
        <button type="submit">追加</button>
      </form>
    </div>`;

  app.querySelectorAll('.subject-item').forEach((el) =>
    el.addEventListener('click', () => go('subject', el.dataset.id)));
  app.querySelector('#addSubject').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    state.subjects.push({ id: uid(), name, questions: [] });
    save();
    renderHome();
  });
}

// ===== 画面: 科目詳細 =====
function renderSubject(id) {
  const s = findSubject(id);
  if (!s) return go('home');
  const weakCount = s.questions.filter(isWeak).length;

  const list = s.questions.map((q, i) => {
    const acc = accuracy(q);
    return `
      <div class="q-list-item">
        <div class="row spread">
          <div style="flex:1;min-width:0">
            <span class="muted">Q${i + 1} ・ ${q.type === 'choice' ? '選択式' : '記述式'}</span>
            ${isWeak(q) ? '<span class="badge ng">要復習</span>' : ''}
            <div>${esc(q.question.length > 80 ? q.question.slice(0, 80) + '…' : q.question)}</div>
            <div class="muted">${acc === null ? '未回答' : `正答率 ${Math.round(acc * 100)}%（${q.stats.correct}/${q.stats.correct + q.stats.wrong}）`}</div>
          </div>
          <div class="row">
            <button class="ghost" data-edit="${q.id}">編集</button>
            <button class="danger" data-del="${q.id}">削除</button>
          </div>
        </div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="row spread">
      <h1>${esc(s.name)}</h1>
      <div class="row">
        <button class="ghost" id="renameBtn">名前変更</button>
        <button class="danger" id="deleteSubjectBtn">科目を削除</button>
      </div>
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
        <button id="startUnanswered" class="ghost" ${s.questions.some((q) => q.stats.correct + q.stats.wrong === 0) ? '' : 'disabled'}>未回答のみ</button>
      </div>
    </div>

    <div class="card">
      <div class="row spread" style="margin-bottom:8px">
        <h2 style="margin:0">問題一覧（${s.questions.length}）</h2>
        <div class="row">
          <button class="ghost" id="resetStats">成績リセット</button>
          <button id="addQ">＋ 問題を追加</button>
        </div>
      </div>
      ${list || '<div class="empty">問題がありません。「問題を追加」から作成しましょう。</div>'}
    </div>`;

  const startWith = (pool) => {
    const opts = {
      shuffle: app.querySelector('#optShuffle').checked,
      shuffleChoices: app.querySelector('#optShuffleChoices').checked,
    };
    const count = Math.max(1, parseInt(app.querySelector('#optCount').value, 10) || pool.length);
    let qs = opts.shuffle ? shuffle(pool) : pool.slice();
    qs = qs.slice(0, count);
    startQuiz(s.id, qs.map((q) => q.id), opts);
  };

  app.querySelector('#startAll').onclick = () => startWith(s.questions);
  app.querySelector('#startWeak').onclick = () => startWith(s.questions.filter(isWeak));
  app.querySelector('#startUnanswered').onclick = () =>
    startWith(s.questions.filter((q) => q.stats.correct + q.stats.wrong === 0));
  app.querySelector('#addQ').onclick = () => go('edit', s.id);
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
    : { type: 'choice', question: '', choices: ['', '', '', ''], answer: 0, explanation: '' };
  if (!draft.choices) draft.choices = ['', '', '', ''];

  function draw() {
    const choicesHtml = draft.choices.map((c, i) => `
      <div class="choice-edit">
        <input type="radio" name="correct" value="${i}" ${draft.answer === i ? 'checked' : ''} title="正解にする">
        <input type="text" data-choice="${i}" value="${esc(c)}" placeholder="選択肢 ${i + 1}">
        <button type="button" class="danger" data-remove="${i}" ${draft.choices.length <= 2 ? 'disabled' : ''}>×</button>
      </div>`).join('');

    app.innerHTML = `
      <h1>${existing ? '問題を編集' : '問題を追加'} <span class="muted">— ${esc(s.name)}</span></h1>
      <form class="card" id="qForm">
        <label class="field"><span>形式</span>
          <select name="type">
            <option value="choice" ${draft.type === 'choice' ? 'selected' : ''}>選択式</option>
            <option value="text" ${draft.type === 'text' ? 'selected' : ''}>記述式（一問一答）</option>
          </select>
        </label>
        <label class="field"><span>問題文</span>
          <textarea name="question" required>${esc(draft.question)}</textarea>
        </label>
        ${draft.type === 'choice' ? `
          <div class="field"><span class="muted">選択肢（左の丸で正解を選択）</span>
            ${choicesHtml}
            <button type="button" class="ghost" id="addChoice">＋ 選択肢を追加</button>
          </div>` : `
          <label class="field"><span>正解（別解は「|」で区切る　例：分散|variance）</span>
            <input type="text" name="answerText" value="${esc(typeof draft.answer === 'string' ? draft.answer : '')}" required>
          </label>`}
        <label class="field"><span>解説（任意）</span>
          <textarea name="explanation">${esc(draft.explanation)}</textarea>
        </label>
        <div class="row">
          <button type="submit">保存</button>
          ${existing ? '' : '<button type="button" class="ghost" id="saveNext">保存して続けて追加</button>'}
          <button type="button" class="ghost" id="cancel">キャンセル</button>
        </div>
      </form>`;

    const form = app.querySelector('#qForm');
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
      if (existing) Object.assign(existing, q, { choices: q.choices });
      else s.questions.push(q);
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

// ===== 画面: 演習 =====
let quiz = null;

function startQuiz(subjectId, questionIds, opts) {
  quiz = { subjectId, ids: questionIds, index: 0, results: [], opts };
  location.hash = '#quiz';
  renderQuestion();
}

function renderQuestion() {
  const s = findSubject(quiz.subjectId);
  const q = s && s.questions.find((x) => x.id === quiz.ids[quiz.index]);
  if (!q) return renderResult();

  const order = q.type === 'choice'
    ? (quiz.opts.shuffleChoices ? shuffle(q.choices.map((_, i) => i)) : q.choices.map((_, i) => i))
    : [];

  app.innerHTML = `
    <div class="row spread">
      <span class="muted">${esc(s.name)}</span>
      <span class="muted">${quiz.index + 1} / ${quiz.ids.length}</span>
    </div>
    <div class="progress-bar" style="margin-bottom:16px"><div style="width:${(quiz.index / quiz.ids.length) * 100}%"></div></div>
    <div class="card">
      <div class="question-text">${esc(q.question)}</div>
      <div id="answerArea">
        ${q.type === 'choice'
          ? order.map((i, n) => `<button class="choice" data-i="${i}">${n + 1}. ${esc(q.choices[i])}</button>`).join('')
          : `<form id="textForm" class="row">
               <input type="text" name="ans" placeholder="答えを入力" autocomplete="off" style="flex:1" autofocus>
               <button type="submit">回答</button>
             </form>`}
      </div>
      <div id="feedback"></div>
    </div>
    <div class="row spread">
      <button class="ghost" id="quitBtn">中断して結果を見る</button>
      <span class="muted">${q.type === 'choice' ? 'キー 1〜9 で選択' : 'Enterで回答'}</span>
    </div>`;

  let answered = false;
  const finish = (correct, userAnswer) => {
    if (answered) return;
    answered = true;
    q.stats.correct += correct ? 1 : 0;
    q.stats.wrong += correct ? 0 : 1;
    q.stats.lastResult = correct ? 'correct' : 'wrong';
    save();
    quiz.results.push({ id: q.id, correct, userAnswer });

    const correctText = q.type === 'choice' ? q.choices[q.answer] : q.answer.split('|')[0];
    app.querySelector('#feedback').innerHTML = `
      <div class="feedback ${correct ? 'ok' : 'ng'}">
        <strong>${correct ? '⭕ 正解！' : '❌ 不正解'}</strong>
        ${correct ? '' : `<div>正解：${esc(correctText)}</div>`}
        ${q.explanation ? `<div class="explanation">${esc(q.explanation)}</div>` : ''}
      </div>
      <div class="row" style="margin-top:12px">
        <button id="nextBtn">${quiz.index + 1 < quiz.ids.length ? '次の問題へ →' : '結果を見る'}</button>
        ${!correct && q.type === 'text' ? '<button class="ghost" id="overrideBtn">実は正解だった（自己判定）</button>' : ''}
      </div>`;
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

let keyHandler = null;
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

  app.innerHTML = `
    <h1>結果 <span class="muted">— ${esc(s ? s.name : '')}</span></h1>
    <div class="card">
      <div class="score">${ok} / ${total}</div>
      <div style="text-align:center">正答率 ${pct}% ・ ${msg}</div>
    </div>
    ${wrong.length ? `
      <div class="card">
        <h2>間違えた問題</h2>
        ${wrong.map((r) => {
          const q = s.questions.find((x) => x.id === r.id);
          if (!q) return '';
          const correctText = q.type === 'choice' ? q.choices[q.answer] : q.answer.split('|')[0];
          return `<div class="q-list-item">
            <div>${esc(q.question)}</div>
            <div class="muted">あなたの回答：${esc(r.userAnswer || '（空欄）')} ／ 正解：${esc(correctText)}</div>
            ${q.explanation ? `<div class="explanation muted">${esc(q.explanation)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}
    <div class="row">
      ${wrong.length ? '<button id="retryWrong">間違えた問題をもう一度</button>' : ''}
      <button class="ghost" id="backBtn">科目に戻る</button>
    </div>`;

  const r = app.querySelector('#retryWrong');
  if (r) r.onclick = () => startQuiz(quiz.subjectId, shuffle(wrong.map((w) => w.id)), quiz.opts);
  app.querySelector('#backBtn').onclick = () => go('subject', quiz.subjectId);
}

// ===== ルーティング =====
function go(view, ...args) {
  const hash = '#' + [view, ...args].join('/');
  if (location.hash === hash) route(); else location.hash = hash;
}

function route() {
  keyHandler = null;
  const [view, a, b] = location.hash.slice(1).split('/');
  window.scrollTo(0, 0);
  if (view === 'subject') return renderSubject(a);
  if (view === 'edit') return renderEdit(a, b);
  if (view === 'quiz' && quiz) return renderQuestion();
  return renderHome();
}
window.addEventListener('hashchange', route);

// ===== インポート / エクスポート =====
document.getElementById('homeBtn').onclick = () => go('home');

document.getElementById('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `問題集_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

document.getElementById('importInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.subjects)) throw new Error('形式が正しくありません');
    data.subjects.forEach((s) => {
      s.id = s.id || uid();
      s.questions = (s.questions || []).map((q) => ({ ...q, id: q.id || uid(), stats: q.stats || { correct: 0, wrong: 0 } }));
    });
    const replace = confirm('OK：現在のデータを置き換える\nキャンセル：現在のデータに追加する');
    if (replace) state = data;
    else data.subjects.forEach((s) => state.subjects.push({ ...s, id: uid() }));
    save();
    go('home');
  } catch (err) {
    alert('読み込みに失敗しました: ' + err.message);
  }
  e.target.value = '';
};

route();
