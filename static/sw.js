/* =========================================================================
 * 식물 위키백과 - Service Worker (PWA 오프라인 지원)
 * 전략 요약:
 *  - 사전 캐시: 설치 시 앱 셸(HTML/매니페스트/아이콘)을 미리 저장
 *  - 네비게이션(페이지 이동): Network First → 실패 시 캐시(오프라인 부팅)
 *  - API 요청(/api/*): Network First → 캐시 폴백(마지막 검색 결과 재사용)
 *  - 정적 자산/외부 CDN: Stale-While-Revalidate(빠른 로딩 + 백그라운드 갱신)
 * ========================================================================= */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `plant-wiki-${CACHE_VERSION}`;

// 설치 단계에서 미리 캐싱할 필수 앱 셸(오프라인 부팅의 최소 구성)
const PRECACHE_URLS = [
  '/',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/icon-maskable-512.png',
];

/* ------------------------- 설치 (Install) ------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // 새 버전 즉시 활성화
  );
});

/* ------------------------- 활성화 (Activate) ------------------------- */
self.addEventListener('activate', (event) => {
  const allowed = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !allowed.includes(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // 새 워커가 모든 탭 제어
  );
});

/* ------------------------- 요청 가로채기 (Fetch) ------------------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // POST/기타 메서드는 서비스 워커가 가로채지 않음(브라우저 기본 동작)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) 페이지 네비게이션: 최신 HTML 우선, 실패 시(오프라인) 캐시된 앱 셸 제공
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) =>
          cached || caches.match('/') // 어디서든 앱 셸로 폴백
        ))
    );
    return;
  }

  // 2) API 요청: 최신 데이터 우선, 실패 시 마지막 응답 캐시 폴백
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 3) 정적 자산 + 외부 CDN(Tailwind/Pretendard): 캐시 우선(즉시 표시),
  //    백그라운드로 새 응답을 받아 다음 방문 때 갱신 (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
