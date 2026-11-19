import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { b64ToBytes, bytesToB64, rpc } from '../net/supabase';

interface AdminCar {
  id: string;
  roomCode: string;
  nickname: string;
  status: string;
  hidden: boolean;
  flip: boolean;
  message: string | null;
  createdAt: string;
  version: number;
  glbVersion: number;
  hasGlb: boolean;
}
interface AdminData {
  generator: 'pregenerated' | 'mock';
  retentionHours: number;
  rooms: { code: string; players: number; createdAt: string }[];
  cars: AdminCar[];
}

const PW_KEY = 'racing.admin';
const STATUS: Record<string, string> = {
  none: '그림 없음', drawing: '🎨 그림 차', processing: '⏳ 3D 변환 중', ready: '✨ 3D 완성', failed: '⚠️ 변환 실패(그림 차)',
};

function readPw(): string {
  try { return sessionStorage.getItem(PW_KEY) ?? ''; } catch { return ''; }
}
function writePw(v: string | null): void {
  try { if (v) sessionStorage.setItem(PW_KEY, v); else sessionStorage.removeItem(PW_KEY); } catch { /* 무시 */ }
}

const thumbs = new Map<string, Promise<string | null>>();

function Thumb({ pw, car }: { pw: string; car: AdminCar }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const key = `${car.id}:${car.version}`;
    let p = thumbs.get(key);
    if (!p) {
      p = rpc<{ data: string | null }>('race_admin_file', { p_pw: pw, p_id: car.id, p_kind: 'image' })
        .then(({ data }) => (data ? URL.createObjectURL(new Blob([b64ToBytes(data) as BlobPart], { type: 'image/png' })) : null))
        .catch(() => null);
      thumbs.set(key, p);
    }
    let alive = true;
    p.then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [pw, car.id, car.version]);
  return (
    <div className="thumb">
      {url ? <img src={url} alt={`${car.nickname}의 그림`} style={car.flip ? { transform: 'scaleX(-1)' } : undefined} /> : '🚗'}
    </div>
  );
}

function download(bytes: Uint8Array, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 5000);
}

export function Admin() {
  const [pw, setPw] = useState(readPw);
  const [input, setInput] = useState('');
  const [data, setData] = useState<AdminData | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const bulk = useRef<HTMLInputElement>(null);

  const call = useCallback(async <T,>(fn: string, args: Record<string, unknown> = {}) => {
    try {
      return await rpc<T>(fn, { p_pw: pw, ...args });
    } catch (e) {
      if ((e as Error).message.includes('비밀번호')) {
        writePw(null);
        setPw('');
        setData(null);
      }
      throw e;
    }
  }, [pw]);

  const refresh = useCallback(async () => {
    if (!pw) return;
    try { setData(await call<AdminData>('race_admin_list')); } catch (e) { setMsg((e as Error).message); }
  }, [call, pw]);

  useEffect(() => {
    document.title = '관리자 · 드로잉 레이싱';
    void refresh();
    const t = window.setInterval(refresh, 6000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setMsg('');
    try { await fn(); if (done) setMsg(done); } catch (e) { setMsg((e as Error).message); }
    await refresh();
  };

  /** 교사가 올린 GLB: 이 브라우저에서 크기·방향을 맞추고 가볍게 만든 뒤 저장합니다. */
  const uploadGlb = async (car: AdminCar, file: File) => {
    setBusy(`${car.nickname}의 3D 모델을 정리하는 중…`);
    try {
      const { normalizeGlbFile } = await import('../lib/glbBrowser');
      const { glb, stats } = await normalizeGlbFile(file);
      await call('race_admin_set_glb', { p_id: car.id, p_glb: await bytesToB64(glb) });
      return `${car.nickname}: ${(stats.bytesIn / 1048576).toFixed(1)}MB → ${(stats.bytesOut / 1048576).toFixed(1)}MB, 삼각형 ${stats.trianglesIn.toLocaleString()} → ${stats.trianglesOut.toLocaleString()}`;
    } finally {
      setBusy('');
    }
  };

  // 파일 이름이 "별명.glb" 이면 같은 별명의 차에 자동으로 짝지어 올립니다.
  const bulkUpload = async (files: FileList | null) => {
    if (!files || !data) return;
    const done: string[] = [];
    const missed: string[] = [];
    for (const f of Array.from(files)) {
      // macOS 는 한글 파일 이름을 자모로 풀어 저장하므로(NFD) 합쳐서(NFC) 비교합니다.
      const name = f.name.normalize('NFC').replace(/\.glb$/i, '').trim().toLowerCase();
      const car = data.cars.find((c) => c.nickname.normalize('NFC').toLowerCase() === name);
      if (!car) { missed.push(f.name); continue; }
      try { done.push(await uploadGlb(car, f)); } catch (e) { missed.push(`${f.name} (${(e as Error).message})`); }
    }
    setMsg(`${done.length}개 올렸어요.${missed.length ? ` 못 올린 파일: ${missed.join(', ')}` : ''}`);
    if (bulk.current) bulk.current.value = '';
    await refresh();
  };

  if (!pw || !data) {
    return (
      <div className="page center">
        <h1>🔒 관리자</h1>
        <p className="sub">관리자 비밀번호를 넣어 주세요.</p>
        <form className="card join-form" onSubmit={(e) => { e.preventDefault(); writePw(input); setMsg(''); setPw(input); }}>
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
        <h2>🛠 관리자 <small>차 {data.cars.length}대 · 열린 방 {data.rooms.length}개</small></h2>
        <div className="row">
          <button className="btn small white" onClick={() => navigate('/host')}>선생님 화면</button>
          <button className="btn small white" onClick={() => { writePw(null); setPw(''); setData(null); }}>잠그기</button>
        </div>
      </div>

      <div className="card admin-info">
        <div>
          <b>3D 변환 모드:</b> {data.generator === 'mock' ? '연습용 샘플 3D (mock)' : '사전 생성(B 모드) — 아래에서 GLB 를 올려 주세요'}
          {' · '}<b>저장소:</b> Supabase{' · '}<b>자동 삭제:</b> {data.retentionHours}시간 뒤
        </div>
        {data.generator === 'pregenerated' && (
          <ol className="admin-steps">
            <li>학생이 그림을 올리면 아래 목록에 나타납니다. <b>그림 받기</b>로 정리된 그림(흰 배경 PNG)을 내려받으세요.</li>
            <li>Higgsfield 에서 그 그림으로 3D 모델(GLB)을 만듭니다.</li>
            <li><b>GLB 올리기</b>로 짝지어 올리면 이 브라우저에서 크기·방향을 맞추고 가볍게 만들어 학생 차에 바로 적용합니다. 파일 이름을 <code>별명.glb</code>로 해 두면 <b>여러 개 한꺼번에</b> 올릴 수 있어요.</li>
          </ol>
        )}
        <div className="row left">
          <input ref={bulk} type="file" accept=".glb,model/gltf-binary" multiple hidden onChange={(e) => void bulkUpload(e.target.files)} />
          <button className="btn small yellow" disabled={!!busy} onClick={() => bulk.current?.click()}>📦 GLB 여러 개 올리기 (별명.glb)</button>
          {roomCodes.map((code) => (
            <button key={code} className="btn small danger" onClick={() => {
              if (window.confirm(`방 ${code}의 그림과 3D 모델을 모두 삭제할까요?`)) void act(() => call('race_admin_delete', { p_id: null, p_room: code }), '삭제했어요.');
            }}>방 {code} 모두 삭제</button>
          ))}
          <button className="btn small danger" disabled={data.cars.length === 0} onClick={() => {
            if (window.confirm('모든 그림과 3D 모델을 삭제할까요? 되돌릴 수 없어요.')) void act(() => call('race_admin_delete', { p_id: null, p_room: null }), '모두 삭제했어요.');
          }}>🗑 수업 끝! 전체 삭제</button>
        </div>
        {busy && <div className="notice-line">⏳ {busy}</div>}
        <div className="error">{msg}</div>
      </div>

      {data.cars.length === 0 && <div className="empty">아직 올라온 그림이 없어요.</div>}
      <div className="admin-grid">
        {data.cars.map((c) => (
          <div key={c.id} className={`card admin-car ${c.hidden ? 'hidden-car' : ''}`}>
            <Thumb pw={pw} car={c} />
            <div className="admin-car-name"><b>{c.nickname}</b> <small>방 {c.roomCode}</small></div>
            <div className="admin-car-status">{c.hidden ? '🙈 숨김 · ' : ''}{STATUS[c.status] ?? c.status}{c.flip ? ' · ↔ 뒤집음' : ''}</div>
            <div className="row left">
              <button className="btn small white" onClick={() => act(() => call('race_admin_update', { p_id: c.id, p_hidden: !c.hidden, p_flip: null }))}>
                {c.hidden ? '👁 보이기' : '🙈 숨기기'}
              </button>
              <button className="btn small white" onClick={() => act(() => call('race_admin_update', { p_id: c.id, p_hidden: null, p_flip: !c.flip }))}>↔ 앞뒤</button>
              <button className="btn small white" onClick={() => act(async () => {
                const { data: b64 } = await call<{ data: string | null }>('race_admin_file', { p_id: c.id, p_kind: 'clean' });
                if (!b64) throw new Error('그림이 없어요.');
                download(b64ToBytes(b64), `${c.nickname}.png`, 'image/png');
              })}>⬇ 그림 받기</button>
              <label className="btn small yellow">
                ⬆ GLB 올리기
                <input type="file" accept=".glb,model/gltf-binary" hidden disabled={!!busy} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void act(() => uploadGlb(c, f).then((m) => setMsg(m)));
                  e.target.value = '';
                }} />
              </label>
              <button className="btn small danger" onClick={() => { if (window.confirm(`${c.nickname}의 그림을 삭제할까요?`)) void act(() => call('race_admin_delete', { p_id: c.id, p_room: null })); }}>삭제</button>
            </div>
          </div>
        ))}
      </div>

      <Settings data={data} call={call} onDone={(m, newPw) => { if (newPw) { writePw(newPw); setPw(newPw); } setMsg(m); void refresh(); }} />
    </div>
  );
}

function Settings({ data, call, onDone }: {
  data: AdminData;
  call: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  onDone: (msg: string, newPw?: string) => void;
}) {
  const [teacher, setTeacher] = useState('');
  const [newPw, setNewPw] = useState('');
  const [mode, setMode] = useState(data.generator);
  const [hours, setHours] = useState(data.retentionHours);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    try {
      await call('race_admin_settings', {
        p_new_pw: newPw || null, p_teacher_code: teacher || null, p_generator: mode, p_retention: hours,
      });
      setTeacher('');
      setNewPw('');
      onDone('설정을 저장했어요.', newPw || undefined);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <details className="card settings-card">
      <summary><b>⚙️ 설정</b> (교사 코드·관리자 비밀번호·3D 모드·보관 시간)</summary>
      <div className="settings-grid">
        <label>새 교사 코드 <small>(방 만들 때 입력, 4글자 이상)</small>
          <input className="field small" type="password" autoComplete="new-password" value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="바꾸지 않으려면 비워 두기" />
        </label>
        <label>새 관리자 비밀번호 <small>(6글자 이상)</small>
          <input className="field small" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="바꾸지 않으려면 비워 두기" />
        </label>
        <label>3D 변환 모드
          <select className="field small" value={mode} onChange={(e) => setMode(e.target.value as AdminData['generator'])}>
            <option value="pregenerated">사전 생성 (교사가 GLB 올리기)</option>
            <option value="mock">연습용 샘플 3D (mock)</option>
          </select>
        </label>
        <label>자동 삭제까지 (시간)
          <input className="field small" type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </label>
      </div>
      <div className="error">{err}</div>
      <button className="btn primary small" onClick={() => void save()}>저장</button>
    </details>
  );
}
