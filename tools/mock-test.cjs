// 使い方: node tools/mock-test.cjs <スクショの出力先>
// AI の代わりに決まった返事を返す偽の window.claude を入れて、画面の流れを PC とスマホで確かめる。
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const MOCK = `
window.__calls = [];
window.claude = { use: async (n) => {
  if (n !== 'sample') return null;
  const f = async () => ({ text: 'x' });
  f.json = async (input, opts) => {
    window.__calls.push({ input, opts: { modelTier: opts && opts.modelTier } });
    await new Promise(r => setTimeout(r, 250));
    if (input.includes('"reply"')) return { reply: '……用件は手短に。帝国の使者が来る前に、腹を決めておくことだ。', relation_delta: 2, mood: '思案', memo: '' };
    if (input.includes('"quests"')) return { quests: [{ title: '密輸商人の摘発', desc: '西の港で武器の密輸が行われている。', client: '港の役人', reward: '金貨200' }] };
    const res = {
      narrative: '使者は深く頭を下げたが、その目は笑っていなかった。贈り物の金貨を受け取った帝国の使者は、「皇帝陛下はヴェルナの忠誠を楽しみにしておられる」とだけ告げて去った。',
      outcome: 'partial', outcome_reason: '礼は尽くしたが足元を見られた',
      stat_changes: [{ key: 'stability', delta: 4, reason: '当面の安心' }, { key: 'support', delta: -3, reason: '弱腰と見られた' }],
      money_changes: [{ amount: -300, label: '帝国への贈り物' }],
      item_changes: [{ op: 'add', name: '皇帝の親書', icon: '📜', desc: '忠誠を求める文面が並ぶ。' }],
      quest_changes: [{ id: 'q2', status: 'done' }],
      profile_changes: [{ label: '才覚', value: '慎重' }],
      entity_changes: [{ id: 'e1', relation_delta: 8, attitude: '見下し', mood: '満足', note: '贈り物を受け取った' }, { id: 'e6', relation_delta: -10, mood: '不満' }],
      new_entities: [{ name: '帝国使者ドラン', kind: '人物', relation: -5, power: 30, attitude: '慇懃', bond: '監視役', mood: '冷静', desc: '皇帝の側近。' }],
      world_events: [{ actor: '王子レオン', text: '国境の兵を倍に増やした。' }],
      news: [{ source: '酒場の噂', headline: '新しい公主は帝国に尻尾を振ったらしい' }],
      trait_changes: { aggression: -3, diplomacy: 5 }, perception: '帝国に従順な若君と見られ始めている。',
      new_date: '大陸暦812年 春・4日目', summary: '帝国に贈り物を送り衝突を避けた',
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
    const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('banshoroku.saves.v2'))[0]);
    console.log(name, { turn: st.turn, money: st.wallet.balance, items: st.items.length, ents: st.entities.length, chat: (st.chats.e5 || []).length, quests: st.quests.map((q) => q.title + ':' + q.status).join(' / '), variants: pgtxt, errs });
    await ctx.close();
  }
  await b.close();
})();
