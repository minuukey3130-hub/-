// 使い方: node tools/mock-test.cjs <出力先> を一度実行して test.html を作ったあと、node tools/pref-test.cjs <同じ出力先>
// 都道府県バトルロワイヤル: 隣接の判定・海路・合併・連合・滅亡・地図を偽の AI で確かめる。
const fs = require('fs');
const { chromium, devices } = require('playwright');
const src = fs.readFileSync('/home/user/bansho/tools/mock-test.cjs', 'utf8');
const MOCK = src.slice(src.indexOf('const MOCK = `') + 14, src.indexOf('`;\n\n(async'));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(devices['iPhone 13']);
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(() => {
    const orig = window.claude.use;
    window.claude.use = async (n) => {
      const f = await orig(n);
      if (n !== 'sample' || !f) return f;
      const j = f.json;
      const g = async (...a) => f(...a);
      g.json = async (input, opts) => {
        if (input.includes('【勢力図】') && input.includes('"narrative"')) {
          window.__calls.push({ input });
          await new Promise((r) => setTimeout(r, 200));
          window.__turn = (window.__turn || 0) + 1;
          if (window.__win) return { intent: '統一', narrative: '最後の県が降った。', outcome: 'success', outcome_reason: 'x', pref_changes: window.__win, situation: 's', terms: [], suggestions: [] };
          return { intent: '宮崎に攻め込む', narrative: '大分の部隊は県境を越え、宮崎の守備隊を押し返した。', outcome: 'success', outcome_reason: '兵站で優位', judge_basis: '力の差', situation: '宮崎を得た', terms: [],
            pref_changes: [{ pref: '宮崎県', to: '大分県', how: '制圧' }, { pref: '北海道', to: '大分', how: '制圧' }, { pref: '沖縄', to: '大分', how: '海路', sea: true }, { pref: '鳥取', to: '岡山', how: '合併' }],
            power_changes: [{ pref: '大分', delta: -5 }],
            alliance_changes: [{ op: 'form', name: '瀬戸内同盟', members: ['広島', '愛媛', '岡山'] }],
            stat_changes: [{ key: 'supply', delta: -6 }], world_events: [{ actor: '岡山県', text: '鳥取県を合併した' }], suggestions: ['a', 'b', 'c'] };
        }
        return j(input, opts);
      };
      return g;
    };
  });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + require('path').resolve(process.argv[2] || '.', 'test.html'));
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_1_title.png' });
  await pg.tap('[data-mode="pref"]'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_2_setup.png' });
  await pg.selectOption('#f-pref', 'oita');
  await pg.check('input[name="scen"][value="eastwest"]');
  await pg.tap('#go'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_3_intro.png' });
  await pg.fill('#cmd', '宮崎県に攻め込む'); await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => !document.querySelector('#stop'), null, { timeout: 8000 }); await pg.waitForTimeout(300);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_4_turn.png' });
  const p = await pg.evaluate(() => window.__calls.filter(c => c.input.includes('【勢力図】')).at(-1).input);
  await pg.tap('.tabbar [data-tab="map"]'); await pg.waitForTimeout(300);
  await pg.tap('[data-pt="miyazaki"]'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_5_map.png' });
  await pg.evaluate(() => document.querySelector('.sheet .body').scrollTop = 9999);
  await pg.screenshot({ path: require('path').resolve(process.argv[2] || '.') + '/pref_6_map2.png' });
  const st = await pg.evaluate(() => { const o = JSON.parse(localStorage.getItem('__fakedb')); const w = Object.values(o).find(v => v.kind === 'world'); const R = w.pref.regions; return { miyazaki: R.miyazaki.owner, hokkaido: R.hokkaido.owner, okinawa: R.okinawa.owner, tottori: R.tottori.owner, alliances: w.pref.alliances.map(a => a.name + ':' + a.members.length), tottoriStatus: w.entities.find(e => e.pref === 'tottori').status, ents: w.entities.length }; });
  const chips = await pg.evaluate(() => [...document.querySelectorAll('.chip')].map(c => c.textContent));
  console.log({ st, chips, promptHas: { map: p.includes('【勢力図】'), rules: p.includes('【都道府県バトルロワイヤルの決まり】'), schema: p.includes('"pref_changes"'), front: p.includes('【プレイヤーの前線】') }, promptLen: p.length, errs });
  // 統一の判定
  await pg.tap('#sclose');
  await pg.evaluate(() => { window.__win = Object.keys({ hokkaido:1 }).length ? null : null; });
  await pg.evaluate(() => { const ids = ['hokkaido','aomori','iwate','miyagi','akita','yamagata','fukushima','ibaraki','tochigi','gunma','saitama','chiba','tokyo','kanagawa','niigata','toyama','ishikawa','fukui','yamanashi','nagano','gifu','shizuoka','aichi','mie','shiga','kyoto','osaka','hyogo','nara','wakayama','tottori','shimane','okayama','hiroshima','yamaguchi','tokushima','kagawa','ehime','kochi','fukuoka','saga','nagasaki','kumamoto','miyazaki','kagoshima','okinawa']; window.__win = ids.map(i => ({ pref: i, to: '大分', how: '降伏' })); });
  // 隣接しない県は無効になるので、事前に全県を手で隣接させるのではなく、1 手ごとに広がる様子を見る
  for (let i = 0; i < 12; i++) {
    const ended = await pg.evaluate(() => !!document.querySelector('.end'));
    if (ended) break;
    await pg.tap('#progress'); await pg.waitForFunction(() => !document.querySelector('#stop'), null, { timeout: 8000 }); await pg.waitForTimeout(150);
  }
  const end = await pg.evaluate(() => document.querySelector('.end')?.innerText);
  const owned = await pg.evaluate(() => { const o = JSON.parse(localStorage.getItem('__fakedb')); const w = Object.values(o).find(v => v.kind === 'world'); return Object.values(w.pref.regions).filter(r => r.owner === 'oita').length; });
  console.log({ end, owned, errs });
  await b.close();
})();
