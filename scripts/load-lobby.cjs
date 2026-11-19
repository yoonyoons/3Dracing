// 대기실 부하 시험: 교사 화면(브라우저) 1 + 가짜 학생 N명(Supabase Realtime 직접 연결).
// 교사 화면 프레임과 실시간 메시지 수를 잽니다.
// 사용법: 빌드 후 vite preview 를 4173 에 띄우고  E2E_TEACHER_CODE=<교사코드> node scripts/load-lobby.cjs [인원=30]
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const URL_ = 'https://jucuqdiihcyqpjbttovf.supabase.co', KEY = 'sb_publishable_ttavvygPFewC3BKrxTi7-A_dym6bGe9';
const N = Number(process.argv[2] || 30);
const hex = (n) => crypto.randomBytes(n).toString('hex');
const open = (sb, name, handlers) => new Promise((res, rej) => {
  const ch = sb.channel(name, { config: { broadcast: { self: false } } });
  for (const [ev, fn] of Object.entries(handlers)) ch.on('broadcast', { event: ev }, (m) => fn(m.payload));
  const t = setTimeout(() => rej(new Error('subscribe timeout ' + name)), 15000);
  ch.subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(t); res(ch); } });
});

(async () => {
  const b = await chromium.launch({ ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const host = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  host.on('pageerror', (e) => errs.push(e.message));
  await host.goto((process.env.E2E_BASE || 'http://localhost:4173') + '/host');
  await host.fill('input[placeholder="교사 코드"]', process.env.E2E_TEACHER_CODE);
  await host.click('text=방 만들기');
  await host.waitForSelector('.join-code', { timeout: 20000 });
  const code = (await host.textContent('.join-code')).trim();
  let received = 0, sent = 0;
  const players = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    const sb = createClient(URL_, KEY, { realtime: { params: { eventsPerSecond: 20 } } });
    const pid = hex(6), chan = hex(16);
    let welcomed;
    const ok = new Promise((r) => (welcomed = r));
    const mine = await open(sb, `p:${code}:${chan}`, { host: (m) => { received++; if (m.type === 'welcome') welcomed(); } });
    const lobby = await open(sb, `lobby:${code}`, { room: () => received++ });
    const join = await open(sb, `join:${code}`, {});
    sent++; await join.send({ type: 'broadcast', event: 'join', payload: { nonce: hex(4), name: '부하' + i, pid, chan } });
    await Promise.race([ok, new Promise((_, r) => setTimeout(() => r(new Error('no welcome ' + i)), 20000))]);
    sb.removeChannel(join);
    players.push({ sb, mine, lobby });
  }));
  console.log(`${N}명 입장: ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  await host.waitForFunction((n) => document.querySelectorAll('.player-chip:not(.off)').length === n, N, { timeout: 30000 });
  console.log('교사 화면에 모두 표시됨');
  // 학생들이 "살아 있어요"를 9초마다 보냄 (실제 앱과 같음)
  const hb = setInterval(() => players.forEach((p) => { sent++; p.mine.send({ type: 'broadcast', event: 'player', payload: { type: 'hello' } }); }), 9000);
  received = 0; sent = 0;
  const m0 = Date.now();
  const fps = await host.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; performance.now() - t < 20000 ? requestAnimationFrame(f) : r(+(n / 20).toFixed(1)); }; requestAnimationFrame(f); }));
  const secs = (Date.now() - m0) / 1000;
  clearInterval(hb);
  // 교사 화면이 보낸 메시지 1개는 받는 학생 수만큼 + 1 로 셉니다(Supabase 계산 방식).
  console.log(`교사 화면 대기실 fps(소프트웨어 렌더링): ${fps}`);
  console.log(`학생이 받은 메시지 ${received}개, 보낸 메시지 ${sent}개 / ${secs.toFixed(0)}초 → 대략 초당 ${((received + sent * 2) / secs).toFixed(1)}개 (무료 한도 100)`);
  await host.screenshot({ path: (process.env.E2E_OUT || require('os').tmpdir()) + '/load-lobby.png' });
  await host.click('text=방 닫기');
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of players) p.sb.removeAllChannels();
  console.log('errors', errs);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
