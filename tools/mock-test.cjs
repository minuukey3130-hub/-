// 使い方: node tools/mock-test.cjs <スクショの出力先>
// AI の代わりに決まった返事を返す偽の window.claude を入れて、画面の流れを PC とスマホで確かめる。
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const MOCK = `
window.__calls = [];
// 偽の保存場所（localStorage の __fakedb に置き、再読み込みしても残る ＝ サーバー役）
const FAKE = (() => {
  const load = () => { try { return JSON.parse(localStorage.getItem('__fakedb') || '{}'); } catch { return {}; } };
  const put = (o) => localStorage.setItem('__fakedb', JSON.stringify(o));
  const cp = (x) => JSON.parse(JSON.stringify(x));
  const docRef = (path) => ({ id: path.split('/').pop(), path,
    get: async () => { const o = load(); return { id: path.split('/').pop(), exists: path in o, data: () => (path in o ? cp(o[path]) : undefined) }; },
    set: async (d) => { if (JSON.stringify(d).length > 256 * 1024) throw { code: 'invalid_argument' }; const o = load(); o[path] = cp(d); put(o); },
    delete: async () => { const o = load(); delete o[path]; put(o); },
    collection: (c) => colRef(path + '/' + c) });
  const colRef = (path) => {
    const q = (filters) => ({
      where: (f, op, v) => q([...filters, [f, v]]),
      get: async () => {
        const depth = path.split('/').length + 1;
        const docs = Object.entries(load()).filter(([k]) => k.startsWith(path + '/') && k.split('/').length === depth)
          .filter(([, d]) => filters.every(([f, v]) => d[f] === v)).sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, d]) => ({ id: k.split('/').pop(), exists: true, data: () => cp(d) }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    return Object.assign(q([]), { path, doc: (id) => docRef(path + '/' + id) });
  };
  return { doc: docRef, collection: colRef };
})();
window.claude = { use: async (n) => {
  if (n === 'db') return window.__noDb ? null : FAKE;
  if (n === 'user') return { id: async () => 'viewer1' };
  if (n !== 'sample') return null;
  const f = async () => ({ text: 'x' });
  f.json = async (input, opts) => {
    window.__calls.push({ input, opts: { modelTier: opts && opts.modelTier } });
    await new Promise(r => setTimeout(r, 250));
    if (input.includes('"reply"')) return { reply: '……用件は手短に。帝国の使者が来る前に、腹を決めておくことだ。', relation_delta: 2, mood: '思案', memo: '' };
    if (input.includes('"personas"')) return { personas: [...input.matchAll(/id:([a-z0-9_]+)｜/g)].map((m) => ({ id: m[1], persona: { personality: '寡黙', speech: '一人称は「拙者」', values: '忠義', never: '嘘' } })) };
    if (input.includes('"explain"')) return { explain: 'いまあなたは玉座の間にいます。帝国の使者が贈り物を受け取って帰りました。次は将軍カイラをなだめるか、王子レオンと話すことができます。' };
    if (input.includes('"synopsis"')) return { synopsis: 'ヴェルナ公国の若き公主は帝国に贈り物を送り、衝突を避け続けた。将軍カイラは不満を募らせている。' };
    if (input.includes('"quests"')) return { quests: [{ title: '密輸商人の摘発', desc: '西の港で武器の密輸が行われている。', client: '港の役人', reward: '金貨200' }] };
    const res = {
      narrative: '使者は深く頭を下げたが、その目は笑っていなかった。贈り物の金貨を受け取った帝国の使者は、「皇帝陛下はヴェルナの忠誠を楽しみにしておられる」とだけ告げて去った。',
      outcome: 'partial', outcome_reason: '礼は尽くしたが足元を見られた',
      stat_changes: [{ key: 'stability', delta: 4, reason: '当面の安心' }, { key: 'support', delta: -3, reason: '弱腰と見られた' }],
      money_changes: [{ amount: -300, label: '帝国への贈り物' }],
      item_changes: [{ op: 'add', name: '皇帝の親書', icon: '📜', desc: '忠誠を求める文面が並ぶ。' }, { op: 'add', name: '銀の杯', icon: '🏆', desc: '使者の手土産。' }, { op: 'add', name: '干し肉', icon: '🍖', desc: '保存食。' }],
      quest_changes: [{ id: 'q2', status: 'done' }],
      profile_changes: [{ label: '才覚', value: '慎重' }],
      entity_changes: [{ id: 'e1', relation_delta: 8, attitude: '見下し', mood: '満足', note: '贈り物を受け取った', memory: '公主から金貨を受け取った' }, { id: 'e6', relation_delta: -10, mood: '不満' }],
      new_entities: [{ name: '帝国使者ドラン', kind: '人物', relation: -5, power: 30, attitude: '慇懃', bond: '監視役', mood: '冷静', desc: '皇帝の側近。' }],
      world_events: [{ actor: '王子レオン', text: '国境の兵を倍に増やした。' }],
      news: [{ source: '酒場の噂', headline: '新しい公主は帝国に尻尾を振ったらしい' }],
      trait_changes: { aggression: -3, diplomacy: 5 }, perception: '帝国に従順な若君と見られ始めている。',
      situation: '帝国の使者は去ったが、将軍カイラの不満が高まっている。次は国内を固めたい。', terms: [{ term: '皇帝の親書', meaning: '帝国への忠誠を求める手紙' }],
      location: '城の中庭',
      new_date: '大陸暦812年 春・4日目', summary: '帝国に贈り物を送り衝突を避けた', milestone: '帝国に贈り物を送った', threads: [{ title: '帝国との緊張', stage: '贈り物で一時休戦', status: 'open' }, { title: 'カイラの不満', stage: '将軍が苛立っている', status: 'open' }],
      suggestions: ['将軍カイラをなだめる', 'レオンに使者を送る', '商人同盟と取引を見直す'], ending: null };
    const raw = JSON.stringify(res);
    if (opts && opts.onText) { opts.onText({ text: raw.slice(0, 120), delta: raw.slice(0, 120) }); await new Promise(r => setTimeout(r, 250)); }
    return res;
  };
  return f;
}};`;

(async () => {
  const out = path.resolve(process.argv[2] || '.');
  const page = fs.readFileSync(path.join(__dirname, '..', 'bansho.html'), 'utf8');
  const file = path.join(out, 'test.html');
  fs.writeFileSync(file, '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + page + '</body></html>');
  const b = await chromium.launch();
  for (const [name, opts] of [['pc', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(MOCK);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto('file://' + file);
    await pg.waitForTimeout(700);
    await pg.screenshot({ path: `${out}/${name}_1_title.png` });
    await pg.click('[data-mode="nation"]');
    await pg.waitForTimeout(300);
    await pg.fill('#cmd', '帝国の使者を迎え、贈り物を渡す');
    await pg.click('#send');
    await pg.waitForTimeout(1000);
    await pg.screenshot({ path: `${out}/${name}_2_turn.png` });
    await pg.click('#regen');
    await pg.waitForTimeout(1000);
    const pgtxt = await pg.textContent('.tools .pg');
    for (const t of ['time', 'stat', 'people', 'wallet', 'items', 'quest']) {
      await pg.click(`.tabbar [data-tab="${t}"]`);
      await pg.waitForTimeout(250);
      await pg.screenshot({ path: `${out}/${name}_3_${t}.png` });
    }
    await pg.click('.tabbar [data-tab="chat"]');
    await pg.waitForTimeout(200);
    await pg.click('[data-chat="e5"]');
    await pg.fill('#cmsg', '帝国の使者をどう迎えるべきだと思う？');
    await pg.click('#csend');
    await pg.waitForTimeout(700);
    await pg.screenshot({ path: `${out}/${name}_4_chat.png` });
    await pg.click('.tabbar [data-tab="quest"]');
    await pg.click('#qref');
    await pg.waitForTimeout(600);
    // 18 手まで進めて、あらすじへの畳み込みを起こす
    await pg.click('#sclose');
    for (let i = 0; i < 17; i++) {
      await pg.fill('#cmd', '様子を見る ' + i);
      await pg.click('#send');
      await pg.waitForFunction(() => !document.querySelector('#stop'), null, { timeout: 5000 });
    }
    await pg.waitForTimeout(800);
    await pg.reload();
    await pg.waitForTimeout(900);
    await pg.screenshot({ path: `${out}/${name}_5_title_after_reload.png` });
    await pg.click('[data-load]');
    await pg.waitForTimeout(600);
    await pg.click('.tabbar [data-tab="log"]');
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: `${out}/${name}_6_log.png` });
    const st = await pg.evaluate(() => window.__kifukiState ? null : null);
    const info = await pg.evaluate(() => {
      const o = JSON.parse(localStorage.getItem('__fakedb') || '{}');
      const w = Object.entries(o).find(([k, v]) => v.kind === 'world');
      const keys = Object.keys(o);
      return { worldDoc: w && { turn: w[1].turn, logLen: w[1].logLen, synopsisUpTo: w[1].synopsisUpTo, hasSyn: !!w[1].synopsis, milestones: w[1].milestones.length, e1mem: (w[1].entities.find((e) => e.id === 'e1') || {}).memory?.length, money: w[1].wallet.balance }, chunks: keys.filter((k) => k.includes('/log/')).length, chats: keys.filter((k) => k.includes('/chats/')).length, maxDoc: Math.max(...Object.values(o).map((v) => JSON.stringify(v).length)) };
    });
    const shown = await pg.evaluate(() => ({ cards: document.querySelectorAll('.story').length, more: !!document.getElementById('more') }));
    console.log(name, { variants: pgtxt, ...info, shown, errs });
    await ctx.close();
  }
  await b.close();
})();
