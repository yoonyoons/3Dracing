// 레이스 화면 성능 측정 (연습 모드, 봇 3대 + 나). CPU 를 느리게 해서 저사양 크롬북을 흉내 냅니다.
// 사용법: 빌드 후 vite preview 를 4173 에 띄우고  node scripts/perf.cjs [CPU배율=4]
const { chromium } = require('playwright');
const rate = Number(process.argv[2] || 4);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const vp of [{ width: 1366, height: 768, name: '크롬북' }, { width: 844, height: 390, name: '폰 가로' }]) {
    const p = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
    const cdp = await p.context().newCDPSession(p);
    await p.goto((process.env.E2E_BASE || 'http://localhost:4173') + '/solo');
    await p.click('text=1바퀴');
    await p.click('text=출발하기!');
    await p.waitForTimeout(4000);
    await p.keyboard.down('ArrowUp');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    // 해상도 자동 조절이 자리를 잡을 때까지 기다립니다.
    await p.waitForTimeout(8000);
    const fps = await p.evaluate(() => new Promise((r) => {
      let n = 0; const t = performance.now(); const ts = [];
      let last = t;
      const f = () => { const now = performance.now(); ts.push(now - last); last = now; n++;
        if (now - t < 4000) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); r({ fps: +(n / ((now - t) / 1000)).toFixed(1), p95ms: +ts[Math.floor(ts.length * 0.95)].toFixed(1) }); } };
      requestAnimationFrame(f);
    }));
    console.log(`${vp.name} ${vp.width}x${vp.height} CPU x${rate}:`, fps);
    await p.close();
  }
  await b.close();
})();
