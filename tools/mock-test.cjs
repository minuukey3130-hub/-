const { chromium, devices } = require('playwright');
const MOCK = `
window.claude = { use: async (n) => {
  if (n !== 'sample') return null;
  const f = async () => ({ text: 'x' });
  f.json = async (input, opts) => {
    window.__lastPrompt = input;
    await new Promise(r => setTimeout(r, 300));
    const res = {
      narrative: '使者は深く頭を下げたが、その目は笑っていなかった。贈り物の金貨を受け取った帝国の使者は、「皇帝陛下はヴェルナの忠誠を楽しみにしておられる」とだけ告げて去った。宰相ベルナルドは安堵の息をつき、将軍カイラは拳を握りしめた。',
      outcome: 'partial', outcome_reason: '礼は尽くしたが足元を見られた',
      stat_changes: [{key:'treasury', delta:-12, reason:'贈り物'},{key:'stability', delta:4, reason:'当面の安心'},{key:'support', delta:-3, reason:'弱腰と見られた'}],
      entity_changes: [{id:'e1', relation_delta:8, power_delta:0, attitude:'見下し', note:'贈り物を受け取った'},{id:'e6', relation_delta:-10, attitude:'不満'}],
      new_entities: [{name:'帝国使者ドラン', kind:'人物', relation:-5, power:30, attitude:'慇懃', desc:'皇帝の側近。小国を値踏みする目を持つ。'}],
      world_events: [{actor:'オルト王国', text:'国境の兵を倍に増やした。'},{actor:'ミレーヌ商業同盟', text:'ヴェルナ産の羊毛の買い付け値を下げた。'}],
      news: [{source:'酒場の噂', headline:'新しい公主は帝国に尻尾を振ったらしい'}],
      trait_changes: {aggression:-3, diplomacy:5, cunning:0, mercy:1, ambition:-2, honor:2},
      perception: '帝国に従順な、おとなしい若君と見られ始めている。',
      new_date: '大陸暦812年 初夏', summary: '帝国に贈り物を送り、ひとまず衝突を避けた',
      suggestions: ['将軍カイラをなだめ、国境の守りを任せる','オルト王国に使者を送る','商人同盟と羊毛の取引を見直す'],
      ending: null };
    const raw = JSON.stringify(res);
    if (opts && opts.onText) { opts.onText({ text: raw.slice(0, 120), delta: raw.slice(0,120) }); await new Promise(r => setTimeout(r, 300)); }
    return res;
  };
  return f;
}};`;
// 使い方: node tools/mock-test.cjs <スクショの出力先>
// AI の代わりに決まった返事を返す偽の window.claude を入れて、画面の流れを確かめる。
const fs = require('fs');
const path = require('path');
(async () => {
  const out = path.resolve(process.argv[2] || '.');
  const page = fs.readFileSync(path.join(__dirname, '..', 'bansho.html'), 'utf8');
  fs.writeFileSync(path.join(out, 'test.html'), '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + page + '</body></html>');
  const b = await chromium.launch();
  for (const [name, opts] of [['pc', { viewport: { width: 1360, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(MOCK);
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await pg.goto('file://' + out + '/test.html');
    await pg.waitForTimeout(800);
    await pg.screenshot({ path: `${out}/${name}_title.png`, fullPage: false });
    await pg.click('[data-mode="nation"]');
    await pg.waitForTimeout(300);
    await pg.fill('#cmd', '帝国に使者を送り、即位の挨拶と贈り物を届ける');
    await pg.click('#send');
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: `${out}/${name}_busy.png` });
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: `${out}/${name}_after.png` });
    if (name === 'phone') { await pg.click('.tabs [data-tab="world"]'); await pg.waitForTimeout(200); await pg.screenshot({ path: `${out}/${name}_world.png` }); }
    const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('banshoroku.saves.v1'))[0]);
    console.log(name, st.turn, st.stats.map(s=>s.value).join(','), st.entities.length, errs);
    if (name==='pc') { const p = await pg.evaluate(() => window.__lastPrompt.length); console.log('prompt chars', p); }
    await ctx.close();
  }
  await b.close();
})();
