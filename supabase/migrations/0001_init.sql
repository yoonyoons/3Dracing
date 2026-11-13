-- 드로잉 레이싱: 차량 기록 테이블과 비공개 저장소 버킷
-- 학생 개인정보는 저장하지 않습니다(별명과 방 코드만).

create table if not exists public.cars (
  id text primary key,
  room_code text not null,
  player_id text not null,
  nickname text not null,
  status text not null,
  image_key text,
  clean_key text,
  glb_key text,
  hidden boolean not null default false,
  glb_flip boolean not null default false,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists cars_room_code_idx on public.cars (room_code);
create index if not exists cars_created_at_idx on public.cars (created_at);

-- RLS 를 켜고 정책을 만들지 않습니다 → 서버의 service 키로만 접근할 수 있습니다.
alter table public.cars enable row level security;
revoke all on table public.cars from anon, authenticated;

-- 비공개 버킷: 브라우저는 직접 접근하지 못하고, 서버가 대신 읽어서 전달합니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('race-assets', 'race-assets', false, 20971520, array['image/png', 'model/gltf-binary'])
on conflict (id) do nothing;
