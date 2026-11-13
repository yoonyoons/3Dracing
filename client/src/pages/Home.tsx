import { navigate } from '../router';

export function Home() {
  return (
    <div className="page center">
      <div className="hero">
        <div className="hero-emoji">🏎️🎨</div>
        <h1>우리 반 드로잉 레이싱</h1>
        <p className="sub">내가 그린 자동차로 친구들과 달려 보자!</p>
      </div>
      <div className="menu">
        <button className="btn big primary" onClick={() => navigate('/play')}>
          🙋 레이스 참가하기
          <small>방 코드를 넣고 들어가요</small>
        </button>
        <button className="btn big yellow" onClick={() => navigate('/solo')}>
          🚗 혼자 연습하기
          <small>조종법을 익혀요</small>
        </button>
        <button className="btn big white" onClick={() => navigate('/host')}>
          👩‍🏫 선생님: 방 만들기
          <small>큰 화면에 띄워 주세요</small>
        </button>
      </div>
      <a className="tiny-link" href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }}>관리자</a>
    </div>
  );
}
