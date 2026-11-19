// 교실 흐름 전체 테스트 (실제 Supabase 사용). 사용법: 빌드 후 vite preview 를 4173 에 띄우고
//   E2E_TEACHER_CODE=<교사코드> node scripts/e2e.cjs
// 샌드박스처럼 프록시가 있으면 HTTPS_PROXY 로 브라우저 프록시를 씁니다.
const {chromium}=require('playwright');
const out=process.env.E2E_OUT || require('os').tmpdir(), BASE=process.env.E2E_BASE || 'http://localhost:4173', TEACHER=process.env.E2E_TEACHER_CODE;
if(!TEACHER){console.error('E2E_TEACHER_CODE 환경변수가 필요합니다');process.exit(2);}
(async()=>{
  const b=await chromium.launch({...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY, bypass:'localhost,127.0.0.1'}}:{}),args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
  const errs=[];
  const mk=async(vp)=>{const c=await b.newContext({viewport:vp});const p=await c.newPage();p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});p.on('dialog',d=>d.accept());return p};
  const t0=Date.now(); const T=()=>((Date.now()-t0)/1000).toFixed(1)+'s';
  const host=await mk({width:1280,height:720});
  await host.goto(BASE+'/host');
  await host.fill('input[placeholder="교사 코드"]','000000'); await host.click('text=방 만들기');
  await host.waitForFunction(()=>document.querySelector('.error')?.textContent.length>0);
  console.log(T(),'wrong teacher code →',await host.textContent('.error'));
  await host.fill('input[placeholder="교사 코드"]',TEACHER); await host.click('text=방 만들기');
  await host.waitForSelector('.join-code',{timeout:20000});
  const code=(await host.textContent('.join-code')).trim();
  console.log(T(),'room',code,'url',await host.textContent('.join-url'));
  const players=[];
  for(const name of ['번개','구름','바람']){
    const p=await mk({width:420,height:860});
    await p.goto(BASE+'/play?code='+code);
    await p.fill('input[placeholder^="예"]',name);
    await p.click('button:has-text("들어가기!")');
    await p.waitForSelector('.mycar',{timeout:20000});
    players.push(p);
  }
  console.log(T(),'3 players joined');
  await host.waitForFunction(()=>document.querySelectorAll('.player-chip:not(.off)').length===3,{timeout:15000});
  console.log(T(),'host sees 3 online');
  await players[0].setInputFiles('.mycar input[type=file]',require('path').join(__dirname,'fixtures','car.png'));
  await players[0].waitForSelector('text=내 그림이 자동차가 됐어요',{timeout:20000});
  console.log(T(),'drawing uploaded');
  await host.waitForFunction(()=>[...document.querySelectorAll('.player-chip')].some(e=>e.textContent.includes('🎨')),{timeout:15000});
  console.log(T(),'host sees drawing car');
  // 학생 새로고침 → 같은 별명으로 이어짐
  await players[1].reload();
  await players[1].waitForSelector('.mycar',{timeout:20000});
  console.log(T(),'player reload resumed as',await players[1].textContent('.me-name'));
  await host.waitForTimeout(1500);
  await host.screenshot({path:out+'/v-host-lobby.png'});
  await players[0].screenshot({path:out+'/v-play-lobby.png'});
  await host.click('.btn.chip:has-text("2")');
  await host.click('text=레이스 시작!');
  await players[0].waitForSelector('.race-wrap',{timeout:10000});
  console.log(T(),'players in race view');
  await host.waitForTimeout(4800);
  for(const p of players) await p.keyboard.down('ArrowUp');
  await host.waitForTimeout(3000);
  // 레이스 중 한 학생의 인터넷이 5초 끊겼다가 돌아옴
  await players[1].context().setOffline(true);
  await host.waitForTimeout(5000);
  await players[1].context().setOffline(false);
  await players[1].waitForSelector('.race-wrap',{timeout:15000});
  console.log(T(),'offline 5s → still in race view');
  // 레이스 중 다른 학생이 새로고침
  await players[2].reload();
  await players[2].waitForSelector('.race-wrap',{timeout:20000});
  await players[2].keyboard.down('ArrowUp');
  const before=await players[2].evaluate(()=>document.querySelector('.hud')?.textContent||'');
  await host.waitForTimeout(3000);
  const after=await players[2].evaluate(()=>document.querySelector('.hud')?.textContent||'');
  console.log(T(),'reload mid-race → back in race view; HUD', before.slice(0,24),'→',after.slice(0,24));
  await players[0].keyboard.down('ArrowLeft'); await host.waitForTimeout(120); await players[0].keyboard.up('ArrowLeft');
  await host.screenshot({path:out+'/v-host-race.png'});
  await players[0].screenshot({path:out+'/v-play-race.png'});
  const lb=await host.textContent('.leaderboard'); console.log(T(),'leaderboard',lb);
  await host.waitForSelector('.card.result',{timeout:120000});
  const res=await host.textContent('.rank-list');
  console.log(T(),'results:',res);
  if((res.match(/완주 못 함/g)||[]).length) throw new Error('완주 못 한 학생이 있음: '+res);
  await players[2].waitForSelector('.status-card',{timeout:10000});
  console.log(T(),'player after race:',await players[2].textContent('.status-card'));
  // 교사 화면 새로고침 → 방 이어짐
  await host.reload();
  await host.waitForSelector('.card.result, .join-code',{timeout:20000});
  await host.click('text=시상대 보기');
  await host.waitForSelector('.podium-card',{timeout:10000});
  await host.waitForTimeout(1500);
  await host.screenshot({path:out+'/v-host-podium.png'});
  await host.click('text=새 레이스 준비');
  await host.waitForSelector('.join-code');
  await host.click('.player-chip:has-text("바람") .kick[title="내보내기"]');
  await players[2].waitForSelector('text=선생님이 내보냈어요',{timeout:10000});
  console.log(T(),'kick works');
  await host.click('text=방 닫기');
  await players[0].waitForSelector('text=방이 닫혔어요',{timeout:10000});
  console.log(T(),'close works');
  console.log('errors',errs); if(errs.length) process.exit(1);
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
