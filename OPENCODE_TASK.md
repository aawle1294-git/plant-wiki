# OpenCode 작업 브리프 — Plant!p

너는 **코딩처(OpenCode)** 다. 총괄처(Antigravity)는 토큰 소진으로 기절한 상태다. 기획 기준은 고문처가 준 이 브리프와 레포의 `notion_project_dashboard.md`다. 추측으로 기능을 늘리지 마라.

프로젝트: `C:\Users\aaron\Downloads\plant_wiki`  
스택: FastAPI + `templates/index.html` + Supabase + (선택) Gemini  
테스트: `venv`에서 기존 pytest를 깨지 말 것. 새 API는 테스트를 추가할 것.  
프론트는 한 파일이 길다. 작은 수정도 검색/도감/대시보드/설정을 같이 확인하라.  
`.env`의 실키는 커밋·로그·문서에 넣지 마라. 필요하면 `.env.example`만 손본다.

---

## 하지 말 것

- 설문/만족도 조사 UI·API (코드에도 플랜 파일에도 없음. 나중에)
- 리프 상점, 정원 꾸미기, 관리자 plant_directory 편집 화면 (플랜: 나중에/낮음)
- Google 미설정일 때 공유 계정·데모 토큰으로 “성공한 척” 하는 폴백
- 물주기를 다시 `/api/search`로 흉내 내는 방식 유지

---

## A. 지금 깨진 것 (먼저 고쳐라)

### 검색
1. `app.py` `NON_PLANT_KEYWORDS`에서 식물과 겹치는 단어 제거. 특히 **「배」(배나무/pear vs 배/boat)**. `물`도 재검토.
2. 디렉터리/프리셋은 **완전일치만** 한다. 공백·별칭(방울 토마토, cherry tomato 등)은 가짜 `… spp.` fallback으로 떨어진다. 대표 식물 별칭 맵 또는 trim/정규화 후 조회.
3. 검색 실패 UX: `performSearch`가 `alert()`다. 가드레일과 구분되는 짧은 토스트/인페이지 오류로 바꿔라. 빈 문자열 400도 사용자 문장으로.

### 로그인
1. 회원가입: Supabase가 이메일 확인을 켜 두면 `sign_up` 후 세션이 없다. **확인 메일이 필요할 수 있다**는 안내를 띄우고, 세션이 있으면 바로 로그인 처리.
2. `/api/auth/google-quick` 공유 계정(`google.user@gmail.com`)과 `demo-google-token`은 **제출용으로 위험**하다. 제거하거나 개발 플래그 뒤로 숨겨라.
3. Google: `/api/auth/oauth/google`이 `provider_not_enabled`이면 **가짜 로그인하지 말고** “Supabase Google Provider를 켜야 한다”만 보여라.
4. OAuth 해시 `access_token` 저장 후 `/api/auth/me`로 이메일을 채운다. 실패 시 토큰을 지우고 이유를 보여라. `restoreAuth`가 조용히 로그아웃만 하면 사용자는 “로그인 오류”로 느낀다.

### 기능 실종 (UI만 있음)
1. 스마트 물주기: `loadWateringCards()`가 `/api/history`를 읽는다. `supabase_schema.sql`의 `plant_watering_schedules`와 `MEMORY_WATERING_SCHEDULES`는 쓰이지 않는다.
2. `markWatered()`가 다시 `/api/search`를 친다. 기한 지남(`diffDays <= 0`)일 때 버튼이 **disabled**다. 기한 당일/지남에서 누르는 게 정상이다.
3. 알림 토글은 toast만. 새로고침 후 유지되지 않는다. 뉴스레터 구독도 더미 배지가 붙어 있다.
4. 리프 내역 라벨 `plant_watered` / `quiz_completed` / `shop_purchase`는 UI만. 상점은 만들지 말고, 물주기 완료 시에만 `plant_watered`를 실제 지급할지 최소로 결정(하루 1회·소량). 퀴즈 보상은 이번 라운드에서 하지 않아도 된다.
5. 연속학습: `/api/streak/checkin`과 7일 보드는 있다. 프론트 `toISOString().slice(0,10)`(UTC)와 서버 `date.today()`가 어긋날 수 있다. **한국 날짜(Asia/Seoul)로 통일**. “학습”을 퀴즈 필수로 바꾸지 마라. 출석이 플랜상의 현재 범위다.

---

## B. 파일 플랜대로 구현 (`notion_project_dashboard.md`)

### 1단계 — 물주기 데이터
- `plant_watering_schedules` CRUD API. RLS: 본인만.
- 도감 검색과 스케줄은 분리. 검색이 스케줄을 자동 생성할지는 명시하라(권장: 대시보드에서 “물주기 추가” 또는 첫 검색 시 옵트인. 검색마다 스케줄이 늘어나면 안 됨).
- `GET/POST/PATCH/DELETE` + “물 줬어요”는 `last_watered_at` / `next_water_date`만 갱신.
- 대시보드 카드는 이 API만 읽는다.
- 테스트: 생성·조회·갱신·타 사용자 차단.

### 2단계 — 알림 1채널
- 아침 알림 / 즉시 알림 설정을 서버에 저장(프로필 컬럼 또는 별도 테이블). 새로고침 후에도 유지.
- 이메일 **또는** 브라우저 푸시 중 **하나만**. `pywebpush`가 이미 깔려 있으면 푸시가 자연스럽다. 못 보내면 설정만 저장하고 “보내보기”에서 명확한 실패 메시지를.
- 마지막 발송 시각·실패 로그.
- 대시보드에 “알림 보내보기”.

### 3단계 — 제출 품질 (코드가 필요한 범위만)
- 375 / 768 / 데스크톱에서 검색, 도감, 대시보드, 로그인 모달이 겹치지 않게.
- 대표 검색 시나리오 고정: 토마토, 바질 포함 5종. 가드레일(강아지)도 유지.
- `.env` 실값 공유 금지.

Google OAuth(플랜 중간): Provider + redirect URL을 문서화하고, 켜져 있을 때만 리다이렉트. 가짜 성공 금지.

연속학습(플랜: 이미 됨): 날짜 버그·중복 출석만 고친다. 새 학습 커리큘럼 만들지 마라.

---

## 완료 기준 (데모 6스텝이 실제로 돌아가야 함)

1. 로고 + 검색창
2. `토마토` 검색 → 학명, 재배, 병충해, 상식 검증
3. 상식 검증 설명이 보임
4. 로그인 후 나의 도감에 기록
5. 대시보드 물주기 D-Day가 **스케줄 데이터** 기준
6. PWA 설치/오프라인은 기존 동작 유지. 회귀만 막을 것

체크리스트 대응: 스키마 최신 적용, 대표 5종 검색, 로그인/회원가입, 히스토리 저장/삭제, 물주기 실데이터, 알림 설정 저장. 설문은 체크리스트에 없다.

---

## 보고 형식 (끝나면 총괄/고문처가 읽게)

- 고친 파일과 API 목록
- 아직 막힌 것 (Google Cloud 콘솔, SMTP 등 사람 손 필요한 것)
- pytest 결과
- `.env`를 커밋하지 않았다는 확인
