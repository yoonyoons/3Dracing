import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../router';

interface AdminCar {
  id: string;
  roomCode: string;
  nickname: string;
  status: string;
  hidden: boolean;
  message: string | null;
  createdAt: number;
  imageUrl: string | null;
  cleanUrl: string | null;
  glbUrl: string | null;
  roomOpen: boolean;
}
interface AdminData {
  cars: AdminCar[];
  generator: string;
  realtime: boolean;
  storage: string;
  retentionHours: number;
  rooms: { code: string; players: number; phase: string }[];
}

const PW_KEY = 'racing.admin';
const STATUS: Record<string, string> = {
  none: '그림 없음', drawing: '🎨 그림 차', processing: '⏳ 3D 변환 중', ready: '✨ 3D 완성', failed: '⚠️ 변환 실패(그림 차)',
};

export function Admin() {
  const [pw, setPw] = useState(() => sessionStorage.getItem(PW_KEY) ?? '');
  const [input, setInput] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [msg, setMsg] = useState('');
  const bulk = useRef<HTMLInputElement>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api/admin/${path}`, { ...init, headers: { ...(init.headers ?? {}), 'x-admin-password': pw } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStorage.removeItem(PW_KEY);
      setPw('');
      setData(null);
    }
    if (!res.ok) throw new Error(body.error ?? '요청에 실패했어요.');
    return body;
  }, [pw]);

  const refresh = useCallback(async () => {
    if (!pw) return;
    try { setData(await api('cars')); } catch (e) { setMsg((e as Error).message); }
  }, [api, pw]);

  useEffect(() => {
    document.title = '관리자 · 드로잉 레이싱';
    void refresh();
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setMsg((e as Error).message); }
    await refresh();
  };

  const uploadGlb = (id: string, file: File) =>
    api(`cars/${id}/glb`, { method: 'POST', body: file, headers: { 'Content-Type': 'model/gltf-binary' } });

  // 파일 이름이 "별명.glb" 이면 같은 별명의 차에 자동으로 짝지어 올립니다.
  const bulkUpload = async (files: FileList | null) => {
    if (!files || !data) return;
    let ok = 0;
    const missed: string[] = [];
    for (const f of Array.from(files)) {
      // macOS 는 한글 파일 이름을 자모로 풀어 저장하므로(NFD) 합쳐서(NFC) 비교합니다.
      const name = f.name.normalize('NFC').replace(/\.glb$/i, '').trim().toLowerCase();
      const car = data.cars.find((c) => c.nickname.normalize('NFC').toLowerCase() === name);
      if (!car) { missed.push(f.name); continue; }
      try { await uploadGlb(car.id, f); ok++; } catch { missed.push(f.name); }
    }
    setMsg(`${ok}개 올렸어요.${missed.length ? ` 짝을 못 찾은 파일: ${missed.join(', ')}` : ''}`);
    if (bulk.current) bulk.current.value = '';
    await refresh();
  };

  if (!pw || !data) {
    return (
      <div className="page center">
        <h1>🔒 관리자</h1>
        <p className="sub">서버를 켠 창(터미널)에 나온 관리자 비밀번호를 넣어 주세요.</p>
        <form className="card join-form" onSubmit={(e) => { e.preventDefault(); sessionStorage.setItem(PW_KEY, input); setMsg(''); setPw(input); }}>
          <input className="field" type="password" autoComplete="off" placeholder="비밀번호" value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="error">{msg}</div>
          <button className="btn primary">들어가기</button>
        </form>
        <button className="btn white small" onClick={() => navigate('/')}>← 처음으로</button>
      </div>
    );
  }

  const roomCodes = [...new Set(data.cars.map((c) => c.roomCode))];
  return (
    <div className="page admin">
      <div className="host-head wide">
        <h2>🛠 관리자 <small>차 {data.cars.length}대</small></h2>
        <div className="row">
          <button className="btn small white" onClick={() => navigate('/host')}>선생님 화면</button>
          <button className="btn small white" onClick={() => { sessionStorage.removeItem(PW_KEY); setPw(''); setData(null); }}>잠그기</button>
        </div>
      </div>

      <div className="card admin-info">
        <div>
          <b>3D 변환 모드:</b>{' '}
          {data.realtime ? `실시간 (${data.generator})` : '사전 생성(B 모드) — 아래에서 GLB 를 올려 주세요'}
          {' · '}<b>저장소:</b> {data.storage === 'supabase' ? 'Supabase Storage' : '이 컴퓨터'}
          {' · '}<b>자동 삭제:</b> {data.retentionHours}시간 뒤
        </div>
        {!data.realtime && (
          <ol className="admin-steps">
            <li>학생이 그림을 올리면 아래 목록에 나타납니다. <b>그림 받기</b>로 정리된 그림(흰 배경 PNG)을 내려받으세요.</li>
            <li>Higgsfield 에서 그 그림으로 3D 모델(GLB)을 만듭니다.</li>
            <li><b>GLB 올리기</b>로 짝지어 올리면 크기·방향을 자동으로 맞춰 학생 차에 바로 적용됩니다. 파일 이름을 <code>별명.glb</code>로 해 두면 <b>여러 개 한꺼번에</b> 올릴 수 있어요.</li>
          </ol>
        )}
        <div className="row left">
          <input ref={bulk} type="file" accept=".glb,model/gltf-binary" multiple hidden onChange={(e) => bulkUpload(e.target.files)} />
          <button className="btn small yellow" onClick={() => bulk.current?.click()}>📦 GLB 여러 개 올리기 (별명.glb)</button>
          {roomCodes.map((code) => (
            <button key={code} className="btn small danger" onClick={() => {
              if (window.confirm(`방 ${code}의 그림과 3D 모델을 모두 삭제할까요?`)) void act(() => api(`cars?room=${code}`, { method: 'DELETE' }), '삭제했어요.');
            }}>방 {code} 모두 삭제</button>
          ))}
          <button className="btn small danger" disabled={data.cars.length === 0} onClick={() => {
            if (window.confirm('모든 그림과 3D 모델을 삭제할까요? 되돌릴 수 없어요.')) void act(() => api('cars', { method: 'DELETE' }), '모두 삭제했어요.');
          }}>🗑 수업 끝! 전체 삭제</button>
        </div>
        <div className="error">{msg}</div>
      </div>

      {data.cars.length === 0 && <div className="empty">아직 올라온 그림이 없어요.</div>}
      <div className="admin-grid">
        {data.cars.map((c) => (
          <div key={c.id} className={`card admin-car ${c.hidden ? 'hidden-car' : ''}`}>
            <div className="thumb">{c.imageUrl ? <img src={c.imageUrl} alt={`${c.nickname}의 그림`} /> : '🚗'}</div>
            <div className="admin-car-name"><b>{c.nickname}</b> <small>방 {c.roomCode}{c.roomOpen ? '' : ' (닫힘)'}</small></div>
            <div className="admin-car-status">{c.hidden ? '🙈 숨김 · ' : ''}{STATUS[c.status] ?? c.status}</div>
            <div className="row left">
              <button className="btn small white" onClick={() => act(() => api(`cars/${c.id}/hide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: !c.hidden }) }))}>
                {c.hidden ? '👁 보이기' : '🙈 숨기기'}
              </button>
              <button className="btn small white" onClick={() => act(() => api(`cars/${c.id}/flip`, { method: 'POST' }))}>↔ 앞뒤</button>
              {c.cleanUrl && <a className="btn small white" href={c.cleanUrl} download={`${c.nickname}.png`}>⬇ 그림 받기</a>}
              <label className="btn small yellow">
                ⬆ GLB 올리기
                <input type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void act(() => uploadGlb(c.id, f), `${c.nickname}의 3D 모델을 올렸어요.`);
                  e.target.value = '';
                }} />
              </label>
              <button className="btn small danger" onClick={() => { if (window.confirm(`${c.nickname}의 그림을 삭제할까요?`)) void act(() => api(`cars/${c.id}`, { method: 'DELETE' })); }}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
