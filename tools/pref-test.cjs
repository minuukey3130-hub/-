// 使い方: node tools/mock-test.cjs <出力先> を一度実行して test.html を作ったあと、node tools/pref-test.cjs <同じ出力先>
// 都道府県バトルロワイヤル（区画・県ごとの AI・審判 AI）: 命令・外交・戦闘・地図の操作を偽の AI で確かめる。
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const src = fs.readFileSync(path.join(__dirname, 'mock-test.cjs'), 'utf8');
const MOCK = src.slice(src.indexOf('const MOCK = `') + 14, src.indexOf('`;\n\n(async'));
const OUT = path.resolve(process.argv[2] || '.');

// 偽の AI: 県の AI は「相手の 1.6 倍以上の兵がいる隣の区画」を攻め、届いた申し入れはすべて受ける
const FAKE = () => {
  const orig = window.claude.use;
  window.claude.use = async (n) => {
    const f = await orig(n);
    if (n !== 'sample' || !f) return f;
    const j = f.json;
    const g = async (...a) => f(...a);
    const plan = (text) => {
      const orders = [];
      for (const line of text.split('\n')) {
        const m = line.match(/^- ([a-z]+\d+)（.*?）兵(\d+)／.*?隣: (.*)$/);
        if (!m) continue;
        const t = +m[2];
        for (const nb of m[3].matchAll(/([a-z]+\d+)\(([^・)]+)・兵(\d+)/g)) {
          if (nb[2] !== '自' && t > +nb[3] * 1.6 + 1) { orders.push({ type: 'attack', from: m[1], to: nb[1], n: t - 1 }); break; }
        }
        if (orders.length >= 2) break;
      }
      const diplomacy = [...text.matchAll(/id:([a-z0-9]+)/g)].map((x) => ({ type: 'respond', id: x[1], accept: true, text: 'よかろう' }));
      return { orders, diplomacy };
    };
    g.json = async (input, opts) => {
      window.__calls.push({ input });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (input.startsWith('【勢力AI・まとめ】')) {
        await wait(150);
        const blocks = input.split('\n■').slice(1);
        return { factions: blocks.map((b) => ({ pref: b.slice(0, b.indexOf('（')), ...plan(b), statement: '' })) };
      }
      if (input.startsWith('【勢力AI】')) {
        await wait(120);
        const me = input.match(/、(.+?)の暫定政府/)[1];
        return { thought: '様子を見つつ隙を突く', ...plan(input), statement: me === '宮崎県' ? '宮崎は屈せんど' : '' };
      }
      if (input.startsWith('【審判】')) {
        await wait(150);
        return { verdicts: [{ no: 1, ok: true, mod: 0.1, reason: '山越えの奇襲' }], player: { outcome: input.includes('漁船') ? 'partial' : 'none', reason: '漁船は集まったが半分ほど', troops: [{ district: 'oita0', delta: 3 }], relations: [] }, notes: '全体に慎重な一週間。' };
      }
      if (input.startsWith('【戦況記者】')) { await wait(80); return { headline: '九州で戦端開く', story: '大分県が宮崎県に攻め込んだ。宮崎県の代表は「宮崎は屈せんど」と述べた。' }; }
      return j(input, opts);
    };
    return g;
  };
};

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext(devices['iPhone 13']);
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(FAKE);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + path.join(OUT, 'test.html'));
  await pg.waitForTimeout(600);
  const shot = (n) => pg.screenshot({ path: path.join(OUT, `pref_${n}.png`) });
  await pg.tap('[data-mode="pref"]'); await pg.waitForTimeout(200);
  await pg.selectOption('#f-pref', 'oita');
  await shot('1_setup');
  await pg.tap('#go'); await pg.waitForTimeout(500);
  await shot('2_intro');
  // 区画を押す（地図の座標 → 画面の座標）
  const tapD = async (id) => {
    const p = await pg.evaluate((id) => {
      const el = document.querySelector(`[data-d="${id}"]`);
      const svg = document.getElementById('wsvg');
      const bb = el.getBBox();
      for (let i = 0; i < 100; i++) {
        const x = bb.x + bb.width * (0.1 + 0.8 * (i % 10) / 10); const y = bb.y + bb.height * (0.1 + 0.8 * Math.floor(i / 10) / 10);
        const pt = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
        const hit = document.elementFromPoint(pt.x, pt.y);
        if (hit && hit.getAttribute('data-d') === id) return [pt.x, pt.y];
      }
      return null;
    }, id);
    if (!p) throw new Error('区画が画面に見えない: ' + id);
    await pg.touchscreen.tap(p[0], p[1]);
    await pg.waitForTimeout(200);
  };
  await pg.tap('#wclose'); await pg.waitForTimeout(150);
  await tapD('oita2');
  const selTitle = await pg.textContent('.wpb b');
  await pg.tap('[data-wt="miyazaki1"]'); await pg.waitForTimeout(150);
  await shot('3_order');
  await pg.tap('#wadd'); await pg.waitForTimeout(150);
  // 外交: 福岡に同盟を申し込む
  await pg.tap('[data-wtab="diplo"]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { const d = [...document.querySelectorAll('.frow')].find((x) => x.textContent.includes('福岡県')); d.open = true; });
  await pg.tap('[data-wp="fukuoka|alliance"]'); await pg.waitForTimeout(150);
  await shot('4_diplo');
  await pg.tap('[data-wtab="orders"]'); await pg.waitForTimeout(150);
  await pg.fill('#wnote', '港の漁船を集めて補給線を作る');
  const ordersShown = await pg.$$eval('.orow', (x) => x.map((e) => e.textContent));
  await shot('5_orders');
  await pg.tap('#wend');
  await pg.waitForTimeout(250);
  await shot('6_busy');
  await pg.waitForFunction(() => !document.querySelector('.wbusy'), null, { timeout: 15000 }); await pg.waitForTimeout(300);
  await shot('7_report');
  const report = await pg.$$eval('.wrep .evlist div', (x) => x.map((e) => e.textContent));
  const calls = await pg.evaluate(() => window.__calls.map((c) => c.input.slice(0, 12)));
  const st = await pg.evaluate(() => { const o = JSON.parse(localStorage.getItem('__fakedb')); const w = Object.values(o).find((v) => v.kind === 'world'); const P = w.pref; return { v: P.v, turn: w.turn, date: w.date, n: Object.keys(P.d).length, mine: Object.values(P.d).filter((d) => d.o === 'oita').length, miyazaki1: P.d.miyazaki1.o, alliances: P.alliances.map((a) => a.name), orders: P.orders.length, lastMoves: P.lastMoves.length }; });
  await pg.tap('#wclose'); await pg.waitForTimeout(150);
  await pg.tap('#zout'); await pg.tap('#zout'); await pg.waitForTimeout(150);
  await shot('8_mapfar');
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  // 会話（代表と話す）
  await pg.tap('[data-wtab="diplo"]'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { const d = [...document.querySelectorAll('.frow')].find((x) => x.textContent.includes('熊本県')); d.open = true; });
  await pg.tap('[data-wc="pf_kumamoto"]'); await pg.waitForTimeout(200);
  await pg.fill('#cmsg', '手を組まないか'); await pg.tap('#csend'); await pg.waitForTimeout(600);
  const chat = await pg.$$eval('.msg', (x) => x.map((e) => e.textContent));
  await shot('9_chat');
  console.log({ selTitle, ordersShown, report, calls, st, overflow, chat, errs });

  // PC: ホイールで拡大、ドラッグで移動
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx2.addInitScript(MOCK); await ctx2.addInitScript(FAKE);
  const p2 = await ctx2.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto('file://' + path.join(OUT, 'test.html')); await p2.waitForTimeout(500);
  await p2.click('[data-mode="pref"]'); await p2.selectOption('#f-pref', 'tokyo'); await p2.click('#go'); await p2.waitForTimeout(400);
  await p2.click('#wclose');
  const vb0 = await p2.getAttribute('#wsvg', 'viewBox');
  await p2.mouse.move(640, 400); await p2.mouse.wheel(0, -400); await p2.waitForTimeout(100);
  const vb1 = await p2.getAttribute('#wsvg', 'viewBox');
  await p2.mouse.move(640, 400); await p2.mouse.down(); await p2.mouse.move(500, 300, { steps: 5 }); await p2.mouse.up(); await p2.waitForTimeout(100);
  const vb2 = await p2.getAttribute('#wsvg', 'viewBox');
  const near = await p2.evaluate(() => document.getElementById('wsvg').classList.contains('znear'));
  await p2.screenshot({ path: path.join(OUT, 'pref_10_pc.png') });
  await p2.click('[data-wtab="rank"]'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: path.join(OUT, 'pref_11_pc_rank.png') });
  console.log({ vb0, vb1, vb2, near, errs2 });
  await b.close();
})();
