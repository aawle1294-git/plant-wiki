        let currentPlantName = "";
        let deferredPrompt = null;
        let searchSeq = 0;

        // ============ 유틸 ============
        function esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }
        const escapeHtml = esc;

        // ============ 테마 (다크/화이트) ============
        function setTheme(t) {
            document.documentElement.dataset.theme = t;
            try { localStorage.setItem('pwiki-theme', t); } catch (e) {}
            document.getElementById('theme-toggle').innerText = t === 'dark' ? '☀️' : '🌙';
            // 설정 모달 내 테마 스위치와 이중 바인딩 (동일 값이면 onchange 이벤트 루프 없음)
            const sw = document.getElementById('settings-theme-switch');
            if (sw && sw.checked !== (t === 'dark')) sw.checked = (t === 'dark');
        }
        function toggleTheme() {
            setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        }

        // ============ PWA 설치 (검색창 오른쪽 끝 📱 버튼) ============
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            document.querySelectorAll('.install-btn').forEach(b => b.style.display = 'flex');
        });
        window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            document.querySelectorAll('.install-btn').forEach(b => b.style.display = 'none');
        });
        async function installApp() {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                await deferredPrompt.userChoice;
                deferredPrompt = null;
                document.querySelectorAll('.install-btn').forEach(b => b.style.display = 'none');
            } else if (navigator.share) {
                // PWA 설치 불가 환경: 공유로 안내
                try {
                    await navigator.share({ title: 'Plant!p', text: 'AI 식물 위키백과 Plant!p', url: location.href });
                } catch (e) {}
            }
        }

        // ============ 토스트 알림 ============
        function showToast(msg, type = 'info') {
            const container = document.getElementById('toast-container');
            const el = document.createElement('div');
            el.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
            const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : '💬';
            el.innerHTML = `<span>${icon}</span><span>${esc(msg)}</span>`;
            container.appendChild(el);
            requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
            setTimeout(() => {
                el.classList.add('leaving');
                setTimeout(() => el.remove(), 600); // 퇴장 트랜지션 후 DOM 제거
            }, 2600);
        }

        // ============ 수퍼베이스 클라우드 로그인 / 회원가입 (같은 기기 영구 자동 로그인) ============
        const AUTH_TOKEN_KEY = 'pwiki-sb-token';
        const AUTH_REFRESH_TOKEN_KEY = 'pwiki-sb-refresh-token';
        const AUTH_EMAIL_KEY = 'pwiki-sb-email';
        const DEVICE_ID_KEY = 'pwiki-device-id';
        const AUTO_LOGIN_ENABLED_KEY = 'pwiki-auto-login-enabled';
        let authMode = 'login';

        // 영구 쿠키 헬퍼 (로컬스토리지와 상호 백업하여 브라우저/PWA 어디서든 로그인 유지)
        function setDeviceCookie(name, val, days = 365) {
            try {
                const expires = new Date(Date.now() + days * 864e5).toUTCString();
                document.cookie = `${name}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Lax`;
            } catch (e) {}
        }
        function getDeviceCookie(name) {
            try {
                const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
                return match ? decodeURIComponent(match[2]) : '';
            } catch (e) { return ''; }
        }
        function removeDeviceCookie(name) {
            try {
                document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
            } catch (e) {}
        }

        function getDeviceId() {
            let id = localStorage.getItem(DEVICE_ID_KEY) || getDeviceCookie(DEVICE_ID_KEY);
            if (!id) {
                id = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now();
                localStorage.setItem(DEVICE_ID_KEY, id);
                setDeviceCookie(DEVICE_ID_KEY, id, 3650); // 10년 보존
            }
            return id;
        }

        function getAuthToken() {
            return localStorage.getItem(AUTH_TOKEN_KEY) || getDeviceCookie(AUTH_TOKEN_KEY) || '';
        }
        function getStoredEmail() {
            return localStorage.getItem(AUTH_EMAIL_KEY) || getDeviceCookie(AUTH_EMAIL_KEY) || '';
        }

        function isLoggedIn() {
            return !!(getAuthToken() || getStoredEmail());
        }

        // ============ 크로스 도메인 SSO (plantip.onrender.com & plantwiki.kro.kr 간 실시간 세션 공유) ============
        const SSO_HUB_ORIGIN = 'https://plantip.onrender.com';
        let ssoHubIframe = null;
        let ssoHubReady = false;

        function initCrossDomainSSO() {
            // 현재 도메인이 메인 허브와 다른 경우에만 허브 iframe 연결
            if (window.location.origin === SSO_HUB_ORIGIN) return;

            ssoHubIframe = document.createElement('iframe');
            ssoHubIframe.src = `${SSO_HUB_ORIGIN}/sso-hub`;
            ssoHubIframe.style.display = 'none';
            ssoHubIframe.style.width = '0';
            ssoHubIframe.style.height = '0';
            ssoHubIframe.style.border = 'none';

            window.addEventListener('message', (event) => {
                if (event.origin !== SSO_HUB_ORIGIN) return;
                const data = event.data;
                if (!data || typeof data !== 'object') return;

                if (data.type === 'PWIKI_SSO_HUB_READY') {
                    ssoHubReady = true;
                    // 현재 도메인에 로그인 세션이 없다면 허브로부터 세션 요청!
                    if (!getAuthToken() && !getStoredEmail()) {
                        ssoHubIframe.contentWindow.postMessage({ type: 'PWIKI_GET_SSO_SESSION' }, SSO_HUB_ORIGIN);
                    } else {
                        syncSessionToSSOHub();
                    }
                } else if (data.type === 'PWIKI_SSO_SESSION_RESULT') {
                    const session = data.session;
                    if (session && (session['pwiki-sb-token'] || session['pwiki-sb-email'])) {
                        // 허브에서 세션을 성공적으로 받아왔으므로 현재 도메인에 저장!
                        Object.entries(session).forEach(([k, v]) => {
                            if (v) localStorage.setItem(k, v);
                        });
                        restoreAuth();
                    }
                }
            });

            document.body.appendChild(ssoHubIframe);
        }

        function syncSessionToSSOHub() {
            if (!ssoHubIframe || !ssoHubReady) return;
            const session = {
                'pwiki-sb-token': getAuthToken(),
                'pwiki-sb-refresh-token': localStorage.getItem(AUTH_REFRESH_TOKEN_KEY) || '',
                'pwiki-sb-email': getStoredEmail(),
                'pwiki-device-id': getDeviceId(),
                'pwiki-auto-login-enabled': 'true',
                'pwiki-profile-cache': localStorage.getItem(PROFILE_CACHE_KEY) || '',
                'plantwiki_owned_items': localStorage.getItem('plantwiki_owned_items') || '[]'
            };
            try {
                ssoHubIframe.contentWindow.postMessage({
                    type: 'PWIKI_SET_SSO_SESSION',
                    session: session
                }, SSO_HUB_ORIGIN);
            } catch (e) {}
        }

        function clearSSOHubSession() {
            if (!ssoHubIframe || !ssoHubReady) return;
            try {
                ssoHubIframe.contentWindow.postMessage({
                    type: 'PWIKI_CLEAR_SSO_SESSION'
                }, SSO_HUB_ORIGIN);
            } catch (e) {}
        }

        function saveAuthSession(token, email, refreshToken = null) {
            if (token) {
                localStorage.setItem(AUTH_TOKEN_KEY, token);
                setDeviceCookie(AUTH_TOKEN_KEY, token, 365);
            }
            if (email) {
                localStorage.setItem(AUTH_EMAIL_KEY, email);
                setDeviceCookie(AUTH_EMAIL_KEY, email, 365);
            }
            if (refreshToken) {
                localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, refreshToken);
                setDeviceCookie(AUTH_REFRESH_TOKEN_KEY, refreshToken, 365);
            }
            localStorage.setItem(AUTO_LOGIN_ENABLED_KEY, 'true');
            setDeviceCookie(AUTO_LOGIN_ENABLED_KEY, 'true', 365);
            getDeviceId();
            syncSessionToSSOHub();
        }

        function clearAuthSession() {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
            localStorage.removeItem(AUTH_EMAIL_KEY);
            localStorage.removeItem(AUTO_LOGIN_ENABLED_KEY);
            localStorage.removeItem(PROFILE_CACHE_KEY);
            removeDeviceCookie(AUTH_TOKEN_KEY);
            removeDeviceCookie(AUTH_REFRESH_TOKEN_KEY);
            removeDeviceCookie(AUTH_EMAIL_KEY);
            removeDeviceCookie(AUTO_LOGIN_ENABLED_KEY);
            clearSSOHubSession();
        }

        function authHeaders() {
            const t = getAuthToken();
            const devId = getDeviceId();
            const email = getStoredEmail();
            const h = {
                'X-Device-Id': devId,
                'X-Device-Email': email
            };
            if (t) h['Authorization'] = 'Bearer ' + t;
            return h;
        }

        function openAuth() {
            document.getElementById('auth-modal').classList.add('open');
            document.getElementById('auth-error').classList.add('hidden');
            setAuthPanelState();
        }
        function closeAuth() { document.getElementById('auth-modal').classList.remove('open'); }
        function closeAuthOnBackdrop(e) {
            if (e.target === e.currentTarget) closeAuth();
        }

        function setAuthPanelState() {
            const logged = isLoggedIn();
            document.getElementById('auth-form-wrap').classList.toggle('hidden', logged);
            document.getElementById('auth-logged-wrap').classList.toggle('hidden', !logged);
            if (logged) document.getElementById('auth-logged-email').innerText = getStoredEmail();
        }

        function setAuthMode(mode) {
            authMode = mode;
            document.getElementById('auth-mode-title').innerText = mode === 'login' ? '🔐 로그인' : '✨ 회원가입';
            document.getElementById('auth-submit-btn').innerText = mode === 'login' ? '로그인' : '새 계정 만들기';
            document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
            document.getElementById('auth-tab-register').classList.toggle('active', mode === 'register');
            document.getElementById('auth-tab-login').setAttribute('aria-selected', mode === 'login');
            document.getElementById('auth-tab-register').setAttribute('aria-selected', mode === 'register');
            document.getElementById('auth-error').classList.add('hidden');
        }

        function showAuthError(msg) {
            const el = document.getElementById('auth-error');
            el.innerText = '⚠️ ' + msg;
            el.classList.remove('hidden');
        }

        async function submitAuth() {
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            if (!email || !password) { showAuthError('이메일과 비밀번호를 입력해주세요.'); return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('이메일 주소 양식이 맞는지 확인해 주세요! 🌱', 'error');
                return;
            }
            if (password.length < 6) { showAuthError('비밀번호는 6자 이상이어야 해요.'); return; }
            try {
                const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const detail = body.detail || '요청에 실패했습니다.';
                    if (/validate email|invalid format/i.test(detail)) {
                        showToast('이메일 주소 양식이 맞는지 확인해 주세요! 🌱', 'error');
                        return;
                    }
                    showAuthError(detail);
                    return;
                }
                if (authMode === 'register') {
                    if (body.access_token && body.user) {
                        saveAuthSession(body.access_token, body.user.email, body.refresh_token);
                        setAuthUI(body.user.email);
                        closeAuth();
                        showToast(body.message || '회원가입 완료! 자동 로그인되었습니다. 🌿', 'success');
                        updateHistoryBadge();
                    } else {
                        setAuthMode('login');
                        showToast(body.message || '회원가입 완료! 확인 메일(인증)이 필요할 수 있습니다. 🌿', 'info');
                    }
                    return;
                }
                saveAuthSession(body.access_token, body.user.email, body.refresh_token);
                setAuthUI(body.user.email);
                closeAuth();
                showToast('로그인되었습니다! 🌿', 'success');
                updateHistoryBadge();
            } catch (err) { showAuthError('네트워크 오류가 발생했습니다.'); }
        }

        function logoutAuth() {
            clearAuthSession();
            setAuthUI(null);
            setAuthPanelState();
            closeAuth();
            showToast('로그아웃되었습니다. 다음에 또 만나요! 👋', 'success');
            updateHistoryBadge();
        }

        // ============ 유저 프로필 & 연속학습 (스트릭) & 리프 화폐 ============
        let currentProfile = null;

        function handleOAuthHash() {
            // 디버그: 돌아온 URL 확인
            const fullUrl = window.location.href;
            console.log('[OAuth Debug] Current URL:', fullUrl);
            console.log('[OAuth Debug] Hash:', window.location.hash);
            console.log('[OAuth Debug] Search:', window.location.search);

            let accessToken = null;
            let refreshToken = null;

            // 1) URL 해시에서 토큰 추출 (#access_token=...&refresh_token=...)
            if (window.location.hash) {
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                accessToken = params.get('access_token');
                refreshToken = params.get('refresh_token');
                console.log('[OAuth Debug] Token from hash:', accessToken ? 'Found' : 'Not found');
            }

            // 2) 쿼리 파라미터에서 토큰 추출 (?access_token=...)
            if (!accessToken && window.location.search) {
                const params = new URLSearchParams(window.location.search);
                accessToken = params.get('access_token');
                refreshToken = params.get('refresh_token') || refreshToken;
                console.log('[OAuth Debug] Token from query:', accessToken ? 'Found' : 'Not found');
            }

            if (accessToken) {
                console.log('[OAuth Debug] Saving token and auto-login session');
                saveAuthSession(accessToken, null, refreshToken);
                // URL 정리
                history.replaceState(null, null, window.location.pathname);
                showToast('Google 로그인 처리 중... 🌿', 'info');
            } else {
                // OAuth 실패 또는 오류 파라미터 확인
                const searchParams = new URLSearchParams(window.location.search);
                const hashParams = window.location.hash ? new URLSearchParams(window.location.hash.substring(1)) : null;
                const errorDesc = searchParams.get('error_description') || (hashParams ? hashParams.get('error_description') : null);
                const errorType = searchParams.get('error') || (hashParams ? hashParams.get('error') : null);

                if (errorDesc || errorType) {
                    console.error('[OAuth Debug] OAuth error received:', errorType, errorDesc);
                    history.replaceState(null, null, window.location.pathname);
                    if (errorDesc && errorDesc.includes('Unable to exchange external code')) {
                        showToast('Google 로그인 실패: Supabase의 Client Secret(보안 비밀번호) 또는 Callback URL 설정을 확인해주세요. 🔒', 'error');
                    } else {
                        showToast(`Google 로그인 오류: ${decodeURIComponent(errorDesc || errorType || '인증 실패')}`, 'error');
                    }
                } else if (fullUrl.includes('access_token')) {
                    console.warn('[OAuth Debug] URL contains token-like params but parsing failed');
                }
            }
        }

        // ============ 계정 정보 로컬 영구 보존 및 동기화 (초기화 및 변형 원천 차단) ============
        const PROFILE_CACHE_KEY = 'pwiki-profile-cache';

        function getStoredProfileCache() {
            try {
                const raw = localStorage.getItem(PROFILE_CACHE_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        }

        function saveProfileCache(profile) {
            if (!profile) return;
            try {
                const prev = getStoredProfileCache() || {};
                const merged = { ...prev, ...profile };
                // 리프나 연속 학습일이 비정상적으로 줄어들지 않도록 보호
                if (prev.leaf_balance !== undefined && (merged.leaf_balance === undefined || merged.leaf_balance < prev.leaf_balance)) {
                    merged.leaf_balance = prev.leaf_balance;
                }
                if (prev.streak_count !== undefined && (merged.streak_count === undefined || merged.streak_count < prev.streak_count)) {
                    merged.streak_count = prev.streak_count;
                }
                // 획득한 칭호 보존
                if (prev.title && prev.title !== '새싹' && (!merged.title || merged.title === '새싹')) {
                    merged.title = prev.title;
                }
                // 커스텀 닉네임 및 아바타 보존
                if (prev.nickname && prev.nickname !== '새싹 식집사' && (!merged.nickname || merged.nickname === '새싹 식집사')) {
                    merged.nickname = prev.nickname;
                }
                if (prev.avatar_emoji && prev.avatar_emoji !== '🌱' && (!merged.avatar_emoji || merged.avatar_emoji === '🌱')) {
                    merged.avatar_emoji = prev.avatar_emoji;
                }
                // 소유 아이템 목록 영구 보존
                const localOwned = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
                const combinedOwned = Array.from(new Set([...(prev.owned_items || []), ...(profile.owned_items || []), ...localOwned]));
                merged.owned_items = combinedOwned;
                localStorage.setItem('plantwiki_owned_items', JSON.stringify(combinedOwned));

                localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(merged));
            } catch (e) {}
        }

        async function fetchProfile() {
            if (!isLoggedIn()) return;
            // 1. 기기 로컬에 저장된 계정 정보가 있다면 즉시 복원 (화면 깜빡임/0초 복원)
            const cached = getStoredProfileCache();
            if (cached) {
                currentProfile = cached;
                updateProfileUI(cached);
            }

            try {
                const res = await fetch('/api/profile/me', { headers: authHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        let serverProfile = data.data;

                        // 서버의 소유 아이템 목록과 로컬 아이템 병합
                        if (serverProfile.owned_items && Array.isArray(serverProfile.owned_items)) {
                            const localOwned = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
                            const mergedOwned = Array.from(new Set([...serverProfile.owned_items, ...localOwned]));
                            localStorage.setItem('plantwiki_owned_items', JSON.stringify(mergedOwned));
                            serverProfile.owned_items = mergedOwned;
                        }

                        // 2. 서버가 재배포되거나 초기화된 상태(기본 리프 50 등)이고, 로컬에 더 많은 정보가 있다면 자동 복구 동기화
                        const localOwned = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
                        const shouldSync = cached && (
                            (cached.leaf_balance && cached.leaf_balance > (serverProfile.leaf_balance || 0)) ||
                            (cached.streak_count && cached.streak_count > (serverProfile.streak_count || 1)) ||
                            (cached.title && cached.title !== '새싹' && serverProfile.title === '새싹') ||
                            (cached.nickname && cached.nickname !== '새싹 식집사' && serverProfile.nickname === '새싹 식집사') ||
                            (cached.avatar_emoji && cached.avatar_emoji !== '🌱' && serverProfile.avatar_emoji === '🌱') ||
                            (localOwned.length > (serverProfile.owned_items ? serverProfile.owned_items.length : 0))
                        );

                        if (shouldSync) {
                            try {
                                const syncPayload = { ...cached, owned_items: localOwned };
                                const syncRes = await fetch('/api/profile/sync', {
                                    method: 'POST',
                                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                                    body: JSON.stringify(syncPayload)
                                });
                                if (syncRes.ok) {
                                    const syncData = await syncRes.json();
                                    if (syncData.status === 'success') {
                                        serverProfile = syncData.data;
                                    }
                                }
                            } catch (syncErr) {
                                console.warn('Auto restore sync error:', syncErr);
                            }
                        }

                        currentProfile = serverProfile;
                        saveProfileCache(currentProfile);
                        updateProfileUI(currentProfile);
                    }
                }
            } catch (err) {
                console.warn('Profile fetch error:', err);
                if (cached) {
                    currentProfile = cached;
                    updateProfileUI(cached);
                }
            }
        }

        function updateProfileUI(profile) {
            if (!profile) return;
            // 1. 헤더 칩 반영
            const avatarEl = document.getElementById('auth-user-avatar');
            const nameEl = document.getElementById('auth-user-name');
            const leavesEl = document.getElementById('auth-user-leaves');
            const streakEl = document.getElementById('auth-user-streak');

            if (avatarEl) avatarEl.innerText = profile.avatar_emoji || '🌱';
            if (nameEl) {
                const displayName = profile.nickname || (profile.email ? profile.email.split('@')[0] : '새싹 식집사');
                nameEl.innerText = displayName;
            }
            if (leavesEl) leavesEl.innerText = profile.leaf_balance ?? 50;
            if (streakEl) streakEl.innerText = `${profile.streak_count ?? 1}일`;
            const titleEl = document.getElementById('auth-user-title');
            if (titleEl) titleEl.innerText = profile.title || '새싹';

            // 2. 프로필 모달 내부 반영
            const modalAvatar = document.getElementById('profile-avatar-display');
            const nickInput = document.getElementById('profile-nickname-input');
            const emailDisp = document.getElementById('profile-email-display');
            const modalTitle = document.getElementById('profile-title-display');
            const leafCount = document.getElementById('profile-leaf-count');
            const streakCount = document.getElementById('profile-streak-count');

            if (modalAvatar) modalAvatar.innerText = profile.avatar_emoji || '🌱';
            if (nickInput && document.activeElement !== nickInput) nickInput.value = profile.nickname || '새싹 식집사';
            if (emailDisp) emailDisp.innerText = profile.email || '';
            if (modalTitle) modalTitle.innerText = `칭호: ${profile.title || '새싹'}`;
            if (leafCount) leafCount.innerText = profile.leaf_balance ?? 50;
            if (streakCount) streakCount.innerText = profile.streak_count ?? 1;

            // 3. 스트릭 7일 보드 렌더링
            renderStreakBoard(profile.streak_count ?? 1, profile.last_checkin_date);
        }

        function renderStreakBoard(streakCount, lastCheckinDate) {
            const row = document.getElementById('streak-days-row');
            if (!row) return;
            // KST (UTC+9) 기준 오늘 날짜 계산 (백엔드와 동일하게)
            const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
            const todayStr = kstNow.toISOString().slice(0, 10);
            const isTodayDone = lastCheckinDate === todayStr;

            // 7일 사이클 계산: (streakCount - 1) % 7 + 1
            const activeDays = Math.min(7, Math.max(1, ((streakCount - 1) % 7) + 1));

            let html = '';
            for (let day = 1; day <= 7; day++) {
                const isActive = day <= activeDays;
                html += `
                <div class="streak-day-badge ${isActive ? 'active' : ''}">
                    <span class="day-label">${day}일차</span>
                    <span class="day-flame ${isActive ? 'streak-flame-pulse' : ''}">${isActive ? '🔥' : '🌱'}</span>
                </div>`;
            }
            row.innerHTML = html;

            const btn = document.getElementById('streak-checkin-btn');
            if (btn) {
                if (isTodayDone) {
                    btn.disabled = true;
                    btn.innerHTML = '<span>✅</span> 오늘 출석 완료! (내일 또 만나요 🌱)';
                    btn.classList.add('opacity-75', 'cursor-not-allowed');
                } else {
                    btn.disabled = false;
                    btn.innerHTML = '<span>📅</span> 오늘 출석 체크하고 +10 리프 받기!';
                    btn.classList.remove('opacity-75', 'cursor-not-allowed');
                }
            }
        }

        async function openProfileModal() {
            if (!isLoggedIn()) {
                openAuth();
                return;
            }
            document.getElementById('profile-modal').classList.add('open');
            await fetchProfile();
            await loadLeafHistory();
        }

        function closeProfileModal() {
            const modal = document.getElementById('profile-modal');
            if (modal) modal.classList.remove('open');
            const picker = document.getElementById('avatar-picker-grid');
            if (picker) picker.classList.add('hidden');
        }

        function closeProfileOnBackdrop(e) {
            if (e.target === e.currentTarget) closeProfileModal();
        }

        // ============ 상점 로직 ============
        function openShopModal() {
            closeProfileModal(); // 프로필 모달 닫기
            document.getElementById('shop-modal').classList.add('open');
            updateShopUI();
        }

        function closeShopModal() {
            document.getElementById('shop-modal').classList.remove('open');
        }

        function closeShopOnBackdrop(e) {
            if (e.target === e.currentTarget) closeShopModal();
        }

        function switchShopTab(tab) {
            const avatarTab = document.getElementById('shop-tab-avatar');
            const titleTab = document.getElementById('shop-tab-title');
            const avatarPane = document.getElementById('shop-pane-avatar');
            const titlePane = document.getElementById('shop-pane-title');
            if (avatarTab && titleTab && avatarPane && titlePane) {
                avatarTab.classList.toggle('active', tab === 'avatar');
                titleTab.classList.toggle('active', tab === 'title');
                avatarPane.classList.toggle('hidden', tab !== 'avatar');
                titlePane.classList.toggle('hidden', tab !== 'title');
            }
        }

        function updateShopUI() {
            // 현재 리프 업데이트
            const leafCount = currentProfile?.leaf_balance ?? 50;
            const shopLeaves = document.getElementById('shop-my-leaves');
            if (shopLeaves) shopLeaves.innerText = leafCount;

            // 이미 구매한 아이템 체크 (로컬 스토리지 활용)
            const ownedItems = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
            
            document.querySelectorAll('.shop-item-card button, .shop-title-card button').forEach(btn => {
                const onclickAttr = btn.getAttribute('onclick');
                if (onclickAttr) {
                    const itemIdMatch = onclickAttr.match(/'([^']+)'/);
                    if (itemIdMatch && ownedItems.includes(itemIdMatch[1])) {
                        btn.innerText = '착용중';
                        btn.classList.add('opacity-50');
                        btn.disabled = true;
                    }
                }
            });
        }

        async function buyTitle(titleId, price, titleName) {
            let leafCount = currentProfile?.leaf_balance ?? 50;
            if (leafCount < price) {
                showToast('리프가 부족합니다! 🍃 더 모아주세요.', 'error');
                return;
            }

            try {
                const token = getAuthToken();
                if (!token) throw new Error('로그인이 필요합니다.');

                const res = await fetch('/api/shop/buy', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({ item_id: titleId, price: price, title: titleName, item_type: 'title' })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || '칭호 구매 실패');
                }

                const data = await res.json();
                currentProfile = data.profile;
                if (!currentProfile.title) currentProfile.title = titleName;
                saveProfileCache(currentProfile);

                let ownedItems = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
                if (!ownedItems.includes(titleId)) {
                    ownedItems.push(titleId);
                    localStorage.setItem('plantwiki_owned_items', JSON.stringify(ownedItems));
                }

                showToast(`[${titleName}] 칭호 획득 및 착용 완료! 🎉`, 'success');
                updateShopUI();
                updateProfileUI(currentProfile);
            } catch (err) {
                console.error('칭호 구매 에러:', err);
                showToast(err.message, 'error');
            }
        }

        async function buyItem(itemId, price, emoji) {
            let leafCount = currentProfile?.leaf_balance ?? 50;
            if (leafCount < price) {
                showToast('리프가 부족합니다! 🍃 더 모아주세요.', 'error');
                return;
            }

            try {
                const token = getAuthToken();
                if (!token) throw new Error('로그인이 필요합니다.');

                const res = await fetch('/api/shop/buy', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({ item_id: itemId, price: price, emoji: emoji })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || '구매 실패');
                }

                const data = await res.json();
                
                // 구매 성공 후 프로필 업데이트 및 영구 보존
                currentProfile = data.profile;
                saveProfileCache(currentProfile);
                
                // 보유 아이템 등록
                let ownedItems = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
                if (!ownedItems.includes(itemId)) {
                    ownedItems.push(itemId);
                    localStorage.setItem('plantwiki_owned_items', JSON.stringify(ownedItems));
                }

                showToast(`[${emoji}] 구매 완료! 아바타가 변경되었습니다 🎉`, 'success');
                updateShopUI();
                updateProfileUI(currentProfile);
                
                // update global topbar profile as well
                const topbarLeaves = document.getElementById('topbar-leaves');
                const topbarAvatar = document.getElementById('topbar-avatar');
                if (topbarLeaves) topbarLeaves.innerText = currentProfile.leaf_balance;
                if (topbarAvatar) topbarAvatar.innerText = currentProfile.avatar_emoji;

            } catch (err) {
                console.error('구매 에러:', err);
                showToast(err.message, 'error');
            }
        }

        function toggleAvatarPicker() {
            const picker = document.getElementById('avatar-picker-grid');
            if (picker) picker.classList.toggle('hidden');
        }

        async function selectAvatar(emoji) {
            try {
                const res = await fetch('/api/profile/me', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ avatar_emoji: emoji })
                });
                if (res.ok) {
                    const data = await res.json();
                    currentProfile = data.data;
                    saveProfileCache(currentProfile);
                    updateProfileUI(currentProfile);
                    toggleAvatarPicker();
                    showToast(`아바타가 ${emoji}(으)로 변경되었습니다! 🌿`, 'success');
                }
            } catch (err) {
                showToast('아바타 변경에 실패했습니다.', 'error');
            }
        }

        async function saveNickname() {
            const input = document.getElementById('profile-nickname-input');
            const newNick = input ? input.value.trim() : '';
            if (!newNick) {
                showToast('닉네임을 입력해 주세요!', 'error');
                return;
            }
            try {
                const res = await fetch('/api/profile/me', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ nickname: newNick })
                });
                if (res.ok) {
                    const data = await res.json();
                    currentProfile = data.data;
                    saveProfileCache(currentProfile);
                    updateProfileUI(currentProfile);
                    showToast(`닉네임이 '${newNick}'(으)로 저장되었습니다! ✨`, 'success');
                } else {
                    const err = await res.json();
                    showToast(err.detail || '닉네임 저장에 실패했습니다.', 'error');
                }
            } catch (err) {
                showToast('닉네임 저장 중 오류가 발생했습니다.', 'error');
            }
        }

        // ============ 리프 획득 팝업 (코인 튕김 애니메이션) ============
        function showLeafPopup(amount, reason) {
            const container = document.getElementById('leaf-popup-container');
            if (!container) return;

            const reasonLabels = {
                'welcome_bonus': '🎉 신규 가입 웰컴 보너스',
                'daily_checkin': '📅 일일 출석 & 연속학습 보상',
                'plant_watered': '💧 식물 물주기 완료 보상',
                'quiz_completed': '🌱 식물 퀴즈 정답 보상',
                'shop_purchase': '🛒 꾸미기 상점 아이템 구매',
            };

            const popup = document.createElement('div');
            popup.className = 'leaf-popup';
            popup.innerHTML = `
                <span class="leaf-coin">🍃</span>
                <span>+${amount} 리프 획득!</span>
                <span class="leaf-reason">${reasonLabels[reason] || reason}</span>
            `;
            container.appendChild(popup);

            // 파티클 생성 (튀어오르는 리프 코인들)
            for (let i = 0; i < 5; i++) {
                const particle = document.createElement('span');
                particle.className = 'leaf-particle';
                particle.innerText = '🍃';
                const angle = (Math.random() - 0.5) * 60 - 30; // -60 ~ 0도
                const distance = 40 + Math.random() * 40; // 40~80px
                const tx = Math.sin(angle * Math.PI / 180) * distance;
                const ty = -Math.cos(angle * Math.PI / 180) * distance - 40;
                particle.style.setProperty('--tx', `${tx}px`);
                particle.style.setProperty('--rot', `${angle * 3}deg`);
                particle.style.left = '50%';
                particle.style.top = '50%';
                particle.style.transform = 'translate(-50%, -50%)';
                container.appendChild(particle);
                // 애니메이션 후 제거
                setTimeout(() => particle.remove(), 1200);
            }

            // 팝업 제거 (애니메이션 후)
            setTimeout(() => popup.remove(), 3000);
        }

        async function handleStreakCheckin() {
            if (!isLoggedIn()) { openAuth(); return; }
            try {
                const res = await fetch('/api/streak/checkin', {
                    method: 'POST',
                    headers: authHeaders()
                });
                const data = await res.json();
                if (data.status === 'success') {
                    currentProfile = data.profile;
                    saveProfileCache(currentProfile);
                    const streak = currentProfile?.streak_count ?? 1;

                    // 뤼튼 추천 마일스톤 출석 축하 문구
                    if (streak === 3) {
                        showToast('벌써 3일째! 작은 새싹처럼 자라나는 너의 꾸준함, 정말 멋져요! 🌱✨', 'success');
                    } else if (streak === 7) {
                        showToast('일주일 연속 출석! 푸릇푸릇한 우리 식집사, 오늘도 꽃길만 걷자구요! 🌿🌸', 'success');
                    } else if (streak === 30) {
                        showToast('한 달 동안 변함없는 사랑, 우리 식물들이 반짝반짝 빛나요! 🌟🌵 최고예요! 💚', 'success');
                    } else {
                        showToast(data.message, 'success');
                    }

                    // 리프 획득 팝업 표시
                    showLeafPopup(data.reward, 'daily_checkin');
                    updateProfileUI(currentProfile);
                    await loadLeafHistory();
                } else if (data.status === 'already_checked_in') {
                    showToast(data.message, 'info');
                } else {
                    showToast('출석 체크에 실패했습니다.', 'error');
                }
            } catch (err) {
                showToast('네트워크 오류가 발생했습니다.', 'error');
            }
        }

        async function loadLeafHistory() {
            const list = document.getElementById('leaf-history-list');
            if (!list) return;
            try {
                const res = await fetch('/api/leaf/history', { headers: authHeaders() });
                if (!res.ok) return;
                const data = await res.json();
                const rows = data.data || [];
                if (rows.length === 0) {
                    list.innerHTML = '<p class="text-muted text-center py-2">아직 리프 거래 내역이 없어요.</p>';
                    return;
                }
                const reasonLabels = {
                    'welcome_bonus': '🎉 신규 가입 웰컴 보너스',
                    'daily_checkin': '📅 일일 출석 & 연속학습 보상',
                    'plant_watered': '💧 식물 물주기 완료 보상',
                    'quiz_completed': '🌱 식물 퀴즈 정답 보상',
                    'shop_purchase': '🛒 꾸미기 상점 아이템 구매',
                };
                list.innerHTML = rows.slice(0, 10).map(r => {
                    const isPlus = r.amount > 0;
                    const dateStr = r.created_at ? r.created_at.slice(0, 10) : '';
                    return `
                    <div class="flex items-center justify-between p-2 rounded-xl" style="background: var(--tile-em-bg); border: 1px solid var(--card-border)">
                        <div>
                            <p class="font-bold text-[12px]">${reasonLabels[r.reason] || r.reason}</p>
                            <p class="text-[10px] text-muted">${dateStr}</p>
                        </div>
                        <div class="text-right">
                            <span class="font-extrabold ${isPlus ? 'text-emerald-500' : 'text-rose-500'}">
                                ${isPlus ? '+' : ''}${r.amount} 🍃
                            </span>
                            <p class="text-[10px] text-muted">잔액 ${r.balance_after}</p>
                        </div>
                    </div>`;
                }).join('');
            } catch (err) {
                console.warn('Leaf history error:', err);
            }
        }

        // 구글 OAuth 로그인
        async function signInWithGoogle() {
            try {
                showToast('Google 인증 연결 확인 중... 🌿', 'info');
                const redirectUrl = encodeURIComponent(window.location.origin);
                const res = await fetch(`/api/auth/oauth/google?redirect_to=${redirectUrl}`);
                const data = await res.json();

                if (data.status === 'ok' && data.url) {
                    window.location.href = data.url;
                    return;
                }

                if (data.status === 'provider_not_enabled') {
                    showToast(data.message || 'Google 로그인을 사용하려면 Supabase에서 Google Provider를 활성화해야 합니다.', 'error');
                    return;
                }

                // 기타 오류 시에도 quickGoogleLogin 시도하지 않음
                showToast('Google 로그인 연결에 실패했습니다.', 'error');
            } catch (err) {
                console.warn('Google sign-in error:', err);
                showToast('네트워크 오류로 Google 로그인을 시도할 수 없습니다.', 'error');
            }
        }

        async function quickGoogleLogin() {
            try {
                const res = await fetch('/api/auth/google-quick', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'success') {
                    localStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
                    localStorage.setItem(AUTH_EMAIL_KEY, data.user.email);
                    setAuthUI(data.user.email);
                    closeAuth();
                    currentProfile = data.profile;
                    updateProfileUI(currentProfile);
                    showToast('Google 계정(google.user@gmail.com)으로 로그인 완료! 🌿', 'success');
                    updateHistoryBadge();
                } else {
                    showToast('로그인 처리에 실패했습니다.', 'error');
                }
            } catch (err) {
                showToast('네트워크 오류가 발생했습니다.', 'error');
            }
        }

        function setAuthUI(email) {
            const loginBtn = document.getElementById('login-btn');
            const chip = document.getElementById('auth-user-chip');
            const logoutBtn = document.getElementById('auth-logout-btn');
            if (email) {
                loginBtn.classList.add('hidden');
                chip.classList.remove('hidden');
                logoutBtn.classList.remove('hidden');
                fetchProfile();
            } else {
                loginBtn.classList.remove('hidden');
                chip.classList.add('hidden');
                logoutBtn.classList.add('hidden');
                currentProfile = null;
            }
        }

        async function restoreAuth() {
            handleOAuthHash();
            const email = getStoredEmail();
            const token = getAuthToken();

            // 같은 기기에서 한 번이라도 로그인한 적이 있다면 0초 만에 즉시 로그인 UI 세팅!
            if (email) {
                setAuthUI(email);
            }

            if (!token && !email) return;

            // 1. 서버 세션 유효성 검사
            try {
                const res = await fetch('/api/auth/me', { headers: authHeaders() });
                if (res.ok) {
                    const body = await res.json();
                    if (body && body.user && body.user.email) {
                        saveAuthSession(token, body.user.email);
                        setAuthUI(body.user.email);
                        return;
                    }
                }

                // 2. 만약 401(토큰 만료)이면 refresh_token으로 자동 갱신 시도
                const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY) || getDeviceCookie(AUTH_REFRESH_TOKEN_KEY);
                if (refreshToken) {
                    try {
                        const rfRes = await fetch('/api/auth/refresh', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ refresh_token: refreshToken })
                        });
                        if (rfRes.ok) {
                            const rfData = await rfRes.json();
                            saveAuthSession(rfData.access_token, rfData.user.email, rfData.refresh_token);
                            setAuthUI(rfData.user.email);
                            return;
                        }
                    } catch (rfErr) {
                        console.warn('Token refresh error:', rfErr);
                    }
                }

                // 3. 토큰이 없거나 만료되었더라도, 같은 기기 디바이스 세션으로 영구 자동 복구!
                if (email) {
                    try {
                        const devRes = await fetch('/api/auth/device-session', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ device_id: getDeviceId(), email: email })
                        });
                        if (devRes.ok) {
                            const devData = await devRes.json();
                            saveAuthSession(devData.access_token, devData.user.email);
                            setAuthUI(devData.user.email);
                            return;
                        }
                    } catch (devErr) {
                        console.warn('Device session restore error:', devErr);
                    }
                }
            } catch (netErr) {
                // 오프라인이나 일시적인 네트워크 오류 시에도 로컬 로그인 상태 100% 유지!
                console.warn('Network issue during restoreAuth, keeping local session:', netErr);
                if (email) setAuthUI(email);
            }
        }

        // ============ 설정 및 환경설정 모달 ============
        function switchSettingsTab(tabName) {
            document.querySelectorAll('.settings-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
            });
            document.querySelectorAll('.settings-tab-content').forEach(content => {
                content.classList.toggle('active', content.id === `tab-${tabName}`);
            });
        }
        function openSettings() {
            const sw = document.getElementById('settings-theme-switch');
            sw.checked = document.documentElement.dataset.theme === 'dark';
            switchSettingsTab('general');
            document.getElementById('settings-modal').classList.add('open');
        }
        function closeSettings() {
            document.getElementById('settings-modal').classList.remove('open');
        }
        function closeSettingsOnBackdrop(e) {
            if (e.target === e.currentTarget) closeSettings();
        }

        // ============ 식물 MBTI 퀴즈 모달 ============
        const QUIZ_ANSWERS = { q1: null, q2: null, q3: null };
        const PLANT_RECOMMENDATIONS = {
            // 일조량 낮음 + 물 매일 + 공기정화 → 몬스테라, 선인장
            'low_daily_air': { name: '몬스테라', emoji: '🪴', reason: '어두운 곳에서도 잘 자라고 공기정화 효과가 탁월해요!' },
            'low_daily_harvest': { name: '선인장', emoji: '🌵', reason: '물 자주 안 줘도 되고 실내에서 잘 자라요!' },
            'low_daily_flower': { name: '몬스테라', emoji: '🪴', reason: '꽃은 없지만 독특한 잎 모양이 인테리어 포인트!' },

            // 일조량 낮음 + 물 주1회 + 공기정화 → 몬스테라, 로즈마리
            'low_weekly_air': { name: '몬스테라', emoji: '🪴', reason: '주 1회 물주기로 충분하고 공기정화도 잘 돼요!' },
            'low_weekly_harvest': { name: '로즈마리', emoji: '🌿', reason: '반그늘에서도 잘 자라고 요리에 쓰기 좋아요!' },
            'low_weekly_flower': { name: '몬스테라', emoji: '🪴', reason: '관리 편하고 잎이 예뻐 인테리어 식물로 최고!' },

            // 일조량 낮음 + 물 깜빡함 + 공기정화 → 선인장, 몬스테라
            'low_forgetful_air': { name: '선인장', emoji: '🌵', reason: '한 달에 1~2번 물만 줘도 튼튼하게 잘 자라요!' },
            'low_forgetful_harvest': { name: '선인장', emoji: '🌵', reason: '물 안 줘도 죽지 않는 생존왕!' },
            'low_forgetful_flower': { name: '선인장', emoji: '🌵', reason: '가끔 꽃도 피우는 신비한 매력!' },

            // 일조량 보통 + 물 매일 + 공기정화 → 바질, 몬스테라
            'medium_daily_air': { name: '바질', emoji: '🌿', reason: '밝은 곳에서 물 매일 주면 무성하게 자라 공기정화 굿!' },
            'medium_daily_harvest': { name: '바질', emoji: '🌿', reason: '자주 수확해 먹기 좋은 허브!' },
            'medium_daily_flower': { name: '바질', emoji: '🌿', reason: '꽃 피우기 전 잎이 가장 향기로워요!' },

            // 일조량 보통 + 물 주1회 + 공기정화 → 로즈마리, 몬스테라
            'medium_weekly_air': { name: '로즈마리', emoji: '🌿', reason: '주 1회 물로 충분하고 향긋한 공기정화 효과!' },
            'medium_weekly_harvest': { name: '로즈마리', emoji: '🌿', reason: '요리용 허브로 수확하며 키우는 재미!' },
            'medium_weekly_flower': { name: '로즈마리', emoji: '🌿', reason: '봄에 연보라 꽃이 피어 보는 재미까지!' },

            // 일조량 보통 + 물 깜빡함 + 공기정화 → 선인장, 몬스테라
            'medium_forgetful_air': { name: '선인장', emoji: '🌵', reason: '물 깜빡해도 끄떡없는 튼튼한 반려식물!' },
            'medium_forgetful_harvest': { name: '선인장', emoji: '🌵', reason: '관리 부담 제로로 수확(관상) 가능!' },
            'medium_forgetful_flower': { name: '선인장', emoji: '🌵', reason: '가끔 예쁜 꽃 피워주는 서프라이즈!' },

            // 일조량 높음 + 물 매일 + 공기정화 → 토마토, 고추
            'high_daily_air': { name: '토마토', emoji: '🍅', reason: '햇빛 좋아하고 물 매일 주면 공기정화도 잘 돼요!' },
            'high_daily_harvest': { name: '토마토', emoji: '🍅', reason: '직접 따 먹는 방울토마토의 달콤함!' },
            'high_daily_flower': { name: '해바라기', emoji: '🌻', reason: '해 따라 고개 돌리는 해바라기 꽃 감상!' },

            // 일조량 높음 + 물 주1회 + 공기정화 → 고추, 토마토
            'high_weekly_air': { name: '고추', emoji: '🌶️', reason: '햇빛 쨍쨍한 곳에서 주 1회 물로도 잘 자라요!' },
            'high_weekly_harvest': { name: '고추', emoji: '🌶️', reason: '매운맛 조절하며 직접 수확하는 재미!' },
            'high_weekly_flower': { name: '고추', emoji: '🌶️', reason: '하얀 꽃 피고 나서 열매 맺는 과정 감상!' },

            // 일조량 높음 + 물 깜빡함 + 공기정화 → 선인장, 해바라기
            'high_forgetful_air': { name: '선인장', emoji: '🌵', reason: '뜨거운 햇빛도 OK, 물 안 줘도 생존!' },
            'high_forgetful_harvest': { name: '감자', emoji: '🥔', reason: '심어두면 알아서 자라는 텃밭 작물!' },
            'high_forgetful_flower': { name: '해바라기', emoji: '🌻', reason: '심고 잊어도 해 따라 피는 해바라기!' },
        };
        const FALLBACK_RECOMMENDATION = { name: '몬스테라', emoji: '🪴', reason: '어디서든 잘 자라는 만능 반려식물!' };

        function openQuizModal() {
            resetQuiz();
            document.getElementById('quiz-modal').classList.add('open');
        }
        function closeQuizModal() {
            document.getElementById('quiz-modal').classList.remove('open');
        }
        function closeQuizModalOnBackdrop(e) {
            if (e.target === e.currentTarget) closeQuizModal();
        }
        function resetQuiz() {
            QUIZ_ANSWERS.q1 = null;
            QUIZ_ANSWERS.q2 = null;
            QUIZ_ANSWERS.q3 = null;
            document.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
            document.querySelectorAll('.quiz-question').forEach(q => q.classList.remove('active'));
            document.getElementById('quiz-q1').classList.add('active');
            document.getElementById('quiz-result').style.display = 'none';
            updateQuizProgress(1);
        }
        function updateQuizProgress(step) {
            const percent = Math.round((step / 3) * 100);
            document.getElementById('quiz-step-text').textContent = `${step} / 3`;
            document.getElementById('quiz-percent-text').textContent = `${percent}%`;
            document.getElementById('quiz-progress-bar').style.width = `${percent}%`;
        }
        function selectQuizOption(questionNum, value) {
            QUIZ_ANSWERS[`q${questionNum}`] = value;
            document.querySelectorAll(`#quiz-q${questionNum} .quiz-option`).forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === value);
            });
            // 다음 질문으로 자동 진행
            setTimeout(() => {
                if (questionNum < 3) {
                    document.getElementById(`quiz-q${questionNum}`).classList.remove('active');
                    document.getElementById(`quiz-q${questionNum + 1}`).classList.add('active');
                    updateQuizProgress(questionNum + 1);
                } else {
                    showQuizResult();
                }
            }, 300);
        }
        function showQuizResult() {
            document.getElementById('quiz-q3').classList.remove('active');
            const key = `${QUIZ_ANSWERS.q1}_${QUIZ_ANSWERS.q2}_${QUIZ_ANSWERS.q3}`;
            const rec = PLANT_RECOMMENDATIONS[key] || FALLBACK_RECOMMENDATION;
            document.getElementById('quiz-result-emoji').textContent = rec.emoji;
            document.getElementById('quiz-result-name').textContent = rec.name;
            document.getElementById('quiz-result-reason').textContent = rec.reason;
            document.getElementById('quiz-result').style.display = 'block';
            updateQuizProgress(3);
        }
        function goToRecommendedPlant() {
            const key = `${QUIZ_ANSWERS.q1}_${QUIZ_ANSWERS.q2}_${QUIZ_ANSWERS.q3}`;
            const rec = PLANT_RECOMMENDATIONS[key] || FALLBACK_RECOMMENDATION;
            closeQuizModal();
            quickSearch(rec.name);
        }
        function restartQuiz() {
            resetQuiz();
        }

        // ============ 뉴스레터 구독 (더미) ============
        function subscribeNewsletter(event) {
            event.preventDefault();
            const input = document.getElementById('newsletter-email');
            const email = input.value.trim();
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('올바른 이메일 주소를 입력해주세요.', 'error');
                return;
            }
            input.value = '';
            showToast(`구독 신청이 완료되었습니다! 🌿 (${email})`, 'success');
        }

        // ============ 검색 ============
        function getActiveQuery() {
            const heroInput = document.getElementById('plant-input');
            const topbarInput = document.getElementById('topbar-input');

            // 포커스된 입력창의 내용 우선
            if (document.activeElement === topbarInput && topbarInput?.value.trim()) {
                return topbarInput.value.trim();
            }
            if (document.activeElement === heroInput && heroInput?.value.trim()) {
                return heroInput.value.trim();
            }

            // 대시보드 화면이거나 결과 모드일 때는 탑바 검색창(topbar-input) 우선
            if (currentView === 'dashboard' || document.body.classList.contains('mode-results')) {
                return (topbarInput?.value.trim()) || (heroInput?.value.trim()) || '';
            }

            // 홈 화면 기본 상태일 때는 heroInput 우선, 없으면 topbarInput
            return (heroInput?.value.trim()) || (topbarInput?.value.trim()) || '';
        }

        // ============ 오늘의 추천 식물 (새로고침/방문 시마다 무작위 셔플) ============
        const RECOMMENDED_PLANTS_POOL = [
            { name: '스킨답서스', emoji: '🌿' },
            { name: '몬스테라', emoji: '🪴' },
            { name: '스투키', emoji: '🌵' },
            { name: '산세베리아', emoji: '🐍' },
            { name: '금전수', emoji: '🪙' },
            { name: '테이블야자', emoji: '🌴' },
            { name: '스파티필름', emoji: '🕊️' },
            { name: '인도고무나무', emoji: '🌳' },
            { name: '홍콩야자', emoji: '🌂' },
            { name: '싱고니움', emoji: '💚' },
            { name: '토마토', emoji: '🍅' },
            { name: '로즈마리', emoji: '🌿' },
            { name: '해바라기', emoji: '🌻' },
            { name: '바질', emoji: '🌱' },
            { name: '딸기', emoji: '🍓' },
            { name: '라벤더', emoji: '💜' }
        ];

        function renderRandomRecommendPlants() {
            const container = document.getElementById('recommended-plants-container');
            if (!container) return;

            // 무작위 셔플 후 7개 추출
            const shuffled = [...RECOMMENDED_PLANTS_POOL].sort(() => 0.5 - Math.random());
            const selected = shuffled.slice(0, 7);

            container.innerHTML = selected.map(p => `
                <button type="button" onclick="quickSearch('${p.name}')"
                        class="recommend-plant-btn flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs sm:text-sm font-semibold shadow-xs transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
                        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text);">
                    <span class="text-sm">${p.emoji}</span>
                    <span>${p.name}</span>
                </button>
            `).join('');
        }

        function quickSearch(name) {
            const heroInput = document.getElementById('plant-input');
            const topbarInput = document.getElementById('topbar-input');
            if (heroInput) heroInput.value = name;
            if (topbarInput) topbarInput.value = name;
            performSearch(name, false);
        }

        function clearInput() {
            const heroInput = document.getElementById('plant-input');
            const topbarInput = document.getElementById('topbar-input');
            if (heroInput) heroInput.value = '';
            if (topbarInput) topbarInput.value = '';
            document.body.classList.remove('typing');
            if (!document.body.classList.contains('mode-results')) {
                if (heroInput) heroInput.focus();
            } else {
                if (topbarInput) topbarInput.focus();
            }
        }

        function handleSearch(event) {
            if (event) event.preventDefault();
            let q = '';

            // 1. 전송된 폼(event.target) 내의 입력창에서 직접 추출
            if (event && event.target && event.target.querySelector) {
                const inputEl = event.target.querySelector('input[type="text"], input');
                if (inputEl && inputEl.value.trim()) {
                    q = inputEl.value.trim();
                }
            }

            // 2. 없으면 getActiveQuery()로 폴백
            if (!q) {
                q = getActiveQuery();
            }

            if (!q) {
                showToast('🌱 식물 이름을 입력해 주세요.', 'info');
                return;
            }
            performSearch(q, false);
        }

        function refreshSearch() {
            if (currentPlantName) performSearch(currentPlantName, true);
        }

        // ============ 홈 리턴 (로고 클릭 → 초기 중앙 포털 복귀) ============
        function returnHome() {
            const heroInput = document.getElementById('plant-input');
            const topbarInput = document.getElementById('topbar-input');
            if (!document.body.classList.contains('mode-results') && currentView === 'home') {
                // 이미 홈 상태면 검색창 텍스트만 정리
                if (heroInput) heroInput.value = '';
                if (topbarInput) topbarInput.value = '';
                document.body.classList.remove('typing');
                return;
            }
            // 대시보드 뷰에서 홈으로 돌아올 때
            if (currentView !== 'home') {
                currentView = 'home';
                updateNavActiveState();
                updateViewVisibility();
                if (heroInput) heroInput.value = '';
                if (topbarInput) topbarInput.value = '';
                return;
            }
            // 1) 결과 스테이지(식물 정보창 + 띠 그래프)가 아래로 페이드아웃
            document.body.classList.add('leaving');
            document.getElementById('loading-state').classList.add('hidden');
            // 2) 페이드아웃 완료 후 히어로(로고+검색창 뭉치)가 중앙으로 슬라이드 다운 복귀
            setTimeout(() => {
                document.body.classList.remove('mode-results', 'typing');
                document.body.classList.remove('leaving');
                document.getElementById('result-container').classList.add('hidden');
                if (heroInput) heroInput.value = '';
                if (topbarInput) topbarInput.value = '';
                currentPlantName = '';
                searchSeq++;                          // 진행 중이던 검색 응답 무효화
                // 뷰 상태 복원
                currentView = 'home';
                updateNavActiveState();
                updateViewVisibility();
            }, 340);
        }

        async function performSearch(plantName, forceRefresh = false) {
            const seq = ++searchSeq;
            currentPlantName = plantName;

            // 관리자 시크릿 키워드 "aaron": 일반 식물 정보는 안 뜨고, 관리자 인증 탭이 바로 열리도록 처리!
            if (plantName && plantName.trim().toLowerCase() === 'aaron') {
                const heroInput = document.getElementById('plant-input');
                const topbarInput = document.getElementById('topbar-input');
                if (heroInput) { heroInput.value = ''; heroInput.blur(); }
                if (topbarInput) { topbarInput.value = ''; topbarInput.blur(); }
                document.getElementById('loading-state')?.classList.add('hidden');
                document.querySelectorAll('.submit-btn').forEach(b => b.disabled = false);
                openAdminAuthModal();
                return;
            }

            // 대시보드 등 다른 뷰에서 검색한 경우 홈/결과 뷰로 즉시 전환
            if (currentView !== 'home') {
                currentView = 'home';
                updateNavActiveState();
                updateViewVisibility();
            }

            const heroInput = document.getElementById('plant-input');
            const topbarInput = document.getElementById('topbar-input');
            if (heroInput) heroInput.value = plantName;
            if (topbarInput) topbarInput.value = plantName;
            document.querySelectorAll('.submit-btn').forEach(b => b.disabled = true);

            // 화면 트랜지션: 히어로 → 상단 바 + 결과 스테이지 페이드인
            document.body.classList.add('mode-results');

            const loadingState = document.getElementById('loading-state');
            const resultContainer = document.getElementById('result-container');
            loadingState.classList.remove('hidden');
            resultContainer.classList.add('hidden');

            try {
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ name: plantName, force_refresh: forceRefresh })
                });
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || '검색에 실패했습니다.');
                }
                const res = await response.json();
                if (seq !== searchSeq) return;
                loadingState.classList.add('hidden');
                if (res.status === 'guardrail') {
                    showGuardrail();
                    return;
                }
                renderWikiCard(res.data, res.source);
                updateHistoryBadge();
                loadHistory();
            } catch (error) {
                if (seq !== searchSeq) return;
                loadingState.classList.add('hidden');
                showToast(`⚠️ ${error.message}`, 'error');
            } finally {
                if (seq === searchSeq) document.querySelectorAll('.submit-btn').forEach(b => b.disabled = false);
            }
        }

        function parseWateringInterval(wateringText) {
        if (!wateringText) return 0;
        const text = wateringText.toLowerCase();
        // "주 2~3회" -> 2-3일, "주 1회" -> 7일, "월 1~2회" -> 15-30일, "2일에 1번" -> 2일, "7~10일에 1번" -> 7-10일
        const weeklyMatch = text.match(/주\s*(\d+)(?:~(\d+))?\s*회/);
        if (weeklyMatch) {
            const min = parseInt(weeklyMatch[1]);
            const max = weeklyMatch[2] ? parseInt(weeklyMatch[2]) : min;
            return Math.round(7 / ((min + max) / 2));
        }
        const monthlyMatch = text.match(/월\s*(\d+)(?:~(\d+))?\s*회/);
        if (monthlyMatch) {
            const min = parseInt(monthlyMatch[1]);
            const max = monthlyMatch[2] ? parseInt(monthlyMatch[2]) : min;
            return Math.round(30 / ((min + max) / 2));
        }
        const dayMatch = text.match(/(\d+)(?:~(\d+))?\s*일(?:에\s*1번)?/);
        if (dayMatch) {
            const min = parseInt(dayMatch[1]);
            const max = dayMatch[2] ? parseInt(dayMatch[2]) : min;
            return Math.round((min + max) / 2);
        }
        // "일주일에 2~3회" 같은 패턴
        const weekKoreanMatch = text.match(/일주일(?:에)?\s*(\d+)(?:~(\d+))?\s*회/);
        if (weekKoreanMatch) {
            const min = parseInt(weekKoreanMatch[1]);
            const max = weekKoreanMatch[2] ? parseInt(weekKoreanMatch[2]) : min;
            return Math.round(7 / ((min + max) / 2));
        }
        return 0;
    }

    // ============ 결과 카드 렌더링 ============
        function renderWikiCard(data, source) {
            document.getElementById('card-emoji').innerText = data.emoji || '🌱';
            document.getElementById('card-name').innerText = data.name;
            document.getElementById('card-scientific').innerText = data.scientific_name || '';
            document.getElementById('card-summary').innerText = data.summary || '';
            document.getElementById('card-watering').innerText = data.watering || '-';
            // 물주기 D-Day 뱃지 표시
            const wateringBadge = document.getElementById('card-watering-badge');
            const interval = parseWateringInterval(data.watering);
            if (interval > 0) {
                wateringBadge.textContent = `💧 약 ${interval}일 간격`;
                wateringBadge.classList.remove('hidden');
            } else {
                wateringBadge.classList.add('hidden');
            }
            document.getElementById('card-sunlight').innerText = data.sunlight || '-';
            document.getElementById('card-temperature').innerText = data.temperature || '-';
            document.getElementById('card-difficulty').innerText = data.difficulty || '-';
            document.getElementById('card-kids-tip').innerText = data.kids_tip || '-';
            document.getElementById('card-fun-fact').innerText = data.fun_fact || '-';
            document.getElementById('card-purchase-link').href = data.detailed_url || data.purchase_url || 'https://asiaseedmall.com';
            document.getElementById('card-purchase-text').innerText = `🌱 ${data.name || '식물'} 우수 씨앗 정식 구매처 바로가기 ➡️`;
            renderPests(data.pests);
            renderBeliefGraph(data.belief_check);

            const badge = document.getElementById('card-source-badge');
            if (source === 'gemini_ai' || data.ai_generated === 1) {
                badge.innerText = "🤖 Gemini AI 실시간 생성";
                badge.style.background = 'var(--tile-purple-bg)';
                badge.style.color = 'var(--tile-purple-tx)';
            } else {
                badge.innerText = "📚 지식 도감 DB";
                badge.style.background = 'var(--tile-em-bg)';
                badge.style.color = 'var(--tile-em-tx)';
            }

            // 현재 검색 결과를 저장해둠 (도감 저장/물주기 등록에 사용)
            window._lastSearchData = data;

            // 저장 버튼 초기화
            const saveBtn = document.getElementById('btn-save-to-collection');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span>📚</span> 나의 도감에 저장하기';
                saveBtn.style.opacity = '1';
            }

            const resultContainer = document.getElementById('result-container');
            resultContainer.classList.remove('hidden');
            // 재-진입 페이드인 애니메이션 트리거
            const card = document.getElementById('wiki-card');
            card.classList.remove('anim-enter');
            void card.offsetWidth;
            card.classList.add('anim-enter');
            resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // 검색 완료 후 설문 팝업 예약 (10초 뒤, 세션당 1회)
            if (typeof scheduleSurveyPopup === 'function') scheduleSurveyPopup();
        }

        // ============ 도감에 수동 저장 ============
        async function saveToCollection() {
            const data = window._lastSearchData;
            if (!data) { showToast('저장할 식물 정보가 없습니다.', 'error'); return; }
            if (!isLoggedIn()) { openAuth(); return; }

            const btn = document.getElementById('btn-save-to-collection');
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> 저장 중...';

            try {
                const bc = data.belief_check || {};
                const res = await fetch('/api/history/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({
                        name: data.name,
                        scientific_name: data.scientific_name || '',
                        emoji: data.emoji || '🌱',
                        true_percent: bc.true_percent ?? 50,
                        false_percent: bc.false_percent ?? 50,
                    })
                });
                const result = await res.json();
                if (result.status === 'success') {
                    showToast(`📚 ${data.name}이(가) 도감에 저장되었습니다!`, 'success');
                    btn.innerHTML = '<span>✅</span> 도감에 저장 완료!';
                    btn.style.opacity = '0.7';
                    updateHistoryBadge();
                    loadHistory();
                } else {
                    throw new Error(result.detail || '저장 실패');
                }
            } catch (err) {
                showToast(`⚠️ 도감 저장 실패: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = '<span>📚</span> 나의 도감에 저장하기';
            }
        }

        // ============ 물주기 알림 등록 ============
        async function registerWateringFromResult() {
            const data = window._lastSearchData;
            if (!data) { showToast('식물 정보가 없습니다.', 'error'); return; }
            if (!isLoggedIn()) { openAuth(); return; }

            const interval = parseWateringInterval(data.watering);
            const days = interval > 0 ? interval : 7;

            const btn = document.getElementById('btn-register-watering');
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> 등록 중...';

            try {
                const res = await fetch('/api/watering/schedules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({
                        plant_name: data.name,
                        emoji: data.emoji || '🌱',
                        watering_interval_days: days,
                        notification_enabled: true,
                    })
                });
                const result = await res.json();
                if (result.status === 'success') {
                    showToast(`💧 ${data.name} 물주기 알림 등록 완료! (${days}일 간격)`, 'success');
                    btn.innerHTML = `<span>✅</span> 물주기 등록 완료! (${days}일 간격)`;
                    btn.style.opacity = '0.7';
                    // 브라우저 알림 권한 요청
                    requestNotificationPermission();
                    // 물주기 타이머 시작
                    scheduleWateringCheck();
                } else {
                    throw new Error(result.detail || '등록 실패');
                }
            } catch (err) {
                showToast(`⚠️ 물주기 등록 실패: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = '<span>💧</span> 물주기 알림 등록하기';
            }
        }

        // ============ 브라우저 알림 시스템 ============
        function requestNotificationPermission() {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(perm => {
                    if (perm === 'granted') {
                        showToast('🔔 알림 권한이 허용되었습니다!', 'success');
                    }
                });
            }
        }

        function sendBrowserNotification(title, body) {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try {
                new Notification(title, {
                    body: body,
                    icon: '/static/icons/icon-192.png',
                    badge: '/static/icons/icon-192.png',
                    tag: 'plant-watering',
                });
            } catch (e) {
                console.warn('Notification error:', e);
            }
        }

        // 물주기 확인 & 알림 발송
        async function checkWateringAndNotify() {
            if (!isLoggedIn()) return;
            try {
                const res = await fetch('/api/watering/schedules', { headers: authHeaders() });
                const result = await res.json();
                if (!result.data) return;

                const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
                const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate());

                const dueToday = result.data.filter(s => {
                    const next = new Date(s.next_water_date);
                    const diff = Math.ceil((next - today) / (86400000));
                    return diff <= 0;
                });

                if (dueToday.length > 0) {
                    const names = dueToday.map(s => `${s.emoji || '🌱'} ${s.plant_name}`).join(', ');
                    sendBrowserNotification(
                        '💧 물주기 알림!',
                        `오늘 물을 줘야 할 식물: ${names}`
                    );
                    // 화면에도 토스트 표시
                    showToast(`💧 오늘 물줄 식물이 ${dueToday.length}개 있어요!`, 'info');
                }
            } catch (e) {
                console.warn('Watering check error:', e);
            }
        }

        // 물주기 체크 스케줄러 (30분마다 체크)
        let _wateringCheckInterval = null;
        function scheduleWateringCheck() {
            if (_wateringCheckInterval) return; // 이미 실행 중
            // 즉시 한 번 체크
            checkWateringAndNotify();
            // 30분마다 반복
            _wateringCheckInterval = setInterval(checkWateringAndNotify, 30 * 60 * 1000);
        }

        // 🧠 AI 상식 정확도 판별 찬/반 띠 그래프
        function renderBeliefGraph(bc) {
            const section = document.getElementById('belief-section');
            if (!bc || typeof bc !== 'object') {
                section.classList.add('hidden');
                return;
            }
            let truePct = parseInt(bc.true_percent, 10);
            let falsePct = parseInt(bc.false_percent, 10);
            if (isNaN(truePct) || isNaN(falsePct) || truePct + falsePct !== 100) {
                truePct = 50; falsePct = 50;
            }
            document.getElementById('belief-myth').innerText = bc.myth || '알려진 재배 상식';
            document.getElementById('belief-summary').innerText = bc.summary || 'AI 분석 결과: 해당 상식을 판별했어요.';
            document.getElementById('belief-true-bar').style.width = truePct + '%';
            document.getElementById('belief-false-bar').style.width = falsePct + '%';
            document.getElementById('belief-true-label').innerText = `맞다! ${truePct}%`;
            document.getElementById('belief-false-label').innerText = `아니다! ${falsePct}%`;
            document.getElementById('belief-true-percent-text').innerText = truePct;
            document.getElementById('belief-false-percent-text').innerText = falsePct;

            const badge = document.getElementById('belief-verdict-badge');
            if (bc.verdict) {
                badge.innerText = '✅ 사실에 가깝습니다';
                badge.style.background = 'var(--tile-em-bg)';
                badge.style.color = 'var(--tile-em-tx)';
            } else {
                badge.innerText = '❌ 루머일 가능성이 높습니다';
                badge.style.background = 'var(--tile-rose-bg)';
                badge.style.color = 'var(--tile-rose-tx)';
            }
            section.classList.remove('hidden');
        }

        // 🐛 병충해 & 대처법
        function renderPests(pests) {
            const section = document.getElementById('pest-section');
            const list = document.getElementById('pest-list');
            const items = Array.isArray(pests) ? pests : [];
            if (!items.length) {
                section.classList.add('hidden');
                list.innerHTML = '';
                return;
            }
            list.innerHTML = items.map(p => `
                <div class="tile tile-rose">
                    <p class="font-bold text-sm">🐛 ${esc(p.name || '병해충')}</p>
                    ${p.symptom ? `<p class="text-xs mt-1">😰 증상 : ${esc(p.symptom)}</p>` : ''}
                    ${p.treatment ? `<p class="text-xs mt-1.5 opacity-90" style="background: var(--card-bg); border-radius: 12px; padding: 8px 10px;">🩹 대처법 : ${esc(p.treatment)}</p>` : ''}
                </div>`).join('');
            section.classList.remove('hidden');
        }

        // ============ 나의 식물 도감 (모달) ============
        function openHistoryModal() {
            loadHistory();
            document.getElementById('history-modal').classList.add('open');
        }
        function closeHistoryModal() {
            document.getElementById('history-modal').classList.remove('open');
        }
        function closeHistoryModalOnBackdrop(e) {
            if (e.target === e.currentTarget) closeHistoryModal();
        }

        // ============ 식물 가드레일 안내 (비식물 검색어 차단) ============
        function showGuardrail() {
            document.getElementById('guardrail-modal').classList.add('open');
        }
        function closeGuardrail() {
            document.getElementById('guardrail-modal').classList.remove('open');
        }
        function closeGuardrailOnBackdrop(e) {
            if (e.target === e.currentTarget) closeGuardrail();
        }
        function closeGuardrailAndReturn() {
            closeGuardrail();
            returnHome();
        }
        function viewHistoryPlant(name) {
            closeHistoryModal();
            quickSearch(name);
        }
        async function deleteHistoryPlant(id) {
            if (!confirm('정말 이 식물을 도감에서 삭제할까요?')) return;
            try {
                const response = await fetch(`/api/history/${id}`, { method: 'DELETE', headers: authHeaders() });
                if (response.ok) {
                    loadHistory();
                    updateHistoryBadge();
                }
            } catch (err) {
                showToast('삭제에 실패했습니다.', 'error');
            }
        }

        function renderHistoryRow(row) {
            const t = parseInt(row.true_percent, 10) || 0;
            const f = parseInt(row.false_percent, 10) || 0;
            const date = String(row.created_at || '').slice(0, 10);
            return `
            <div class="hist-item">
                <span class="hist-emoji">${esc(row.emoji) || '🌿'}</span>
                <div class="hist-info">
                    <div class="hist-name">${esc(row.plant_name)} ${date ? `<span class="hist-count">${esc(date)}</span>` : ''}</div>
                    <div class="hist-sci">${esc(row.scientific_name || '')}</div>
                    <div class="hist-belief"><i style="width:${t}%"></i></div>
                    <div class="text-[10px] font-bold mt-0.5" style="color:var(--muted)">✅ ${t}% · ❌ ${f}%</div>
                </div>
                <button onclick="viewHistoryPlant('${esc(row.plant_name)}')" title="다시 읽기">🔍</button>
                <button onclick="deleteHistoryPlant('${row.id}')" title="삭제">🗑️</button>
            </div>`;
        }

        function setHistoryLoginHint(show) {
            document.getElementById('history-login-hint').classList.toggle('hidden', !show);
            document.getElementById('history-empty').classList.add('hidden');
            document.getElementById('history-timeline').innerHTML = '';
        }

        async function loadHistory() {
            const timeline = document.getElementById('history-timeline');
            const empty = document.getElementById('history-empty');
            if (!getAuthToken()) {
                setHistoryLoginHint(true);
                document.getElementById('history-badge').innerText = '0';
                return;
            }
            document.getElementById('history-login-hint').classList.add('hidden');
            try {
                const response = await fetch('/api/history', { headers: authHeaders() });
                if (response.status === 401) {
                    localStorage.removeItem(AUTH_TOKEN_KEY);
                    localStorage.removeItem(AUTH_EMAIL_KEY);
                    setAuthUI(null);
                    setHistoryLoginHint(true);
                    document.getElementById('history-badge').innerText = '0';
                    return;
                }
                const res = await response.json();
                document.getElementById('history-badge').innerText = res.total;
                if (!res.data || res.data.length === 0) {
                    timeline.innerHTML = '';
                    empty.classList.remove('hidden');
                    return;
                }
                empty.classList.add('hidden');
                timeline.innerHTML = res.data.map(renderHistoryRow).join('');
            } catch (err) {
                console.error("History fetch error:", err);
            }
        }

        async function updateHistoryBadge() {
            try {
                if (!getAuthToken()) {
                    document.getElementById('history-badge').innerText = '0';
                    const dot = document.getElementById('history-count-dot');
                    dot.classList.add('hidden');
                    return;
                }
                const res = await fetch('/api/history', { headers: authHeaders() });
                const data = await res.json();
                if (res.status === 401) {
                    document.getElementById('history-badge').innerText = '0';
                    const dot = document.getElementById('history-count-dot');
                    dot.classList.add('hidden');
                    return;
                }
                document.getElementById('history-badge').innerText = data.total || 0;
                const dot = document.getElementById('history-count-dot');
                if (data.total > 0) {
                    dot.innerText = data.total;
                    dot.classList.remove('hidden');
                } else {
                    dot.classList.add('hidden');
                }
            } catch (e) {}
        }

        // ============ AI 및 클라우드 연결 상태 ============
        async function loadStatus() {
            try {
                const res = await fetch('/api/status');
                const s = await res.json();
                const el = document.getElementById('ai-status');
                if (s.ai_enabled && s.supabase_connected) {
                    el.innerText = '✨ Gemini AI & 수퍼베이스 온라인';
                    el.style.color = '#059669';
                    el.style.borderColor = 'rgba(16,185,129,0.4)';
                } else if (s.supabase_connected) {
                    el.innerText = '☁️ 수퍼베이스 클라우드 온라인';
                    el.style.color = '#059669';
                    el.style.borderColor = 'rgba(16,185,129,0.4)';
                } else if (s.ai_enabled) {
                    el.innerText = '✨ Gemini AI 온라인';
                    el.style.color = '#059669';
                    el.style.borderColor = 'rgba(16,185,129,0.4)';
                } else {
                    el.innerText = '📚 로컬 오프라인 모드';
                    el.style.color = '#d97706';
                    el.style.borderColor = 'rgba(217,119,6,0.4)';
                }
            } catch (e) {}
        }

        // ============ 트리비아 애니메이션 상태 ============
        document.addEventListener('DOMContentLoaded', () => {
            const topInput = document.getElementById('topbar-input');

            // 사용자가 입력 시작하면 상식 카드를 부드럽게 접기
            if (topInput) {
                topInput.addEventListener('focus', () => document.body.classList.add('typing'));
                topInput.addEventListener('blur', () => document.body.classList.remove('typing'));
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeHistoryModal();
                    closeSettings();
                    closeGuardrail();
                    closeAuth();
                    if (typeof closeShopModal === 'function') closeShopModal();
                }
            });

            // Initialize dashboard and bottom nav
            initDashboard();
            initBottomNav();

            setTheme(document.documentElement.dataset.theme || 'light');
            updateHistoryBadge();
            loadStatus();
            restoreAuth();
            initCrossDomainSSO();
            loadHistory();
            renderRandomRecommendPlants();

            // 물주기 알림 스케줄러 시작 (로그인 상태면)
            setTimeout(() => {
                if (isLoggedIn()) {
                    requestNotificationPermission();
                    scheduleWateringCheck();
                }
            }, 2000);
        });

        // ============ 하단 네비게이션 & 뷰 전환 ============
        let currentView = 'home'; // 'home' | 'dashboard' | 'settings'
        
        function initBottomNav() {
            // 초기 상태 설정
            updateNavActiveState();
            updateViewVisibility();
        }
        
        function switchView(viewName) {
            if (viewName === currentView) return;
            currentView = viewName;
            updateNavActiveState();
            updateViewVisibility();
            
            // 대시보드 진입 시 데이터 로드
            if (viewName === 'dashboard') {
                loadDashboard();
            }
            // 설정 진입 시 모달 열기
            if (viewName === 'settings') {
                openSettings();
                // 설정 모달 닫을 때 홈으로 복구
                setTimeout(() => {
                    if (currentView === 'settings') {
                        switchView('home');
                    }
                }, 100);
            }
        }
        
        function updateNavActiveState() {
            document.querySelectorAll('#bottom-nav .nav-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === currentView);
            });
        }
        
        function updateViewVisibility() {
            const hero = document.getElementById('hero');
            const stage = document.getElementById('stage');
            const dashboardView = document.getElementById('dashboard-view');
            
            if (currentView === 'dashboard') {
                // 대시보드 전용 뷰: 히어로 숨기고, 검색결과 숨기고, 대시보드만 표시
                document.body.classList.remove('mode-results');
                hero.style.display = 'none';
                stage.style.display = 'none';
                dashboardView.style.display = 'block';
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (currentView === 'home') {
                // 홈 뷰: 히어로만 표시, 대시보드는 숨김
                hero.style.display = '';
                stage.style.display = '';
                dashboardView.style.display = 'none';
                // mode-results 상태이면 그대로 유지 (검색 중)
                if (!document.body.classList.contains('mode-results')) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            } else {
                // settings 등
                hero.style.display = '';
                stage.style.display = '';
                dashboardView.style.display = 'none';
            }
        }
        
        // ============ 대시보드 로직 ============
        function initDashboard() {
            // 초기 상태 확인
            updateDashboardAuthState();
            loadDashboard(); // Load data on init so it's ready on home screen
        }
        
        function loadDashboard() {
            updateDashboardAuthState();
            if (isLoggedIn()) {
                loadWateringCards();
                loadNotificationStatus();
            }
        }
        
        function updateDashboardAuthState() {
            const loggedIn = isLoggedIn();
            const userEmail = localStorage.getItem(AUTH_EMAIL_KEY) || '';
            
            // 대시보드 헤더 사용자 정보
            const dashboardUserEmail = document.getElementById('dashboard-user-email');
            const dashboardLoginBtn = document.getElementById('dashboard-login-btn');
            if (loggedIn) {
                dashboardUserEmail.textContent = userEmail.split('@')[0] + '님';
                dashboardUserEmail.classList.remove('hidden');
                dashboardLoginBtn.classList.add('hidden');
            } else {
                dashboardUserEmail.classList.add('hidden');
                dashboardLoginBtn.classList.remove('hidden');
            }
            
            // 물주기 섹션 인증 게이트
            const wateringAuthGate = document.getElementById('watering-auth-gate');
            const wateringCardsContainer = document.getElementById('watering-cards-container');
            if (loggedIn) {
                wateringAuthGate.classList.add('hidden');
                wateringCardsContainer.classList.remove('hidden');
            } else {
                wateringAuthGate.classList.remove('hidden');
                wateringCardsContainer.classList.add('hidden');
            }
            
            // 알림 섹션 인증 게이트
            const notificationAuthGate = document.getElementById('notification-auth-gate');
            const notificationSettings = document.getElementById('notification-settings');
            if (loggedIn) {
                notificationAuthGate.classList.add('hidden');
                notificationSettings.classList.remove('hidden');
                
                const mToggle = document.getElementById('morning-notification-toggle');
                if (mToggle) mToggle.checked = localStorage.getItem('pwiki-morning-notif') === 'true';
                const iToggle = document.getElementById('instant-notification-toggle');
                if (iToggle) iToggle.checked = localStorage.getItem('pwiki-instant-notif') === 'true';
            } else {
                notificationAuthGate.classList.remove('hidden');
                notificationSettings.classList.add('hidden');
            }
        }
        
        // 뤼튼 추천 다정한 물주기 응원 문구 5선
        const WARM_WATERING_QUOTES = [
            "우리 초록 친구가 목말라해요. 사랑의 물 한 방울 어때요? 💧🌿",
            "물이 가득 찬 뿌리, 싱그러운 웃음이 쑥쑥 자라나요! 🌱😊",
            "식물도 사람도 촉촉하게! 오늘도 물 주기 타임이에요 💚💦",
            "초록별에게 사랑을 전하는 시간! 물주기 잊지 말아요 🌟🌵",
            "조금의 관심으로 큰 행복, 식집사님의 따뜻한 손길을 기다려요! 🤗🌿"
        ];

        function renderWarmWateringQuote() {
            const el = document.getElementById('watering-warm-quote-text');
            if (!el) return;
            const rand = WARM_WATERING_QUOTES[Math.floor(Math.random() * WARM_WATERING_QUOTES.length)];
            el.innerText = rand;
        }

        /**
         * 식물의 다음 물 주는 날짜, D-Day, 긴급도 색상 코드를 반환합니다. (ChatGPT AI 협업 모듈)
         * @param {number} intervalDays - 물 주기 간격(일수)
         * @param {string} lastWateredDate - 마지막으로 물을 준 날짜(YYYY-MM-DD)
         * @returns {{ nextWateringDate: string, dDay: string, colorCode: string, daysRemaining: number, statusClass: string }}
         */
        function getWateringStatus(intervalDays, lastWateredDate) {
            let interval = Number(intervalDays);
            if (!Number.isInteger(interval) || interval <= 0) interval = 7;

            let dateStr = (typeof lastWateredDate === 'string' && lastWateredDate) ? lastWateredDate.slice(0, 10) : '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                dateStr = new Date().toISOString().slice(0, 10);
            }

            const lastDate = new Date(`${dateStr}T00:00:00Z`);
            const MS_PER_DAY = 24 * 60 * 60 * 1000;
            const nextDate = new Date(lastDate.getTime() + interval * MS_PER_DAY);
            const nextWateringDate = nextDate.toISOString().slice(0, 10);

            const now = new Date();
            const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
            const daysRemaining = Math.round((nextDate.getTime() - today) / MS_PER_DAY);

            let dDay;
            let colorCode;
            let statusClass;

            if (daysRemaining > 0) {
                dDay = `D-${daysRemaining}`;
                colorCode = "#22C55E"; // 초록: 여유
                statusClass = "ok";
            } else if (daysRemaining === 0) {
                dDay = "D-Day";
                colorCode = "#EAB308"; // 노랑: 오늘 물 줄 날
                statusClass = "today";
            } else {
                dDay = `D+${Math.abs(daysRemaining)} 과습 주의`;
                colorCode = "#EF4444"; // 빨강: 예정일 지남
                statusClass = "overdue";
            }

            return { nextWateringDate, dDay, colorCode, daysRemaining, statusClass };
        }

        // 물주기 카드 로드
        async function loadWateringCards() {
            renderWarmWateringQuote();
            const list = document.getElementById('watering-cards-list');
            const empty = document.getElementById('watering-empty');
            
            try {
                const response = await fetch('/api/watering/schedules', { headers: authHeaders() });
                if (response.status === 401) {
                    localStorage.removeItem(AUTH_TOKEN_KEY);
                    localStorage.removeItem(AUTH_EMAIL_KEY);
                    setAuthUI(null);
                    updateDashboardAuthState();
                    return;
                }
                const res = await response.json();
                
                if (!res.data || res.data.length === 0) {
                    list.innerHTML = '';
                    empty.classList.remove('hidden');
                    return;
                }
                
                empty.classList.add('hidden');
                
                const cards = res.data.map(schedule => {
                    const interval = schedule.watering_interval_days || 7;
                    const lastDateStr = schedule.last_watered_at ? schedule.last_watered_at.slice(0, 10) : (schedule.created_at ? schedule.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
                    const status = getWateringStatus(interval, lastDateStr);
                    const progressPercent = Math.max(0, Math.min(100, 100 - (status.daysRemaining / interval * 100)));
                    
                    return `
                    <div class="watering-card" data-plant="${esc(schedule.plant_name)}">
                        <div class="watering-card-header">
                            <div class="watering-plant-info">
                                <span class="watering-plant-emoji">${esc(schedule.emoji) || '🌱'}</span>
                                <div>
                                    <div class="watering-plant-name font-bold">${esc(schedule.plant_name)}</div>
                                    <div class="text-[11px] opacity-75">다음 예정일: ${status.nextWateringDate}</div>
                                </div>
                            </div>
                            <div class="watering-d-day">
                                <span class="d-day-badge font-extrabold px-2.5 py-1 rounded-full text-xs text-white shadow-xs" style="background-color: ${status.colorCode}">
                                    ${status.dDay}
                                </span>
                            </div>
                        </div>
                        <div class="watering-progress mt-2">
                            <div class="watering-progress-bar ${status.statusClass}" style="width: ${progressPercent}%; background-color: ${status.colorCode}"></div>
                        </div>
                        <div class="watering-actions mt-3">
                            <button class="watered-btn primary" onclick="markWatered('${esc(schedule.plant_name)}')">
                                ${status.daysRemaining <= 0 ? '✅ 물 줬어요!' : '💧 물 줬어요!'}
                            </button>
                            <button class="watered-btn secondary" onclick="viewHistoryPlant('${esc(schedule.plant_name)}')">상세 보기</button>
                        </div>
                    </div>`;
                }).join('');
                
                list.innerHTML = cards;
            } catch (err) {
                console.error("Watering cards load error:", err);
                empty.classList.remove('hidden');
            }
        }
        
        // 물 주기 완료 표시
        async function markWatered(plantName) {
            if (!isLoggedIn()) { openAuth(); return; }
            
            try {
                const response = await fetch(`/api/watering/schedules/${plantName}/watered`, {
                    method: 'POST',
                    headers: authHeaders()
                });
                const res = await response.json();
                
                if (res.status === 'success') {
                    showToast(`💧 ${plantName} 물주기 완료! 다음 물주기일 갱신됨.`, 'success');
                    loadWateringCards(); // 리스트 새로고침
                    updateHistoryBadge();
                } else {
                    showToast('물주기 기록에 실패했어요.', 'error');
                }
            } catch (err) {
                showToast('물주기 기록 중 오류가 발생했습니다.', 'error');
            }
        }
        
        // 알림 상태 로드
        async function loadNotificationStatus() {
            // 실제 구현에서는 서버에서 마지막 발송일 조회
            // 여기서는 로컬스토리지 기반으로 시뮬레이션
            const badge = document.getElementById('notification-status-badge');
            const lastSent = localStorage.getItem('pwiki-last-notification-date');
            // KST (UTC+9) 기준 오늘 날짜
            const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
            const today = kstNow.toISOString().slice(0, 10);
            
            if (lastSent === today) {
                badge.className = 'notification-status-badge sent';
                badge.innerHTML = `✅ 오늘 알림 발송 완료 (마지막 발송: 오늘 오전 09:00)`;
            } else {
                badge.className = 'notification-status-badge pending';
                badge.innerHTML = `⏳ 오늘 발송된 알림 없음 (다음 알림 대기 중)`;
            }
        }
        
        // 알림 토글
        function toggleMorningNotification(enabled) {
            localStorage.setItem('pwiki-morning-notif', enabled);
            showToast(enabled ? '🌅 아침 알림이 켜졌어요 (오전 9시 발송)' : '🌅 아침 알림이 꺼졌어요', 'info');
        }
        
        function toggleInstantNotification(enabled) {
            localStorage.setItem('pwiki-instant-notif', enabled);
            showToast(enabled ? '🔔 즉시 알림이 켜졌어요' : '🔔 즉시 알림이 꺼졌어요', 'info');
        }
        
        // 기존 loadHistory 호출 시 대시보드도 업데이트
        const originalLoadHistory = loadHistory;
        loadHistory = async function() {
            await originalLoadHistory();
            if (currentView === 'dashboard' && isLoggedIn()) {
                loadWateringCards();
            }
        };

        // ============ 설문조사 ============
        const SURVEY_DONE_KEY = 'pwiki-survey-done';
        const surveyAnswers = {};   // 메모리 내 응답 저장
        let surveyPopupShown = false;

        const STAR_LABELS = ['', '매우 불만족 ⭐', '불만족 ⭐⭐', '보통 ⭐⭐⭐', '만족 ⭐⭐⭐⭐', '매우 만족 ⭐⭐⭐⭐⭐'];

        function setSurveyYN(q, v, btn) {
            surveyAnswers[q] = v;
            // 같은 그룹의 다른 버튼 비활성화
            btn.closest('.survey-btn-group').querySelectorAll('.survey-yn-btn').forEach(b => {
                b.classList.toggle('selected', b === btn);
            });
        }

        function setSurveyStar(q, v) {
            surveyAnswers[q] = v;
            const container = document.getElementById('survey-stars-' + q);
            if (!container) return;
            container.querySelectorAll('.survey-star').forEach((s, i) => {
                s.classList.toggle('filled', i < v);
            });
            const label = document.getElementById('survey-star-label-' + q);
            if (label) label.textContent = STAR_LABELS[v] || '';
        }

        function openSurveyModal() {
            const modal = document.getElementById('survey-modal');
            if (!modal) return;
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            surveyPopupShown = true;
        }

        function closeSurveyModal() {
            const modal = document.getElementById('survey-modal');
            if (!modal) return;
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }

        function closeSurveyModalOnBackdrop(e) {
            if (e.target === e.currentTarget) closeSurveyModal();
        }

        async function submitSurvey(source) {
            // 체크박스 수집
            const checkClass = source === 'popup' ? '.survey-check-popup' : '.survey-check';
            const checked = [...document.querySelectorAll(checkClass + ':checked')].map(c => c.value);
            const commentId = source === 'popup' ? 'survey-popup-comment' : 'survey-comment';
            const comment = (document.getElementById(commentId)?.value || '').trim();

            // prefix 별로 응답키 정규화
            const prefix = source === 'popup' ? 'p_' : '';
            const payload = {
                source,
                reuse:    surveyAnswers[prefix + 'reuse']    || null,
                speed:    surveyAnswers[prefix + 'speed']    || null,
                accuracy: surveyAnswers[prefix + 'accuracy'] || null,
                aihelp:   surveyAnswers[prefix + 'aihelp']   || null,
                differentiators: checked,
                comment,
                submitted_at: new Date().toISOString(),
                email: getStoredEmail() || null
            };

            // 최소 1개 이상 응답 필요
            const hasAny = payload.reuse || payload.speed || payload.accuracy || payload.aihelp || checked.length || comment;
            if (!hasAny) {
                showToast('최소 하나의 항목을 선택해 주세요! 🌱', 'error');
                return;
            }

            try {
                // Supabase에 저장 시도
                await fetch('/api/survey/submit', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) { /* 네트워크 실패 시 무시 */ }

            // 로컬에도 저장 (오프라인 대비)
            try {
                const stored = JSON.parse(localStorage.getItem(SURVEY_DONE_KEY) || '[]');
                stored.push(payload);
                localStorage.setItem(SURVEY_DONE_KEY, JSON.stringify(stored));
            } catch (e) {}

            // 완료 UI 전환
            if (source === 'popup') {
                document.getElementById('survey-popup-form')?.classList.add('hidden');
                document.getElementById('survey-popup-done')?.classList.remove('hidden');
                setTimeout(closeSurveyModal, 2000);
            } else {
                document.getElementById('survey-inline-form')?.classList.add('hidden');
                document.getElementById('survey-inline-done')?.classList.remove('hidden');
            }
            showToast('설문 제출 완료! 고마워요 🎉', 'success');
        }

        function resetSurvey() {
            // 인라인 설문 초기화
            document.getElementById('survey-inline-form')?.classList.remove('hidden');
            document.getElementById('survey-inline-done')?.classList.add('hidden');
            document.querySelectorAll('.survey-yn-btn').forEach(b => b.classList.remove('selected'));
            document.querySelectorAll('.survey-star').forEach(s => s.classList.remove('filled'));
            document.querySelectorAll('.survey-check, .survey-check-popup').forEach(c => c.checked = false);
            document.querySelectorAll('.survey-star-label').forEach(l => l.textContent = '선택하세요');
            if (document.getElementById('survey-comment')) document.getElementById('survey-comment').value = '';
            if (document.getElementById('survey-popup-comment')) document.getElementById('survey-popup-comment').value = '';
            Object.keys(surveyAnswers).forEach(k => delete surveyAnswers[k]);
        }

        // 검색 완료 후 설문 팝업 자동 트리거 (1회 검색 후 10초 뒤, 세션당 1회)
        let surveyTriggerTimer = null;
        function scheduleSurveyPopup() {
            if (surveyPopupShown) return;
            // 이미 이 세션에서 보여줬으면 스킵
            if (sessionStorage.getItem('pwiki-survey-shown')) return;
            if (surveyTriggerTimer) clearTimeout(surveyTriggerTimer);
            surveyTriggerTimer = setTimeout(() => {
                sessionStorage.setItem('pwiki-survey-shown', '1');
                openSurveyModal();
            }, 10000); // 검색 결과 표시 후 10초 뒤
        }

        // ===================== 식집사 커뮤니티 & 친구 컨트롤러 =====================
        let communityPostsData = [];
        let communityAttachedMedia = null;
        let communityAttachedMediaType = null;
        let communityFriendsCount = 0;
        let reportedPostIds = new Set();
        let activeReportPostId = null;

        function openCommunityView() {
            // 커뮤니티는 로그인 필수
            if (!isLoggedIn()) {
                showToast('커뮤니티는 로그인 후 이용하실 수 있어요! 🌱', 'info');
                openAuth();
                return;
            }

            const modal = document.getElementById('community-modal');
            if (!modal) return;
            modal.classList.add('open');
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // 친구 목록 및 피드 로드
            loadCommunityFriendsCount();
            loadCommunityPosts();
        }

        function closeCommunityView() {
            const modal = document.getElementById('community-modal');
            if (modal) {
                modal.classList.remove('open');
                modal.style.display = 'none';
            }
            document.body.style.overflow = '';
        }

        function closeCommunityOnBackdrop(e) {
            if (e.target === e.currentTarget) closeCommunityView();
        }

        function onCommunityFilterChange() {
            loadCommunityPosts();
        }

        function onCommunitySortChange() {
            loadCommunityPosts();
        }

        async function loadCommunityFriendsCount() {
            try {
                const res = await fetch('/api/community/friends', { headers: authHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    communityFriendsCount = data.total || 0;
                    const badge = document.getElementById('community-friend-count');
                    if (badge) badge.innerText = communityFriendsCount;
                }
            } catch (e) {
                console.warn('Friends count load error:', e);
            }
        }

        async function loadCommunityPosts() {
            const tag = document.getElementById('community-tag-filter')?.value || '전체';
            const sort = document.getElementById('community-sort-select')?.value || 'latest';
            const loading = document.getElementById('community-loading');
            const feedList = document.getElementById('community-feed-list');
            const emptyFeed = document.getElementById('community-empty-feed');

            if (loading) loading.classList.remove('hidden');
            if (feedList) feedList.innerHTML = '';
            if (emptyFeed) emptyFeed.classList.add('hidden');

            try {
                const url = `/api/community/posts?tag=${encodeURIComponent(tag)}&sort=${encodeURIComponent(sort)}`;
                const res = await fetch(url, { headers: authHeaders() });
                if (!res.ok) throw new Error('피드를 불러오지 못했습니다.');
                const data = await res.json();
                communityPostsData = data.data || [];

                if (loading) loading.classList.add('hidden');

                if (communityPostsData.length === 0) {
                    if (emptyFeed) emptyFeed.classList.remove('hidden');
                } else {
                    renderCommunityFeed(communityPostsData);
                }
            } catch (err) {
                console.error('Community load error:', err);
                if (loading) loading.classList.add('hidden');
                showToast(err.message || '피드 로딩 실패', 'error');
            }
        }

        function renderCommunityFeed(posts) {
            const container = document.getElementById('community-feed-list');
            if (!container) return;
            container.innerHTML = '';

            posts.forEach(post => {
                const card = document.createElement('div');
                card.className = `feed-card ${post.is_friend ? 'is-friend-post' : ''}`;
                card.id = `post-card-${post.id}`;

                // 만약 사용자가 신고 접수한 글이면 가림 처리
                if (reportedPostIds.has(post.id)) {
                    card.innerHTML = `
                        <div class="reported-placeholder">
                            <span>🚨 신고가 접수되어 검토 중인 게시글입니다.</span>
                        </div>
                    `;
                    container.appendChild(card);
                    return;
                }

                // 작성 시간 포맷
                let timeStr = '방금 전';
                if (post.created_at) {
                    try {
                        const date = new Date(post.created_at);
                        const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
                        if (diffMins < 1) timeStr = '방금 전';
                        else if (diffMins < 60) timeStr = `${diffMins}분 전`;
                        else if (diffMins < 1440) timeStr = `${Math.floor(diffMins / 60)}시간 전`;
                        else timeStr = `${Math.floor(diffMins / 1440)}일 전`;
                    } catch (e) {}
                }

                // 친구 리본
                const friendRibbon = post.is_friend
                    ? `<div class="feed-friend-ribbon"><span>🌟</span><span>내 친구의 소식</span></div>`
                    : '';

                // 미디어 (사진 또는 GIF)
                let mediaHtml = '';
                if (post.media_url) {
                    mediaHtml = `
                        <div class="feed-media-container">
                            <img src="${post.media_url}" alt="첨부 이미지" class="feed-media-img" loading="lazy">
                        </div>
                    `;
                }

                // 삭제 버튼 (본인 글일 때)
                const deleteBtn = post.is_mine
                    ? `<button type="button" onclick="handleDeleteCommunityPost('${post.id}')" class="text-xs text-red-500 hover:underline ml-1" title="게시글 삭제">삭제</button>`
                    : '';

                // 신고 버튼 (본인 글이 아닐 때)
                const reportBtn = !post.is_mine
                    ? `<button type="button" onclick="openCommunityReportModal('${post.id}', '${escapeHtml(post.author_nickname || '식집사')}')" class="feed-report-btn" title="게시글 신고"><span>🚨</span>신고</button>`
                    : '';

                // 친구 추가 or 친구 상태 뱃지 (본인 글이 아닐 때)
                let friendActionHtml = '';
                if (!post.is_mine) {
                    if (post.is_friend) {
                        friendActionHtml = `<span class="feed-friend-status" title="내 식물 친구 🌿">💚 친구</span>`;
                    } else {
                        friendActionHtml = `<button type="button" onclick="handleAddFriendFromPost('${post.user_id}', '${escapeHtml(post.author_email || '')}', '${escapeHtml(post.author_nickname || '식집사')}')" class="feed-add-friend-btn" title="친구 추가"><span>➕</span>친구추가</button>`;
                    }
                }

                // 태그 색상/텍스트
                const tag = post.tag || '자유';
                const tagColor = tag === '자랑' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' :
                                 tag === '질문' ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' :
                                 tag === '나눔' ? 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' : 'text-blue-600 bg-blue-50 dark:bg-blue-950/40';

                card.innerHTML = `
                    ${friendRibbon}
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2.5">
                            <span class="text-2xl">${post.author_avatar || '🌱'}</span>
                            <div>
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <span class="font-extrabold text-sm" style="color: var(--text);">${escapeHtml(post.author_nickname || '식집사')}</span>
                                    <span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold" style="background: var(--tile-purple-bg); color: var(--tile-purple-tx);">${escapeHtml(post.author_title || '새싹')}</span>
                                    ${post.is_mine ? '<span class="text-[9px] bg-gray-200 dark:bg-gray-700 px-1 rounded text-muted">나</span>' : ''}
                                    ${friendActionHtml}
                                </div>
                                <span class="text-[11px]" style="color: var(--muted);">${timeStr}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span class="text-[11px] font-bold px-2 py-0.5 rounded-lg ${tagColor}">#${escapeHtml(tag)}</span>
                            ${deleteBtn}
                            ${reportBtn}
                        </div>
                    </div>

                    <div class="text-sm my-2 leading-relaxed whitespace-pre-line" style="color: var(--text);">
                        ${escapeHtml(post.content || '')}
                    </div>

                    ${mediaHtml}

                    <div class="flex items-center justify-between pt-2 border-t mt-3" style="border-color: var(--card-border);">
                        <button type="button" onclick="handleCommunityLike('${post.id}', this)" class="feed-like-btn ${post.is_liked ? 'liked' : ''}">
                            <span>${post.is_liked ? '❤️' : '🤍'}</span>
                            <span class="like-count">${post.likes_count || 0}</span>
                        </button>
                        <span class="text-[11px]" style="color: var(--muted);">댓글 소통 🌿</span>
                    </div>
                `;

                container.appendChild(card);
            });
        }

        async function handleCommunityLike(postId, btn) {
            if (!isLoggedIn()) {
                showToast('로그인이 필요합니다! 🌱', 'info');
                return;
            }

            try {
                const res = await fetch(`/api/community/posts/${postId}/like`, {
                    method: 'POST',
                    headers: authHeaders()
                });
                if (res.ok) {
                    const data = await res.json();
                    btn.classList.toggle('liked', data.liked);
                    btn.querySelector('span:first-child').innerText = data.liked ? '❤️' : '🤍';
                    btn.querySelector('.like-count').innerText = data.likes_count;
                }
            } catch (e) {
                console.warn('Like error:', e);
            }
        }

        async function handleDeleteCommunityPost(postId) {
            if (!confirm('정말 이 게시글을 삭제하시겠습니까?')) return;
            try {
                const res = await fetch(`/api/community/posts/${postId}`, {
                    method: 'DELETE',
                    headers: authHeaders()
                });
                if (res.ok) {
                    showToast('게시글이 삭제되었습니다.', 'info');
                    loadCommunityPosts();
                } else {
                    const err = await res.json();
                    showToast(err.detail || '삭제 실패', 'error');
                }
            } catch (e) {
                showToast('삭제 중 오류가 발생했습니다.', 'error');
            }
        }

        // ===================== 글쓰기 모달 제어 =====================
        function openCommunityWriteModal() {
            if (!isLoggedIn()) {
                showToast('로그인 후 글을 작성할 수 있어요! 🌱', 'info');
                openAuth();
                return;
            }
            const modal = document.getElementById('community-write-modal');
            if (modal) {
                modal.classList.add('open');
                modal.style.display = 'flex';
            }
            clearCommunityMediaPreview();
            const textarea = document.getElementById('write-post-content');
            if (textarea) {
                textarea.value = '';
                document.getElementById('write-char-count').innerText = '0 / 1000';
            }
        }

        function closeCommunityWriteModal() {
            const modal = document.getElementById('community-write-modal');
            if (modal) {
                modal.classList.remove('open');
                modal.style.display = 'none';
            }
            clearCommunityMediaPreview();
        }

        function closeCommunityWriteOnBackdrop(e) {
            if (e.target === e.currentTarget) closeCommunityWriteModal();
        }

        function handleCommunityMediaSelect(event) {
            const file = event.target.files?.[0];
            if (!file) return;

            // 파일 크기 제한 (최대 4MB)
            if (file.size > 4 * 1024 * 1024) {
                showToast('이미지 및 GIF 파일은 4MB 이하만 첨부할 수 있습니다! 🌱', 'error');
                event.target.value = '';
                return;
            }

            const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
            communityAttachedMediaType = isGif ? 'gif' : 'image';

            const reader = new FileReader();
            reader.onload = function(e) {
                communityAttachedMedia = e.target.result;
                const previewBox = document.getElementById('write-media-preview-box');
                const previewImg = document.getElementById('write-media-preview-img');
                const badge = document.getElementById('write-media-preview-badge');
                if (previewBox && previewImg) {
                    previewImg.src = communityAttachedMedia;
                    previewBox.classList.remove('hidden');
                    if (badge) badge.innerText = isGif ? 'GIF' : 'IMAGE';
                }
            };
            reader.readAsDataURL(file);
        }

        function clearCommunityMediaPreview() {
            communityAttachedMedia = null;
            communityAttachedMediaType = null;
            const fileInput = document.getElementById('write-post-file');
            if (fileInput) fileInput.value = '';
            const previewBox = document.getElementById('write-media-preview-box');
            if (previewBox) previewBox.classList.add('hidden');
        }

        async function handleCommunityWriteSubmit(event) {
            event.preventDefault();
            const content = document.getElementById('write-post-content')?.value.trim();
            const tag = document.getElementById('write-post-tag')?.value || '자유';
            const submitBtn = document.getElementById('write-submit-btn');

            if (!content) {
                showToast('내용을 입력해 주세요! 🌿', 'error');
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span>🤖 AI 검토 중...</span>';
            }

            try {
                const res = await fetch('/api/community/posts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({
                        content: content,
                        tag: tag,
                        media_url: communityAttachedMedia,
                        media_type: communityAttachedMediaType
                    })
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || '게시글 등록에 실패했습니다.');
                }

                showToast(data.message || '게시글이 성공적으로 등록되었습니다! 🎉', 'success');
                closeCommunityWriteModal();
                loadCommunityPosts();

                // 글 작성 보상으로 프로필 리프 업데이트
                fetchProfile();

            } catch (err) {
                console.error('Post submit error:', err);
                showToast(err.message, 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>🚀 등록하기 (+5 🍃)</span>';
                }
            }
        }

        // ===================== 친구 관리 모달 제어 =====================
        function openCommunityFriendsModal() {
            if (!isLoggedIn()) {
                showToast('로그인 후 친구 기능을 사용할 수 있어요! 🌱', 'info');
                openAuth();
                return;
            }
            const modal = document.getElementById('community-friends-modal');
            if (modal) {
                modal.classList.add('open');
                modal.style.display = 'flex';
            }
            loadCommunityFriendsList();
        }

        function closeCommunityFriendsModal() {
            const modal = document.getElementById('community-friends-modal');
            if (modal) {
                modal.classList.remove('open');
                modal.style.display = 'none';
            }
        }

        function closeCommunityFriendsOnBackdrop(e) {
            if (e.target === e.currentTarget) closeCommunityFriendsModal();
        }

        async function loadCommunityFriendsList() {
            const container = document.getElementById('community-friends-list');
            const countLabel = document.getElementById('friends-list-count');
            if (!container) return;
            container.innerHTML = '<p class="text-xs text-center py-4 text-muted">친구 목록을 불러오는 중...</p>';

            try {
                const res = await fetch('/api/community/friends', { headers: authHeaders() });
                if (!res.ok) throw new Error('친구 목록 조회 실패');
                const data = await res.json();
                const friends = data.data || [];
                if (countLabel) countLabel.innerText = `${friends.length}명`;
                const topBadge = document.getElementById('community-friend-count');
                if (topBadge) topBadge.innerText = friends.length;

                if (friends.length === 0) {
                    container.innerHTML = '<p class="text-xs text-center py-6 text-muted">아직 등록된 친구가 없습니다.<br>위에서 친구의 이메일로 친구를 추가해 보세요! 🌿</p>';
                    return;
                }

                container.innerHTML = '';
                friends.forEach(f => {
                    const row = document.createElement('div');
                    row.className = 'flex items-center justify-between p-2.5 rounded-xl border';
                    row.style.background = 'var(--bg)';
                    row.style.borderColor = 'var(--card-border)';
                    row.innerHTML = `
                        <div class="flex items-center gap-2">
                            <span class="text-xl">${f.avatar_emoji || '🌱'}</span>
                            <div>
                                <p class="text-xs font-bold" style="color: var(--text);">${escapeHtml(f.nickname || '식집사')}</p>
                                <p class="text-[10px]" style="color: var(--muted);">${escapeHtml(f.email || '')}</p>
                            </div>
                        </div>
                        <button type="button" onclick="handleRemoveCommunityFriend('${f.id}')" class="text-[11px] text-red-500 hover:underline px-2 py-1">삭제</button>
                    `;
                    container.appendChild(row);
                });
            } catch (e) {
                container.innerHTML = '<p class="text-xs text-center py-4 text-red-500">목록을 불러오지 못했습니다.</p>';
            }
        }

        async function handleCommunityAddFriend(event) {
            event.preventDefault();
            const emailInput = document.getElementById('friend-add-email');
            const email = emailInput?.value.trim();
            if (!email) return;

            try {
                const res = await fetch('/api/community/friends/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ friend_email: email })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '친구 추가에 실패했습니다.');

                showToast(data.message || '친구 추가 완료! 🌟', 'success');
                if (emailInput) emailInput.value = '';
                loadCommunityFriendsList();
                loadCommunityPosts(); // 친구 글 최상단 재정렬
            } catch (err) {
                showToast(err.message, 'error');
            }
        }

        async function handleRemoveCommunityFriend(friendId) {
            if (!confirm('친구를 삭제하시겠습니까?')) return;
            try {
                const res = await fetch(`/api/community/friends/${friendId}`, {
                    method: 'DELETE',
                    headers: authHeaders()
                });
                if (res.ok) {
                    showToast('친구가 삭제되었습니다.', 'info');
                    loadCommunityFriendsList();
                    loadCommunityPosts();
                }
            } catch (e) {
                showToast('삭제 실패', 'error');
            }
        }

        async function handleAddFriendFromPost(friendId, friendEmail, friendNickname) {
            if (!isLoggedIn()) {
                showToast('로그인 후 친구를 추가할 수 있어요! 🌱', 'info');
                openAuth();
                return;
            }

            try {
                const res = await fetch('/api/community/friends/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ friend_id: friendId, friend_email: friendEmail })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '친구 추가에 실패했습니다.');

                showToast(data.message || `'${friendNickname}'님과 친구가 되었습니다! 🌟`, 'success');
                loadCommunityFriendsCount();
                loadCommunityPosts(); // 친구 글 최상단 재정렬
            } catch (err) {
                showToast(err.message, 'error');
            }
        }

        // ===================== 게시글 신고 모달 컨트롤러 =====================
        function openCommunityReportModal(postId, authorNickname) {
            if (!isLoggedIn()) {
                showToast('게시글을 신고하려면 로그인이 필요합니다! 🌱', 'info');
                openAuth();
                return;
            }

            activeReportPostId = postId;
            const modal = document.getElementById('community-report-modal');
            const authorSpan = document.getElementById('report-target-author');
            const postIdInput = document.getElementById('report-post-id');
            const detailsText = document.getElementById('report-details');

            if (authorSpan) authorSpan.innerText = authorNickname || '식집사';
            if (postIdInput) postIdInput.value = postId;
            if (detailsText) detailsText.value = '';

            const firstRadio = document.querySelector('input[name="report-reason"]');
            if (firstRadio) firstRadio.checked = true;

            if (modal) {
                modal.classList.add('open');
                modal.style.display = 'flex';
            }
        }

        function closeCommunityReportModal() {
            const modal = document.getElementById('community-report-modal');
            if (modal) {
                modal.classList.remove('open');
                modal.style.display = 'none';
            }
            activeReportPostId = null;
        }

        function closeCommunityReportOnBackdrop(e) {
            if (e.target && e.target.id === 'community-report-modal') {
                closeCommunityReportModal();
            }
        }

        async function handleCommunityReportSubmit(e) {
            e.preventDefault();
            const postId = document.getElementById('report-post-id')?.value || activeReportPostId;
            if (!postId) return;

            const selectedReason = document.querySelector('input[name="report-reason"]:checked')?.value || '기타 사유';
            const details = document.getElementById('report-details')?.value || '';
            const submitBtn = document.getElementById('report-submit-btn');

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerText = '신고 접수 중...';
            }

            try {
                const res = await fetch(`/api/community/posts/${postId}/report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify({ reason: selectedReason, details: details.trim() })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '신고 처리에 실패했습니다.');

                showToast(data.message || '신고가 접수되었습니다. 신속히 검토하겠습니다. 🚨', 'success');
                reportedPostIds.add(postId);
                closeCommunityReportModal();

                // 피드 가림 처리
                renderCommunityFeed(communityPostsData);
            } catch (err) {
                showToast(err.message || '신고 처리 중 오류가 발생했습니다.', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>🚨 신고 접수하기</span>';
                }
            }
        }

        // 글자수 카운터 이벤트 바인딩
        document.addEventListener('DOMContentLoaded', () => {
            const writeContent = document.getElementById('write-post-content');
            const charCount = document.getElementById('write-char-count');
            if (writeContent && charCount) {
                writeContent.addEventListener('input', () => {
                    charCount.innerText = `${writeContent.value.length} / 1000`;
                });
            }
        });

        // ===================== 노션 스타일 관리자 (Admin Workspace) =====================
        let adminSecretKeySeq = '';
        let adminSecretKeyTimer = null;
        let adminState = {
            users: [],
            search_analytics: { top_searches: [], source_breakdown: {}, recent_logs: [] },
            survey_data: { total: 0, avg_speed: 5, avg_accuracy: 5, reuse_rate: 100, responses: [] },
            reports: [],
            stats: {}
        };

        // 1. 화면 시크릿 키 입력 감지 ("화면에 aaron을 치면... 검색창이나 다른 곳에서 aaron을 치면 안 뜨게!")
        // 한글 입력기(IME: ㅁㅁㄱㅐㅜ) 및 영문(aaron), e.code(KeyA, KeyR, KeyO, KeyN) 완벽 대응
        window.addEventListener('keydown', (e) => {
            // Esc 키로 관리자 모달 닫기
            if (e.key === 'Escape') {
                const editModal = document.getElementById('notion-member-edit-modal');
                if (editModal && editModal.style.display === 'flex') {
                    closeAdminUserEditModal();
                    return;
                }
                const dashModal = document.getElementById('notion-admin-dashboard-modal');
                if (dashModal && dashModal.style.display === 'flex') {
                    closeAdminDashboardModal();
                    return;
                }
                const authModal = document.getElementById('notion-admin-auth-modal');
                if (authModal && authModal.style.display === 'flex') {
                    closeAdminAuthModal();
                    return;
                }
            }

            // 보조키(Ctrl, Alt, Meta) 제외
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            // e.code 우선 매핑 (영문/한글 자판 상태 상관없이 물리적 키보드 대응)
            const codeMap = { KeyA: 'a', KeyR: 'r', KeyO: 'o', KeyN: 'n' };
            if (codeMap[e.code]) {
                adminSecretKeySeq += codeMap[e.code];
            } else if (e.key) {
                const k = e.key.toLowerCase();
                if (k === 'ㅁ') adminSecretKeySeq += 'a';
                else if (k === 'ㄱ') adminSecretKeySeq += 'r';
                else if (k === 'ㅐ' || k === 'ㅗ') adminSecretKeySeq += 'o';
                else if (k === 'ㅜ') adminSecretKeySeq += 'n';
                else if (k.length === 1) adminSecretKeySeq += k;
            }

            clearTimeout(adminSecretKeyTimer);
            adminSecretKeyTimer = setTimeout(() => {
                adminSecretKeySeq = '';
            }, 3000);

            if (adminSecretKeySeq.endsWith('aaron')) {
                adminSecretKeySeq = '';
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    activeEl.blur();
                }
                openAdminAuthModal();
            }
        });

        // 1-2. 검색창에 "aaron" 입력 즉시 감지 (모바일 가상 키보드 및 엔터 없이도 반응)
        document.addEventListener('DOMContentLoaded', () => {
            ['plant-input', 'topbar-input'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', () => {
                        const val = el.value.trim().toLowerCase();
                        if (val === 'aaron' || val === 'ㅁㅁㄱㅐㅜ' || val === 'ㅁㅁ개ㅜ') {
                            el.value = '';
                            el.blur();
                            openAdminAuthModal();
                        }
                    });
                }
            });

            // 1-3. 모바일 편의 기능: 상단 로고 🌱 5회 연속 탭 시 관리자 인증 열기
            let logoTapCount = 0;
            let logoTapTimer = null;
            const logoEl = document.getElementById('home-logo-btn');
            if (logoEl) {
                logoEl.addEventListener('click', (e) => {
                    logoTapCount++;
                    clearTimeout(logoTapTimer);
                    logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 1500);
                    if (logoTapCount >= 5) {
                        logoTapCount = 0;
                        e.preventDefault();
                        e.stopPropagation();
                        openAdminAuthModal();
                    }
                });
            }
        });

        // 2. 관리자 인증 모달 컨트롤
        function openAdminAuthModal() {
            const modal = document.getElementById('notion-admin-auth-modal');
            const passInput = document.getElementById('notion-admin-pass');
            const errorBox = document.getElementById('notion-auth-error');
            if (modal) {
                modal.style.display = 'flex';
                if (passInput) {
                    passInput.value = '';
                    setTimeout(() => passInput.focus(), 100);
                }
                if (errorBox) errorBox.style.display = 'none';
            }
        }

        function closeAdminAuthModal() {
            const modal = document.getElementById('notion-admin-auth-modal');
            if (modal) modal.style.display = 'none';
        }

        function closeAdminAuthOnBackdrop(e) {
            if (e.target.id === 'notion-admin-auth-modal') {
                closeAdminAuthModal();
            }
        }

        async function submitAdminAuth(e) {
            if (e) e.preventDefault();
            const passInput = document.getElementById('notion-admin-pass');
            const submitBtn = document.getElementById('notion-auth-submit-btn');
            const errorBox = document.getElementById('notion-auth-error');
            const errorMsg = document.getElementById('notion-auth-error-msg');
            const passVal = passInput ? passInput.value.trim() : '';

            if (!passVal) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerText = '인증 확인 중...';
            }
            if (errorBox) errorBox.style.display = 'none';

            try {
                const res = await fetch('/api/admin/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: passVal })
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.detail || '비밀번호가 올바르지 않습니다.');
                }

                // 인증 성공
                sessionStorage.setItem('plant_admin_token', data.admin_token || 'verified');
                closeAdminAuthModal();
                openAdminDashboardModal();
                showToast('🔐 관리자 워크스페이스에 접속했습니다.', 'success');
            } catch (err) {
                if (errorBox && errorMsg) {
                    errorMsg.innerText = err.message || '인증에 실패했습니다.';
                    errorBox.style.display = 'flex';
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '워크스페이스 열기 →';
                }
            }
        }

        // 3. 관리자 대시보드 모달 컨트롤
        function openAdminDashboardModal() {
            const modal = document.getElementById('notion-admin-dashboard-modal');
            if (modal) {
                modal.style.display = 'flex';
                loadAdminDashboardData();
            }
        }

        function closeAdminDashboardModal() {
            const modal = document.getElementById('notion-admin-dashboard-modal');
            if (modal) modal.style.display = 'none';
        }

        function closeAdminDashboardOnBackdrop(e) {
            if (e.target.id === 'notion-admin-dashboard-modal') {
                closeAdminDashboardModal();
            }
        }

        // 4. 대시보드 데이터 로드
        async function loadAdminDashboardData() {
            try {
                const res = await fetch('/api/admin/dashboard');
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '대시보드 데이터를 불러오지 못했습니다.');

                adminState.users = data.users || [];
                adminState.search_analytics = data.search_analytics || { top_searches: [], source_breakdown: {}, recent_logs: [] };
                adminState.survey_data = data.survey_data || { total: 0, avg_speed: 5, avg_accuracy: 5, reuse_rate: 100, responses: [] };
                adminState.reports = data.reports || [];
                adminState.stats = data.stats || {};

                // 상단 프로퍼티 업데이트
                document.getElementById('notion-stat-users').innerText = `${adminState.stats.total_users || adminState.users.length}명`;
                document.getElementById('notion-stat-searches').innerText = `${(adminState.stats.total_searches || 0).toLocaleString()}회`;
                document.getElementById('notion-stat-surveys').innerText = `${adminState.stats.total_surveys || adminState.survey_data.total}건`;
                document.getElementById('notion-stat-leaves').innerText = `${(adminState.stats.total_leaves || 0).toLocaleString()} 잎`;

                // 탭 뱃지 카운트
                document.getElementById('notion-tab-user-count').innerText = adminState.users.length;
                document.getElementById('notion-tab-survey-count').innerText = adminState.survey_data.responses ? adminState.survey_data.responses.length : 0;
                document.getElementById('notion-tab-report-count').innerText = adminState.reports.length;

                // 각 탭 렌더링
                renderAdminUsers(adminState.users);
                renderAdminSearchAnalytics(adminState.search_analytics, adminState.stats);
                renderAdminSurveys(adminState.survey_data);
                renderAdminReports(adminState.reports);

            } catch (err) {
                console.error('Admin Dashboard Load Error:', err);
                showToast(err.message || '데이터 로드 실패', 'error');
            }
        }

        // 5. 탭 전환
        function switchAdminTab(tabName) {
            const tabs = ['users', 'search', 'surveys', 'reports', 'summary'];
            tabs.forEach(t => {
                const panel = document.getElementById(`notion-tab-panel-${t}`);
                if (panel) panel.style.display = (t === tabName) ? 'block' : 'none';
            });

            // 탭 버튼 active 클래스 토글
            const buttons = document.querySelectorAll('.notion-tabs-nav .notion-tab-btn');
            buttons.forEach(btn => {
                const onclickAttr = btn.getAttribute('onclick') || '';
                if (onclickAttr.includes(`'${tabName}'`)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        // 6. 회원 관리 탭 렌더링 & 검색
        function getTitleTagClass(title) {
            if (!title) return 'notion-tag-gray';
            if (title.includes('새싹')) return 'notion-tag-green';
            if (title.includes('정원사')) return 'notion-tag-blue';
            if (title.includes('박사')) return 'notion-tag-purple';
            if (title.includes('마스터') || title.includes('왕')) return 'notion-tag-yellow';
            if (title.includes('그리너') || title.includes('요정')) return 'notion-tag-green';
            return 'notion-tag-blue';
        }

        function renderAdminUsers(usersList) {
            const tbody = document.getElementById('notion-users-tbody');
            const countEl = document.getElementById('notion-filtered-users-count');
            if (countEl) countEl.innerText = usersList.length;
            if (!tbody) return;

            if (!usersList || usersList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:#787774;">일치하는 회원이 없습니다.</td></tr>`;
                return;
            }

            tbody.innerHTML = usersList.map(u => {
                const userId = u.id || '-';
                const shortId = userId.length > 14 ? (userId.slice(0, 8) + '...' + userId.slice(-4)) : userId;
                const dateStr = u.created_at ? u.created_at.split('T')[0] : '2026-10-17';
                const tagClass = getTitleTagClass(u.title);

                return `
                    <tr>
                        <td>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:1.15rem;">${u.avatar_emoji || '🌱'}</span>
                                <span style="font-weight:600; color:#37352f;">${escapeHtml(u.nickname || '식집사')}</span>
                            </div>
                        </td>
                        <td>
                            <span class="notion-tag ${tagClass}">${escapeHtml(u.title || '새싹')}</span>
                        </td>
                        <td>
                            <span style="font-weight:700; color:#2b783c;">🍃 ${(u.leaf_balance || 0).toLocaleString()}</span>
                        </td>
                        <td>
                            <span style="font-weight:600; color:#d97706;">🔥 ${u.streak_count || 1}일</span>
                        </td>
                        <td>
                            <code style="font-family:monospace; font-size:0.75rem; color:#787774; background:#f7f6f3; padding:2px 6px; border-radius:4px;" title="${escapeHtml(userId)}">${escapeHtml(shortId)}</code>
                        </td>
                        <td style="color:#787774; font-size:0.78rem;">
                            ${dateStr}
                        </td>
                        <td style="text-align:center;">
                            <button type="button" class="notion-btn notion-btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="openAdminUserEditModal('${escapeHtml(userId)}')">
                                ✏️ 수정
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function filterAdminUsers() {
            const filterInput = document.getElementById('notion-user-filter-input');
            const q = filterInput ? filterInput.value.trim().toLowerCase() : '';
            if (!q) {
                renderAdminUsers(adminState.users);
                return;
            }
            const filtered = adminState.users.filter(u => {
                const name = (u.nickname || '').toLowerCase();
                const title = (u.title || '').toLowerCase();
                const id = (u.id || '').toLowerCase();
                const email = (u.email || '').toLowerCase();
                return name.includes(q) || title.includes(q) || id.includes(q) || email.includes(q);
            });
            renderAdminUsers(filtered);
        }

        // 7. 회원 정보 수정 모달 (리프, 닉네임, 칭호)
        function openAdminUserEditModal(userId) {
            const user = adminState.users.find(u => u.id === userId);
            if (!user) {
                showToast('회원 정보를 찾을 수 없습니다.', 'error');
                return;
            }

            document.getElementById('notion-edit-target-id').value = user.id;
            document.getElementById('notion-edit-user-id').innerText = `ID: ${user.id} (${user.email || '게스트'})`;
            document.getElementById('notion-edit-nickname').value = user.nickname || '';
            document.getElementById('notion-edit-leaf').value = user.leaf_balance != null ? user.leaf_balance : 50;

            const titlePreset = document.getElementById('notion-edit-title-preset');
            const customTitleInput = document.getElementById('notion-edit-title-custom');
            const currentTitle = user.title || '새싹';

            const presetOptions = ['새싹', '정원사', '식물박사', '그리너', '플랜트마스터', '숲의 요정'];
            if (presetOptions.includes(currentTitle)) {
                titlePreset.value = currentTitle;
                customTitleInput.style.display = 'none';
                customTitleInput.value = '';
            } else {
                titlePreset.value = 'custom';
                customTitleInput.style.display = 'block';
                customTitleInput.value = currentTitle;
            }

            const modal = document.getElementById('notion-member-edit-modal');
            if (modal) modal.style.display = 'flex';
        }

        function closeAdminUserEditModal() {
            const modal = document.getElementById('notion-member-edit-modal');
            if (modal) modal.style.display = 'none';
        }

        function closeAdminUserEditOnBackdrop(e) {
            if (e.target.id === 'notion-member-edit-modal') {
                closeAdminUserEditModal();
            }
        }

        function onTitlePresetChange(val) {
            const customInput = document.getElementById('notion-edit-title-custom');
            if (!customInput) return;
            if (val === 'custom') {
                customInput.style.display = 'block';
                customInput.focus();
            } else {
                customInput.style.display = 'none';
                customInput.value = '';
            }
        }

        function adjustEditLeaf(delta) {
            const leafInput = document.getElementById('notion-edit-leaf');
            if (!leafInput) return;
            const current = parseInt(leafInput.value || 0, 10);
            leafInput.value = Math.max(0, current + delta);
        }

        async function submitAdminUserEdit(e) {
            if (e) e.preventDefault();
            const targetId = document.getElementById('notion-edit-target-id').value;
            const nickname = document.getElementById('notion-edit-nickname').value.trim();
            const presetVal = document.getElementById('notion-edit-title-preset').value;
            const customVal = document.getElementById('notion-edit-title-custom').value.trim();
            const title = (presetVal === 'custom') ? (customVal || '새싹') : presetVal;
            const leaf = parseInt(document.getElementById('notion-edit-leaf').value || 0, 10);
            const saveBtn = document.getElementById('notion-edit-save-btn');

            if (!targetId || !nickname) {
                showToast('닉네임을 입력해 주세요.', 'error');
                return;
            }

            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerText = '저장 중...';
            }

            try {
                const res = await fetch('/api/admin/user/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_id: targetId,
                        nickname: nickname,
                        title: title,
                        leaf_balance: leaf
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '회원 정보 수정에 실패했습니다.');

                showToast(data.message || '회원 정보가 성공적으로 변경되었습니다. 💾', 'success');

                // 로컬 상태 동기화
                const userIdx = adminState.users.findIndex(u => u.id === targetId);
                if (userIdx >= 0) {
                    adminState.users[userIdx] = { ...adminState.users[userIdx], ...data.user };
                }

                // 현재 접속 중인 사용자가 수정된 본인인 경우 앱 UI 갱신
                if (currentUser && currentUser.id === targetId) {
                    currentUser.nickname = nickname;
                    currentUser.title = title;
                    currentUser.leaf_balance = leaf;
                    updateProfileUI(currentUser);
                }

                filterAdminUsers();
                closeAdminUserEditModal();
            } catch (err) {
                showToast(err.message || '오류가 발생했습니다.', 'error');
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerText = '💾 저장하기';
                }
            }
        }

        // 8. 검색도 & 키워드 분석 탭 렌더링
        function renderAdminSearchAnalytics(analytics, stats) {
            const topSearches = analytics.top_searches || [];
            const breakdown = analytics.source_breakdown || {};
            const recentLogs = analytics.recent_logs || [];

            // KPI
            const totalSearches = stats.total_searches || 0;
            document.getElementById('notion-search-kpi-total').innerText = `${totalSearches.toLocaleString()}회`;
            document.getElementById('notion-search-kpi-top1').innerText = topSearches.length > 0 ? `🌱 ${topSearches[0].query}` : '몬스테라';

            const aiCount = breakdown['gemini_ai'] || 0;
            const aiRate = totalSearches > 0 ? Math.round((aiCount / totalSearches) * 100) : 65;
            document.getElementById('notion-search-kpi-airate').innerText = `${aiRate}%`;

            // 검색도 순위 (TOP 10)
            const topListEl = document.getElementById('notion-top-searches-list');
            if (topListEl) {
                if (topSearches.length === 0) {
                    topListEl.innerHTML = `<p style="font-size:0.8rem; color:#787774; text-align:center; padding:16px;">수집된 검색어가 없습니다.</p>`;
                } else {
                    const maxCount = Math.max(...topSearches.map(s => s.count), 1);
                    topListEl.innerHTML = topSearches.map((s, idx) => {
                        const pct = Math.max(14, Math.round((s.count / maxCount) * 100));
                        return `
                            <div class="notion-ranking-item">
                                <span class="notion-ranking-rank">${idx + 1}</span>
                                <span class="notion-ranking-name">🌿 ${escapeHtml(s.query)}</span>
                                <div class="notion-ranking-bar-wrapper">
                                    <div class="notion-ranking-bar" style="width: ${pct}%;"></div>
                                </div>
                                <span class="notion-ranking-count">${s.count}회</span>
                            </div>
                        `;
                    }).join('');
                }
            }

            // 소스 점유율
            const breakdownListEl = document.getElementById('notion-source-breakdown-list');
            if (breakdownListEl) {
                const sourceNames = {
                    'plant_directory': { label: '📖 대표 식물 도감', tag: 'notion-tag-green' },
                    'gemini_ai': { label: '🤖 Gemini AI 탐구', tag: 'notion-tag-purple' },
                    'knowledge_base': { label: '📚 로컬 지식베이스', tag: 'notion-tag-blue' }
                };

                const totalSource = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
                const sourceKeys = Object.keys(breakdown).length > 0 ? Object.keys(breakdown) : ['plant_directory', 'gemini_ai', 'knowledge_base'];

                breakdownListEl.innerHTML = sourceKeys.map(key => {
                    const cnt = breakdown[key] || 1;
                    const info = sourceNames[key] || { label: key, tag: 'notion-tag-gray' };
                    const pct = Math.round((cnt / totalSource) * 100);
                    return `
                        <div class="notion-ranking-item">
                            <span class="notion-tag ${info.tag}">${info.label}</span>
                            <div class="notion-ranking-bar-wrapper" style="margin: 0 16px;">
                                <div class="notion-ranking-bar" style="width:${pct}%; background:#2b783c;"></div>
                            </div>
                            <span class="notion-ranking-count">${cnt}회 (${pct}%)</span>
                        </div>
                    `;
                }).join('');
            }

            // 실시간 검색 로그 테이블
            const logsTbody = document.getElementById('notion-search-logs-tbody');
            if (logsTbody) {
                if (recentLogs.length === 0) {
                    logsTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#787774;">기록된 검색 로그가 없습니다.</td></tr>`;
                } else {
                    logsTbody.innerHTML = recentLogs.map(log => {
                        let sourceTag = 'notion-tag-gray';
                        let sourceName = log.source || 'gemini_ai';
                        if (sourceName === 'gemini_ai') { sourceTag = 'notion-tag-purple'; sourceName = '🤖 Gemini AI'; }
                        else if (sourceName === 'plant_directory') { sourceTag = 'notion-tag-green'; sourceName = '🌱 대표 도감'; }
                        else if (sourceName === 'knowledge_base') { sourceTag = 'notion-tag-blue'; sourceName = '📚 지식베이스'; }

                        const timeStr = log.timestamp ? log.timestamp.replace('T', ' ').slice(5, 19) : '-';

                        return `
                            <tr>
                                <td style="font-weight:600; color:#37352f;">🌿 ${escapeHtml(log.query || '-')}</td>
                                <td><span class="notion-tag ${sourceTag}">${sourceName}</span></td>
                                <td style="color:#787774; font-family:monospace; font-size:0.75rem;">${escapeHtml(log.user_id || '익명')}</td>
                                <td style="color:#787774; font-size:0.76rem;">${timeStr}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        }

        // 9. 설문조사 결과 탭 렌더링 (실제 데이터 연동)
        function renderAdminSurveys(surveyData) {
            const responses = surveyData.responses || [];
            const hasData = responses.length > 0;

            document.getElementById('notion-survey-kpi-reuse').innerText = hasData ? `${surveyData.reuse_rate || 0}%` : '0%';
            document.getElementById('notion-survey-kpi-speed').innerText = hasData ? `${surveyData.avg_speed || 0} / 5.0` : '- / 5.0';
            document.getElementById('notion-survey-kpi-accuracy').innerText = hasData ? `${surveyData.avg_accuracy || 0} / 5.0` : '- / 5.0';

            const tbody = document.getElementById('notion-survey-tbody');
            if (!tbody) return;

            if (!hasData) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; padding:36px 20px; color:#787774;">
                            <div style="font-size:1.8rem; margin-bottom:8px;">📭</div>
                            <div style="font-weight:700; font-size:0.95rem; color:#37352f; margin-bottom:4px;">아직 접수된 설문 응답이 없습니다. (0건)</div>
                            <div style="font-size:0.75rem; color:#9b9a97; margin-bottom:14px;">웹사이트 내 설문 팝업이나 인라인 폼을 통해 제출되면 실시간으로 여기에 누적됩니다.</div>
                            <a href="https://forms.gle/dFwphnR5MTwhUrwP9" target="_blank" rel="noopener noreferrer"
                               class="notion-btn notion-btn-secondary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                                📋 구글 폼 설문지 응답 확인하기 ↗
                            </a>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = responses.map(r => {
                const submittedAt = r.submitted_at ? r.submitted_at.replace('T', ' ').slice(5, 16) : '-';
                const reuseBadge = r.reuse === 'yes'
                    ? '<span class="notion-tag notion-tag-green">✅ 또 쓸래요</span>'
                    : '<span class="notion-tag notion-tag-red">❌ 아니요</span>';

                const speedStars = '⭐'.repeat(r.speed || 5);
                const accStars = '⭐'.repeat(r.accuracy || 5);

                let aiBadge = '<span class="notion-tag notion-tag-gray">-</span>';
                if (r.aihelp === 'yes') aiBadge = '<span class="notion-tag notion-tag-purple">🌟 더 도움됨</span>';
                else if (r.aihelp === 'same') aiBadge = '<span class="notion-tag notion-tag-blue">😐 비슷함</span>';
                else if (r.aihelp === 'no') aiBadge = '<span class="notion-tag notion-tag-yellow">🤔 일반 검색</span>';

                const commentText = r.comment || r.comments;
                const comment = commentText ? escapeHtml(commentText) : '<span style="color:#9b9a97; font-style:italic;">(의견 없음)</span>';

                return `
                    <tr>
                        <td style="color:#787774; font-size:0.76rem;">${submittedAt}</td>
                        <td><span class="notion-tag notion-tag-gray">${escapeHtml(r.source || '일반')}</span></td>
                        <td>${reuseBadge}</td>
                        <td style="font-size:0.75rem;">${speedStars}</td>
                        <td style="font-size:0.75rem;">${accStars}</td>
                        <td>${aiBadge}</td>
                        <td style="line-height:1.4; color:#37352f;">
                            <div style="background:#fbfbfa; border:1px solid #f1f0ec; padding:6px 10px; border-radius:6px; font-size:0.78rem;">
                                ${comment}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // 10. 커뮤니티 신고 탭 렌더링 & 처리
        function renderAdminReports(reports) {
            const tbody = document.getElementById('notion-reports-tbody');
            if (!tbody) return;

            if (!reports || reports.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#787774;">접수된 신고가 없습니다. 깨끗한 커뮤니티입니다! 🌱</td></tr>`;
                return;
            }

            tbody.innerHTML = reports.map(r => {
                let statusTag = '<span class="notion-tag notion-tag-yellow">대기 중</span>';
                if (r.status === 'resolved') statusTag = '<span class="notion-tag notion-tag-green">해결됨</span>';
                else if (r.status === 'post_deleted') statusTag = '<span class="notion-tag notion-tag-red">게시글 삭제됨</span>';

                const timeStr = r.created_at ? r.created_at.replace('T', ' ').slice(5, 16) : '-';
                const reporterId = r.reporter_id ? (r.reporter_id.slice(0, 8) + '...') : '익명';

                return `
                    <tr>
                        <td>${statusTag}</td>
                        <td style="font-weight:600; color:#cf222e;">${escapeHtml(r.reason || '신고')}</td>
                        <td style="font-size:0.78rem; color:#55534e;">${escapeHtml(r.details || '(상세 내용 없음)')}</td>
                        <td style="font-family:monospace; font-size:0.75rem; color:#787774;">${escapeHtml(reporterId)}</td>
                        <td style="font-size:0.76rem; color:#787774;">${timeStr}</td>
                        <td style="text-align:center;">
                            <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                                <button type="button" class="notion-btn notion-btn-secondary" style="padding:4px 8px; font-size:0.72rem;" onclick="adminReportAction('${escapeHtml(r.id)}', 'resolve')">
                                    ✅ 해결
                                </button>
                                <button type="button" class="notion-btn notion-btn-danger" style="padding:4px 8px; font-size:0.72rem;" onclick="adminReportAction('${escapeHtml(r.id)}', 'delete_post')">
                                    🗑️ 글 삭제
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        async function adminReportAction(reportId, action) {
            const confirmMsg = action === 'delete_post'
                ? '정말로 해당 게시글을 삭제하고 신고를 종결하시겠습니까?'
                : '해당 신고를 처리 완료(해결됨) 상태로 변경하시겠습니까?';

            if (!confirm(confirmMsg)) return;

            try {
                const res = await fetch('/api/admin/report/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ report_id: reportId, action: action })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || '신고 처리에 실패했습니다.');

                showToast(data.message || '신고 조치가 완료되었습니다.', 'success');
                loadAdminDashboardData();
            } catch (err) {
                showToast(err.message || '오류가 발생했습니다.', 'error');
            }
        }



