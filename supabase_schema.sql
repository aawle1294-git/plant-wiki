-- Plant!p — Supabase 원격 클라우드 스키마 (Supabase 대시보드 → SQL Editor에서 실행)
-- 사용자가 식물을 검색할 때마다 plant_history에 Insert되고,
-- [📚 나의 도감 보기]는 auth.uid() 기준으로 본인 데이터만 Select합니다.

create table if not exists public.plant_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plant_name text not null,
  scientific_name text,
  true_percent integer,
  false_percent integer,
  emoji text,
  created_at timestamptz not null default now()
);

-- Row Level Security: 로그인 유저 본인 데이터만 조회/삽입/삭제 가능
alter table public.plant_history enable row level security;

create policy "plant_history: select own" on public.plant_history
  for select using (auth.uid() = user_id);

create policy "plant_history: insert own" on public.plant_history
  for insert with check (auth.uid() = user_id);

create policy "plant_history: delete own" on public.plant_history
  for delete using (auth.uid() = user_id);

-- plant_directory: 검색 시 1차 조회되는 마스터 테이블 (초정밀 딥링크 구매 URL + 검증된 상식)
create table if not exists public.plant_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  scientific_name text,
  myth text,
  verdict boolean,
  true_percent integer,
  false_percent integer,
  belief_summary text,
  purchase_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plant_directory enable row level security;

create policy "plant_directory: read all" on public.plant_directory
  for select using (true);

insert into public.plant_directory
  (name, scientific_name, myth, verdict, true_percent, false_percent, belief_summary, purchase_url) values
  ('토마토', 'Solanum lycopersicum', '토마토는 물을 많이 줄수록 열매가 커진다!', false, 30, 70, 'AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 열과(열매 터짐)와 당도 저하가 생깁니다. 겉흙이 마른 뒤 규칙적으로 주는 게 좋아요.', 'https://www.coupang.com/vp/products/101906272?itemId=23627156646&vendorItemId=92799712096&pickType=COU_PICK&q=%ED%86%A0%EB%A7%88%ED%86%A0+%EC%94%A8&searchId=0d919992173697&sourceType=search&itemsCount=60&searchRank=1&rank=1&traceId=msvpf95n'),
  ('방울토마토', 'Solanum lycopersicum var. cerasiforme', '방울토마토는 물을 매일 듬뿍 주어야 잘 자란다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 뿌리가 썩고 열매가 터질 수 있으니 겉흙이 마른 뒤에 듬뿍 주는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1013554&recmYn=N'),
  ('적치콘', 'Cichorium intybus var. foliosum', '적치콘은 어두운 곳에서 재배해야 붉은빛이 선명해진다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 트레비소 특유의 붉은색은 저온과 충분한 광량에서 발현됩니다. 차광은 잎을 연하게 만들 뿐입니다.', 'https://asiaseedmall.com'),
  ('트레비소', 'Cichorium intybus var. foliosum', '트레비소는 고온에서 키워야 붉은색이 진해진다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 트레비소의 붉은색은 저온과 충분한 광량에서 발현됩니다. 고온에서는 오히려 초록빛이 강해집니다.', 'https://asiaseedmall.com'),
  ('적상추', 'Lactuca sativa', '상추는 햇빛이 안 드는 서늘한 그늘에서만 키워야 한다!', false, 15, 85, 'AI 분석 결과: 이 상식은 사실이 아니에요! 광량이 부족하면 줄기만 길게 자라 잎이 연약해집니다. 하루 4시간 이상 햇빛이 필요해요.', 'https://www.asiaseedmall.com/goods/goods_view.php?goodsNo=1000002047'),
  ('비트', 'Beta vulgaris', '비트는 물을 많이 줄수록 뿌리가 더 크고 빨개진다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 뿌리가 물러지고 당도가 떨어집니다. 겉흙이 마른 뒤에 규칙적으로 주는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=56015&recmYn=N'),
  ('부추', 'Allium tuberosum', '부추는 자주 베어내면 뿌리가 죽어 다시 자라지 않는다!', false, 15, 85, 'AI 분석 결과: 이 상식은 사실이 아니에요! 부추는 수확할수록 새순이 왕성하게 자라는 다년생 작물입니다. 오히려 자주 수확하는 게 품질 유지에 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43127&recmYn=N'),
  ('코스모스', 'Cosmos bipinnatus', '코스모스는 비옥한 땅에서만 꽃이 핀다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 코스모스는 오히려 메마르고 척박한 땅에서 꽃이 더 풍성하게 핍니다. 비료가 과하면 줄기만 자라고 꽃이 적어요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=47910&recmYn=N'),
  ('열무', 'Raphanus sativus var. hortensis', '열무는 잎을 많이 따면 뿌리가 더 굵어진다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 잎을 과하게 따면 광합성이 줄어 오히려 뿌리가 작아집니다. 속잎만 조금씩 따는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43129&recmYn=N'),
  ('봉선화', 'Impatiens balsamina', '봉선화는 꽃이 지면 다시는 꽃이 피지 않는다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 꽃을 꾸준히 따주면 계속해서 새로운 꽃이 핍니다. 시든 꽃을 제거하면 개화 기간이 길어져요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43134&recmYn=N'),
  ('당근', 'Daucus carota', '당근은 씨를 뿌린 뒤 가는 게 좋아 솎아주면 안 된다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 솎아주지 않으면 뿌리가 서로 경쟁해 작고 기형이 됩니다. 적정 간격으로 솎는 게 굵은 당근의 핵심이에요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=57782&recmYn=N'),
  ('시금치', 'Spinacia oleracea', '시금치는 여름에 심어야 더 잘 자란다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 시금치는 서늘한 기후를 좋아하는 내한성 작물로, 고온에서는 꽃대가 올라가 잎이 억세집니다. 봄·가을 재배가 적합해요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43130&recmYn=N'),
  ('알타리', 'Raphanus sativus', '알타리는 뿌리가 얇아서 물을 적게 줘야 한다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 알타리도 수분이 부족하면 뿌리가 억세고 매워집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46413&recmYn=N'),
  ('꽃상추', 'Lactuca sativa', '꽃상추는 꽃이 피면 잎이 더 맛있어진다!', false, 15, 85, 'AI 분석 결과: 이 상식은 사실이 아니에요! 꽃대가 오르면 잎에 쓴맛이 생기고 억세집니다. 꽃이 피기 전에 수확하는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46416&recmYn=N'),
  ('해바라기', 'Helianthus annuus', '해바라기는 하루 종일 태양을 따라 고개를 돌린다!', false, 30, 70, 'AI 분석 결과: 이 상식은 사실이 아니에요! 해바라기는 어린 시절에만 태양을 따라가고, 성숙하면 동쪽을 바라보고 고정됩니다.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43135&recmYn=N'),
  ('적겨자', 'Brassica juncea', '적겨자는 잎이 빨간 만큼 매운맛이 항상 강하다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 매운맛은 품종과 재배 온도, 수확 시기에 따라 달라집니다. 붉은 색은 안토시아닌 색소로 매운맛과 직접 관련이 없어요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=56021&recmYn=N'),
  ('쑥갓', 'Glebionis coronaria', '쑥갓은 꽃이 필수록 잎이 더 향긋해진다!', false, 15, 85, 'AI 분석 결과: 이 상식은 사실이 아니에요! 꽃대가 오르면 잎이 억세지고 쓴맛이 강해집니다. 꽃이 피기 전 어린 잎을 수확하는 게 향이 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43133&recmYn=N'),
  ('치커리', 'Cichorium intybus', '치커리는 쓴맛 때문에 물에 오래 담가야 영양이 좋아진다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 물에 오래 담그면 수용성 비타민이 빠져나갑니다. 쓴맛은 품종 고유의 성질로, 살짝 데쳐 조리하는 게 영양 보존에 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46418&recmYn=N'),
  ('라벤더', 'Lavandula angustifolia', '라벤더는 실내 습기가 많을수록 향이 더 강해진다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 라벤더는 건조하고 통풍이 좋은 환경에서 향 성분이 더 잘 축적됩니다. 과습하면 뿌리가 썩고 향도 약해져요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=57781&recmYn=N'),
  ('대파', 'Allium fistulosum', '대파는 흙을 높게 북주지 않아도 흰 부분이 길게 자란다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 흰 부분은 흙에 묻힌 만큼만 길어집니다. 북주기를 반복해야 흰 대가 길고 부드러워져요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43132&recmYn=N'),
  ('바질', 'Ocimum basilicum', '바질은 잎을 따지 않고 가만히 놔두어야 무성해진다!', false, 10, 90, 'AI 분석 결과: 이 상식은 사실이 아니에요! 윗가지 순지르기를 해야 줄기가 풍성하게 갈라져 수확량이 늘어납니다.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=47918&recmYn=N'),
  ('오이', 'Cucumis sativus', '오이는 수분이 많아서 물을 아껴 줘야 한다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 오이는 수분이 부족하면 열매가 꼬이고 쓴맛이 강해집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.', 'https://www.coupang.com/vp/products/9627720579?itemId=28754407684&vendorItemId=95693224442&q=%EC%98%A4%EC%9D%B4%EC%94%A8%EC%95%97&searchId=50ae76f313385969&sourceType=search&itemsCount=60&searchRank=0&rank=0&traceId=msvr7cej'),
  ('가지', 'Solanum melongena', '가지는 물을 적게 줘야 열매가 더 맛있다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 수분이 부족하면 가지가 작아지고 껍질이 억세지며 쓴맛이 생깁니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.', 'https://www.coupang.com/vp/products/9349374161?itemId=27734919226&vendorItemId=94696140005&q=%EA%B0%80%EC%A7%80+%EC%94%A8%EC%95%97&searchId=0a62cbab11677984&sourceType=search&itemsCount=60&searchRank=3&rank=3&traceId=msvr9g1g'),
  ('몬스테라', 'Monstera deliciosa', '몬스테라는 물을 거의 안 줘도 잘 자란다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 몬스테라는 겉흙이 마를 때쯤 물을 주어야 잎이 시들지 않아요.', 'https://www.coupang.com/vp/products/8335561887?itemId=24068771655&vendorItemId=83899975946'),
  ('선인장', 'Cactaceae', '선인장은 물을 아예 안 줘도 오래 산다!', false, 10, 90, 'AI 분석 결과: 이 상식은 사실이 아니에요! 선인장도 가끔은 물이 필요해요. 다만 주기는 길게, 양은 적게가 정답이에요.', 'https://www.coupang.com/vp/products/9369379695'),
  ('딸기', 'Fragaria × ananassa', '딸기의 씨앗은 열매 속 깊숙한 곳에 있다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 딸기 겉면의 깨 같은 점이 바로 씨앗(열매)이에요. 바깥에 콕콕 박혀 있답니다.', 'https://www.coupang.com/vp/products/8453838228'),
  ('로즈마리', 'Rosmarinus officinalis', '로즈마리는 물을 자주 줘야 더 향긋하게 자란다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 로즈마리는 건조한 토양을 좋아해요. 과습하면 뿌리가 썩고 향도 약해집니다. 흙이 완전히 마른 뒤에 주는 게 좋아요.', 'https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43140&recmYn=N'),
  ('상추', 'Lactuca sativa', '상추는 물을 많이 줄수록 더 아삭하고 맛있어진다!', true, 75, 25, 'AI 분석 결과: 이 상식은 대체로 사실이에요! 수분이 충분해야 잎이 아삭하게 자라요. 다만 과습은 주의해야 해요.', 'https://www.asiaseedmall.com/goods/goods_view.php?goodsNo=1000002047'),
  -- Step 2 (2026-08-26): 텃밭 대표 채소 10종 정식 디렉터리 승격
  ('고추', 'Capsicum annuum', '고추는 물을 많이 주면 매운맛이 약해진다!', false, 35, 65, 'AI 분석 결과: 이 상식은 사실이 아니에요! 매운맛은 품종과 재배 환경(온도, 수분 스트레스)에 의해 결정됩니다. 오히려 적절한 수분 스트레스가 캡사이신 생성을 촉진할 수 있어요.', 'https://www.coupang.com/vp/products/9466169416'),
  ('배추', 'Brassica rapa subsp. pekinensis', '배추는 잎이 크고 많을수록 속이 꽉 찬다!', false, 30, 70, 'AI 분석 결과: 이 상식은 사실이 아니에요! 겉잎이 너무 많으면 양분이 분산되어 속이 느슨해집니다. 적정 밀식과 북주기로 속을 단단하게 채우는 게 중요해요.', 'https://www.coupang.com/vp/products/5878083618?itemId=10302204303&vendorItemId=77584504169'),
  ('무', 'Raphanus sativus', '무는 물을 적게 줘야 뿌리가 단단하고 맛있다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 무는 수분이 부족하면 뿌리가 섬유질이 많아지고 억세지며 매워집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.', 'https://www.coupang.com/vp/products/9426532183'),
  ('감자', 'Solanum tuberosum', '감자는 싹이 튼 씨감자를 그대로 심어도 잘 자란다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 싹이 너무 길게 자란 씨감자는 넘어지거나 부러지기 쉽습니다. 싹을 2~3cm로 틔운 뒤 심는 게 정석이에요.', 'https://www.coupang.com/vp/products/5202752724'),
  ('고구마', 'Ipomoea batatas', '고구마는 씨고구마를 흙에 묻기만 하면 된다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 씨고구마는 30~35°C 온상에서 40~60일간 싹을 틔워 20~30cm 모종(순)을 잘라 심어야 뿌리가 잘 내리고 수확량이 좋아요.', 'https://www.coupang.com/vp/products/9090108700'),
  ('호박', 'Cucurbita moschata', '호박은 넝쿨이 길게 뻗을수록 열매가 더 많이 달린다!', false, 30, 70, 'AI 분석 결과: 이 상식은 사실이 아니에요! 넝쿨이 과도하게 자라면 양분이 잎으로만 가 열매가 작아집니다. 적정 길이에서 순지르기를 해 착과를 유도해야 해요.', 'https://www.coupang.com/vp/products/9019197972'),
  ('옥수수', 'Zea mays', '옥수수는 한 포기만 심어도 수확할 수 있다!', false, 15, 85, 'AI 분석 결과: 이 상식은 사실이 아니에요! 옥수수는 바람으로 꽃가루를 받는 풍매화 작물이라 최소 2줄 이상(또는 여러 포기) 밀식해야 수정이 잘 돼 알이 꽉 차요.', 'https://www.coupang.com/vp/products/9440689258'),
  ('완두콩', 'Pisum sativum', '완두콩은 지지대 없이 바닥에 퍼뜨려 키워도 된다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 완두콩은 덩굴성 작물이라 지지대가 없으면 줄기가 땅에 닿아 병해충 피해가 커지고 수확도 어렵습니다. 반드시 지주를 세워 유인해야 해요.', 'https://www.coupang.com/vp/products/7324976706'),
  ('강낭콩', 'Phaseolus vulgaris', '강낭콩은 물을 자주 주면 콩알이 굵어진다!', false, 25, 75, 'AI 분석 결과: 이 상식은 사실이 아니에요! 개화기·착과기에는 수분이 필요하지만, 과습하면 뿌리 호흡이 안 돼 오히려 콩알이 작아집니다. 겉흙 마른 뒤 충분히 주는 게 정석입니다.', 'https://www.coupang.com/vp/products/9417605905'),
  ('케일', 'Brassica oleracea var. acephala', '케일은 여름 더위에 키워야 잎이 부드럽다!', false, 20, 80, 'AI 분석 결과: 이 상식은 사실이 아니에요! 케일은 서늘한 기후(15~20°C)를 좋아하는 내한성 작물로, 고온에서는 잎이 억세지고 쓴맛이 강해집니다. 봄·가을 재배가 적합해요.', 'https://www.coupang.com/vp/products/8642123272')
on conflict (name) do update set
  scientific_name = excluded.scientific_name,
  myth = excluded.myth,
  verdict = excluded.verdict,
  true_percent = excluded.true_percent,
  false_percent = excluded.false_percent,
  belief_summary = excluded.belief_summary,
  purchase_url = excluded.purchase_url,
  updated_at = now();

-- ==============================================================================
-- [Step 1] 유저 프로필(profiles) & 리프(Leaf) 화폐 시스템
-- ==============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text not null default '새싹 식집사',
  avatar_emoji text not null default '🌱',
  leaf_balance integer not null default 50, -- 웰컴 보너스 50 리프
  streak_count integer not null default 1,
  last_checkin_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

-- 리프(Leaf) 트랜잭션 기록 테이블 (지갑 입출금 내역)
create table if not exists public.leaf_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null, -- 획득: 양수 (+), 사용: 음수 (-)
  reason text not null,    -- 'welcome_bonus', 'daily_checkin', 'plant_watered', 'shop_purchase' 등
  balance_after integer not null,
  created_at timestamptz not null default now()
);

alter table public.leaf_transactions enable row level security;

create policy "leaf_transactions: select own" on public.leaf_transactions
  for select using (auth.uid() = user_id);

create policy "leaf_transactions: insert own" on public.leaf_transactions
  for insert with check (auth.uid() = user_id);

-- ==============================================================================
-- [Step 3 사전 준비] 스마트 물주기 스케줄 테이블
-- ==============================================================================

create table if not exists public.plant_watering_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plant_name text not null,
  emoji text default '🌱',
  watering_interval_days integer not null default 7,
  last_watered_at timestamptz not null default now(),
  next_water_date date not null,
  notification_enabled boolean default true,
  created_at timestamptz not null default now()
);

alter table public.plant_watering_schedules enable row level security;

create policy "plant_watering_schedules: select own" on public.plant_watering_schedules
  for select using (auth.uid() = user_id);

create policy "plant_watering_schedules: insert own" on public.plant_watering_schedules
  for insert with check (auth.uid() = user_id);

create policy "plant_watering_schedules: update own" on public.plant_watering_schedules
  for update using (auth.uid() = user_id);

create policy "plant_watering_schedules: delete own" on public.plant_watering_schedules
  for delete using (auth.uid() = user_id);