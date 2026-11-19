-- 드로잉 레이싱 (Vercel + Supabase 버전)
--
-- 구조
--   * 웹사이트는 Vercel 에서 정적 파일로만 서빙합니다. 서버 비밀키가 없습니다.
--   * 레이스는 교사 화면(브라우저)이 계산하고, 학생 기기와는 Supabase Realtime(Broadcast)으로 주고받습니다.
--   * 방·참가자·차 기록은 이 파일의 표에 저장하고, 브라우저는 아래 public.race_* 함수로만 접근합니다.
--     표는 API 로 노출되지 않는 race 스키마에 있고 RLS 가 켜져 있습니다.
--   * 개인정보: 별명, 방 코드, 그림만 저장합니다. 정해진 시간이 지나면 자동 삭제(pg_cron)합니다.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

-- 0001 에서 만든 서버용 표(비어 있음)는 이 구조로 대체합니다.
drop table if exists public.cars;

create schema if not exists race;
revoke all on schema race from public, anon, authenticated;

create table race.config (
  id int primary key default 1 check (id = 1),
  teacher_code_hash text not null,
  admin_pw_hash text not null,
  generator text not null default 'pregenerated' check (generator in ('pregenerated', 'mock')),
  retention_hours int not null default 24 check (retention_hours between 1 and 168)
);

create table race.fails (
  ip text not null,
  kind text not null,
  count int not null default 0,
  window_start timestamptz not null default now(),
  primary key (ip, kind)
);

create table race.rooms (
  code text primary key,
  host_hash text not null,
  created_at timestamptz not null default now(),
  last_active timestamptz not null default now()
);

create table race.players (
  room_code text not null references race.rooms(code) on delete cascade,
  pid text not null,
  chan_hash text not null,
  nickname text not null,
  primary key (room_code, pid)
);

create table race.cars (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  player_id text not null,
  nickname text not null,
  status text not null default 'drawing' check (status in ('drawing', 'processing', 'ready', 'failed')),
  version int not null default 1,
  glb_version int not null default 0,
  image bytea,
  clean bytea,
  glb bytea,
  hidden boolean not null default false,
  flip boolean not null default false,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_code, player_id),
  foreign key (room_code, player_id) references race.players(room_code, pid) on delete cascade
);
create index cars_created_at_idx on race.cars (created_at);

alter table race.config enable row level security;
alter table race.fails enable row level security;
alter table race.rooms enable row level security;
alter table race.players enable row level security;
alter table race.cars enable row level security;
revoke all on all tables in schema race from public, anon, authenticated;

-- ───────────── 내부 도우미 (브라우저에서 호출 불가) ─────────────

create function race.sha(t text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(t, ''), 'sha256'), 'hex')
$$;

create function race.b64(b bytea) returns text
language sql immutable set search_path = '' as $$
  select translate(encode(b, 'base64'), E'\n', '')
$$;

create function race.err(msg text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', msg)
$$;

create function race.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(split_part(
    coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), ''), '?')
$$;

-- 같은 곳에서 1분에 8번 넘게 틀리면 잠시 막습니다.
create function race.locked(p_kind text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from race.fails
    where ip = race.client_ip() and kind = p_kind and count >= 8 and window_start > now() - interval '1 minute'
  )
$$;

create function race.fail(p_kind text) returns void
language sql set search_path = '' as $$
  insert into race.fails (ip, kind, count, window_start) values (race.client_ip(), p_kind, 1, now())
  on conflict (ip, kind) do update set
    count = case when race.fails.window_start < now() - interval '1 minute' then 1 else race.fails.count + 1 end,
    window_start = case when race.fails.window_start < now() - interval '1 minute' then now() else race.fails.window_start end
$$;

create function race.admin_ok(p_pw text) returns boolean
language plpgsql set search_path = '' as $$
declare v text;
begin
  if race.locked('admin') then return false; end if;
  select admin_pw_hash into v from race.config where id = 1;
  if v is not null and extensions.crypt(coalesce(p_pw, ''), v) = v then return true; end if;
  perform race.fail('admin');
  return false;
end $$;

create function race.host_ok(p_code text, p_secret text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from race.rooms where code = p_code and host_hash = race.sha(p_secret))
$$;

create function race.player_ok(p_code text, p_pid text, p_chan text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from race.players where room_code = p_code and pid = p_pid and chan_hash = race.sha(p_chan))
$$;

create function race.cleanup() returns void
language plpgsql set search_path = '' as $$
declare h int;
begin
  select retention_hours into h from race.config where id = 1;
  delete from race.cars where created_at < now() - make_interval(hours => coalesce(h, 24));
  delete from race.rooms where last_active < now() - interval '4 hours';
  delete from race.fails where window_start < now() - interval '1 hour';
end $$;

revoke all on all functions in schema race from public, anon, authenticated;

-- ───────────── 교사(방 주인) ─────────────

create function public.race_create_room(p_teacher_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_code text; v_secret text; i int;
begin
  if race.locked('teacher') then return race.err('잠시 후 다시 시도해 주세요.'); end if;
  select teacher_code_hash into v_hash from race.config where id = 1;
  if v_hash is null or extensions.crypt(coalesce(p_teacher_code, ''), v_hash) <> v_hash then
    perform race.fail('teacher');
    return race.err('교사 코드가 달라요.');
  end if;
  perform race.cleanup();
  if (select count(*) from race.rooms) >= 30 then return race.err('지금은 방을 더 만들 수 없어요.'); end if;
  for i in 1..60 loop
    v_code := (1000 + floor(random() * 9000))::int::text;
    exit when not exists (select 1 from race.rooms where code = v_code);
  end loop;
  v_secret := encode(extensions.gen_random_bytes(16), 'hex');
  insert into race.rooms (code, host_hash) values (v_code, race.sha(v_secret));
  return jsonb_build_object('ok', true, 'code', v_code, 'hostSecret', v_secret);
end $$;

create function public.race_host_touch(p_code text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update race.rooms set last_active = now() where code = p_code and host_hash = race.sha(p_secret);
  if not found then return race.err('방을 찾을 수 없어요.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 방을 닫으면 참가자와 그림·3D 모델이 모두 지워집니다.
create function public.race_host_close(p_code text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from race.rooms where code = p_code and host_hash = race.sha(p_secret);
  return jsonb_build_object('ok', true);
end $$;

create function public.race_host_register(p_code text, p_secret text, p_pid text, p_chan text, p_nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.host_ok(p_code, p_secret) then return race.err('권한이 없어요.'); end if;
  if p_pid !~ '^[a-f0-9]{12}$' or p_chan !~ '^[a-f0-9]{32}$' or char_length(coalesce(p_nickname, '')) not between 1 and 12 then
    return race.err('잘못된 요청이에요.');
  end if;
  insert into race.players (room_code, pid, chan_hash, nickname) values (p_code, p_pid, race.sha(p_chan), p_nickname)
  on conflict (room_code, pid) do update set chan_hash = excluded.chan_hash, nickname = excluded.nickname;
  update race.cars set nickname = p_nickname where room_code = p_code and player_id = p_pid;
  update race.rooms set last_active = now() where code = p_code;
  return jsonb_build_object('ok', true);
end $$;

create function public.race_host_remove(p_code text, p_secret text, p_pid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.host_ok(p_code, p_secret) then return race.err('권한이 없어요.'); end if;
  delete from race.players where room_code = p_code and pid = p_pid;
  return jsonb_build_object('ok', true);
end $$;

create function public.race_host_hide(p_code text, p_secret text, p_pid text, p_hidden boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.host_ok(p_code, p_secret) then return race.err('권한이 없어요.'); end if;
  update race.cars set hidden = coalesce(p_hidden, false), updated_at = now() where room_code = p_code and player_id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 누구나 (방 코드를 아는 사람) ─────────────

create function public.race_room_exists(p_code text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'exists', exists (select 1 from race.rooms where code = p_code))
$$;

-- 방의 차 목록 (그림 파일은 빼고). 교사 화면이 몇 초마다 확인합니다.
create function public.race_room_cars(p_code text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'generator', (select generator from race.config where id = 1),
    'cars', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'playerId', c.player_id,
        'status', case when c.status = 'processing' and c.updated_at < now() - interval '3 minutes' then 'failed' else c.status end,
        'version', c.version, 'glbVersion', c.glb_version, 'hidden', c.hidden, 'flip', c.flip,
        'message', c.message, 'hasImage', c.image is not null, 'hasGlb', c.glb is not null))
      from race.cars c where c.room_code = p_code), '[]'::jsonb))
$$;

-- 그림(image) 또는 3D 모델(glb) 파일. 숨긴 차는 주지 않습니다.
create function public.race_car_file(p_id uuid, p_kind text) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'data',
      race.b64(case when c.hidden then null when p_kind = 'glb' then c.glb when p_kind = 'image' then c.image end))
    from race.cars c where c.id = p_id), race.err('없어요.'))
$$;

-- ───────────── 학생 (자기 비밀 채널 값으로 확인) ─────────────

create function public.race_player_upload(p_code text, p_pid text, p_chan text, p_image text, p_clean text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_mode text; v_nick text; v_last timestamptz; r record;
begin
  if not race.player_ok(p_code, p_pid, p_chan) then return race.err('다시 입장해 주세요.'); end if;
  if char_length(coalesce(p_image, '')) not between 100 and 1500000 or char_length(coalesce(p_clean, '')) not between 100 and 2000000 then
    return race.err('그림 파일이 너무 커요.');
  end if;
  select updated_at into v_last from race.cars where room_code = p_code and player_id = p_pid;
  if v_last is not null and v_last > now() - interval '3 seconds' then return race.err('조금만 기다렸다가 다시 올려 주세요.'); end if;
  select generator into v_mode from race.config where id = 1;
  select nickname into v_nick from race.players where room_code = p_code and pid = p_pid;
  insert into race.cars as c (room_code, player_id, nickname, status, image, clean)
  values (p_code, p_pid, v_nick, case when v_mode = 'mock' then 'processing' else 'drawing' end,
          decode(p_image, 'base64'), decode(p_clean, 'base64'))
  on conflict (room_code, player_id) do update set
    status = excluded.status, image = excluded.image, clean = excluded.clean, glb = null,
    version = c.version + 1, hidden = false, flip = false, message = null, created_at = now(), updated_at = now()
  returning c.id, c.version into r;
  update race.rooms set last_active = now() where code = p_code;
  return jsonb_build_object('ok', true, 'id', r.id, 'version', r.version, 'generator', v_mode);
end $$;

-- mock 모드: 학생 브라우저가 만든 샘플 3D 모델을 붙입니다.
create function public.race_player_glb(p_code text, p_pid text, p_chan text, p_version int, p_glb text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.player_ok(p_code, p_pid, p_chan) then return race.err('다시 입장해 주세요.'); end if;
  if (select generator from race.config where id = 1) <> 'mock' then return race.err('지금은 쓸 수 없어요.'); end if;
  if char_length(coalesce(p_glb, '')) not between 100 and 8000000 then return race.err('파일이 너무 커요.'); end if;
  update race.cars set glb = decode(p_glb, 'base64'), glb_version = glb_version + 1, status = 'ready', message = null, updated_at = now()
  where room_code = p_code and player_id = p_pid and version = p_version and status = 'processing';
  return jsonb_build_object('ok', true);
end $$;

create function public.race_player_flip(p_code text, p_pid text, p_chan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.player_ok(p_code, p_pid, p_chan) then return race.err('다시 입장해 주세요.'); end if;
  update race.cars set flip = not flip, updated_at = now() where room_code = p_code and player_id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

create function public.race_player_delete(p_code text, p_pid text, p_chan text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.player_ok(p_code, p_pid, p_chan) then return race.err('다시 입장해 주세요.'); end if;
  delete from race.cars where room_code = p_code and player_id = p_pid;
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── 관리자 (비밀번호) ─────────────

create function public.race_admin_list(p_pw text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  return jsonb_build_object(
    'ok', true,
    'generator', (select generator from race.config where id = 1),
    'retentionHours', (select retention_hours from race.config where id = 1),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'createdAt', r.created_at,
        'players', (select count(*) from race.players p where p.room_code = r.code)) order by r.created_at desc)
      from race.rooms r), '[]'::jsonb),
    'cars', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'roomCode', c.room_code, 'nickname', c.nickname, 'status', c.status, 'hidden', c.hidden,
        'flip', c.flip, 'message', c.message, 'createdAt', c.created_at, 'version', c.version,
        'glbVersion', c.glb_version, 'hasGlb', c.glb is not null) order by c.created_at desc)
      from race.cars c), '[]'::jsonb));
end $$;

create function public.race_admin_file(p_pw text, p_id uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v bytea;
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  select case p_kind when 'glb' then glb when 'clean' then clean else image end into v from race.cars where id = p_id;
  return jsonb_build_object('ok', true, 'data', race.b64(v));
end $$;

-- B 모드: 교사가 미리 만든 GLB (브라우저에서 크기·방향을 맞춘 뒤) 를 붙입니다.
create function public.race_admin_set_glb(p_pw text, p_id uuid, p_glb text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  if char_length(coalesce(p_glb, '')) not between 100 and 8000000 then return race.err('정리한 뒤에도 파일이 너무 커요 (6MB 이하).'); end if;
  update race.cars set glb = decode(p_glb, 'base64'), glb_version = glb_version + 1, status = 'ready', message = null, updated_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create function public.race_admin_update(p_pw text, p_id uuid, p_hidden boolean, p_flip boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  update race.cars set hidden = coalesce(p_hidden, hidden), flip = coalesce(p_flip, flip), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- p_id 를 주면 한 대, p_room 을 주면 그 방 전체, 둘 다 없으면 모든 차를 지웁니다.
create function public.race_admin_delete(p_pw text, p_id uuid, p_room text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  delete from race.cars
  where (p_id is not null and id = p_id)
     or (p_id is null and p_room is not null and room_code = p_room)
     or (p_id is null and p_room is null);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'removed', n);
end $$;

create function public.race_admin_settings(p_pw text, p_new_pw text, p_teacher_code text, p_generator text, p_retention int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not race.admin_ok(p_pw) then return race.err('비밀번호가 달라요.'); end if;
  if p_new_pw is not null and char_length(p_new_pw) < 6 then return race.err('관리자 비밀번호는 6글자 이상이에요.'); end if;
  if p_teacher_code is not null and char_length(p_teacher_code) < 4 then return race.err('교사 코드는 4글자 이상이에요.'); end if;
  if p_generator is not null and p_generator not in ('pregenerated', 'mock') then return race.err('잘못된 모드예요.'); end if;
  if p_retention is not null and p_retention not between 1 and 168 then return race.err('보관 시간은 1~168시간이에요.'); end if;
  update race.config set
    admin_pw_hash = case when p_new_pw is null then admin_pw_hash else extensions.crypt(p_new_pw, extensions.gen_salt('bf', 8)) end,
    teacher_code_hash = case when p_teacher_code is null then teacher_code_hash else extensions.crypt(p_teacher_code, extensions.gen_salt('bf', 8)) end,
    generator = coalesce(p_generator, generator),
    retention_hours = coalesce(p_retention, retention_hours)
  where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- 브라우저에서 부를 수 있는 함수만 열어 줍니다.
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'race\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- 보관 기간이 지난 그림·3D 모델과 오래된 방을 10분마다 지웁니다.
select cron.schedule('race-cleanup', '*/10 * * * *', 'select race.cleanup()');

-- 처음 교사 코드·관리자 비밀번호는 배포할 때 따로 넣습니다:
--   insert into race.config (teacher_code_hash, admin_pw_hash)
--   values (extensions.crypt('교사코드', extensions.gen_salt('bf', 8)), extensions.crypt('관리자비번', extensions.gen_salt('bf', 8)));
