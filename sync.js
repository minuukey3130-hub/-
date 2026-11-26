'use strict';
// ===== ログイン & 端末間同期（Firebase Authentication + Cloud Firestore） =====
// データ構造:
//   users/{uid}/subjects/{subjectId}  { json: 科目のJSON文字列, updatedAt }
//   users/{uid}/meta/main             { studyLog: JSON文字列, deleted: JSON文字列, updatedAt }
// 科目単位で「新しい方が勝つ」方式でマージします。

const FIREBASE_VERSION = '13.1.0';
const FB_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const MAX_DOC_CHARS = 900000; // Firestore の1ドキュメント上限(1MiB)に余裕を持たせる

const Sync = {
  fb: null,
  auth: null,
  db: null,
  user: null,
  status: '未設定',
  pending: new Set(),
  metaDirty: false,
  timer: null,
  unsubs: [],
  listeners: new Set(),

  onStatus(fn) { this.listeners.add(fn); },
  setStatus(s) { this.status = s; this.listeners.forEach((fn) => fn(s)); },

  // 「const firebaseConfig = { apiKey: "..." }」形式の貼り付けにも対応
  parseConfig(raw) {
    if (!raw || !raw.trim()) return null;
    let s = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (!s) throw new Error('設定に { } が見つかりません');
    s = s.replace(/\/\/.*$/gm, '')
      .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
      .replace(/'([^']*)'/g, '"$1"')
      .replace(/,\s*}/g, '}');
    const cfg = JSON.parse(s);
    if (!cfg.apiKey || !cfg.projectId) throw new Error('apiKey と projectId が必要です');
    return cfg;
  },

  async init(rawConfig) {
    this.teardown();
    let cfg;
    try { cfg = this.parseConfig(rawConfig); } catch (e) { this.setStatus('設定エラー: ' + e.message); return; }
    if (!cfg) { this.setStatus('未設定'); return; }
    if (location.protocol === 'file:') { this.setStatus('ログインには Web サーバー経由で開く必要があります（README参照）'); return; }

    try {
      this.setStatus('接続中…');
      const [app, auth, fs] = await Promise.all([
        import(`${FB_BASE}/firebase-app.js`),
        import(`${FB_BASE}/firebase-auth.js`),
        import(`${FB_BASE}/firebase-firestore.js`),
      ]);
      this.fb = { ...app, ...auth, ...fs };
      const name = 'exam-prep-' + cfg.projectId;
      const fbApp = app.getApps().find((a) => a.name === name) || app.initializeApp(cfg, name);
      this.auth = auth.getAuth(fbApp);
      this.db = fs.getFirestore(fbApp);
      this.unsubs.push(auth.onAuthStateChanged(this.auth, (user) => {
        this.user = user;
        if (user) this.start();
        else { this.stopListeners(); this.setStatus('未ログイン'); }
      }));
    } catch (e) {
      this.setStatus('接続エラー: ' + e.message);
    }
  },

  teardown() {
    this.stopListeners();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.user = null;
  },

  liveUnsubs: [],
  stopListeners() { this.liveUnsubs.forEach((u) => u()); this.liveUnsubs = []; },

  async login() {
    if (!this.auth) throw new Error('先に Firebase の設定を保存してください');
    await this.fb.signInWithPopup(this.auth, new this.fb.GoogleAuthProvider());
  },

  async logout() {
    if (this.auth) await this.fb.signOut(this.auth);
  },

  subjectsCol() { return this.fb.collection(this.db, 'users', this.user.uid, 'subjects'); },
  metaRef() { return this.fb.doc(this.db, 'users', this.user.uid, 'meta', 'main'); },

  parseRemote(snapDocs, metaSnap) {
    const subjects = [];
    snapDocs.forEach((d) => { try { subjects.push(JSON.parse(d.data().json)); } catch (e) { /* 壊れた文書は無視 */ } });
    const m = metaSnap && metaSnap.exists() ? metaSnap.data() : {};
    const safe = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
    return { subjects, studyLog: safe(m.studyLog), deleted: safe(m.deleted) };
  },

  async start() {
    const { getDocs, getDoc, onSnapshot } = this.fb;
    try {
      this.setStatus('同期中…');
      const [snap, metaSnap] = await Promise.all([getDocs(this.subjectsCol()), getDoc(this.metaRef())]);
      const remote = this.parseRemote(snap.docs, metaSnap);
      const toPush = applyRemote(remote);
      toPush.forEach((id) => this.pending.add(id));
      this.metaDirty = true;
      await this.flush();

      this.stopListeners();
      this.liveUnsubs.push(onSnapshot(this.subjectsCol(), (s) => {
        if (s.metadata.hasPendingWrites) return;
        const changed = s.docChanges().filter((c) => c.type !== 'removed').map((c) => c.doc);
        if (changed.length) applyRemote({ ...this.parseRemote(changed, null), studyLog: {}, deleted: {} });
      }));
      this.liveUnsubs.push(onSnapshot(this.metaRef(), (m) => {
        if (m.metadata.hasPendingWrites) return;
        const r = this.parseRemote([], m);
        applyRemote({ subjects: [], studyLog: r.studyLog, deleted: r.deleted });
      }));
      this.setStatus(`同期中（${this.user.email || this.user.displayName || 'ログイン中'}）`);
    } catch (e) {
      this.setStatus('同期エラー: ' + e.message);
    }
  },

  onLocalChange(changedIds, metaChanged) {
    if (!this.user) return;
    changedIds.forEach((id) => this.pending.add(id));
    if (metaChanged) this.metaDirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  },

  async flush() {
    if (!this.user) return;
    const { setDoc, deleteDoc, doc } = this.fb;
    const ids = [...this.pending];
    this.pending.clear();
    const tooLarge = [];
    try {
      for (const id of ids) {
        const ref = doc(this.subjectsCol(), id);
        const s = state.subjects.find((x) => x.id === id);
        if (!s) { await deleteDoc(ref); this.metaDirty = true; continue; }
        const json = JSON.stringify(s);
        if (json.length > MAX_DOC_CHARS) { tooLarge.push(s.name); continue; }
        await setDoc(ref, { json, updatedAt: s.updatedAt || 0 });
      }
      if (this.metaDirty) {
        this.metaDirty = false;
        await setDoc(this.metaRef(), {
          studyLog: JSON.stringify(state.studyLog),
          deleted: JSON.stringify(state.deleted),
          updatedAt: Date.now(),
        });
      }
      this.setStatus(tooLarge.length
        ? `⚠️ 「${tooLarge.join('」「')}」は画像が多すぎて同期できません`
        : `同期済み（${this.user.email || 'ログイン中'}）`);
    } catch (e) {
      ids.forEach((id) => this.pending.add(id));
      this.setStatus('同期エラー: ' + e.message);
    }
  },
};
