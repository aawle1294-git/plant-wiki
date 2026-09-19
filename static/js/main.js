        let currentPlantName = "";
        let deferredPrompt = null;
        let searchSeq = 0;

        // ============ 유틸 ============
        function esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

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

        // ============ 수퍼베이스 클라우드 로그인 / 회원가입 ============
        const AUTH_TOKEN_KEY = 'pwiki-sb-token';
        const AUTH_EMAIL_KEY = 'pwiki-sb-email';
        let authMode = 'login';

        function getAuthToken() { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; }
        function isLoggedIn() { return !!getAuthToken(); }
        function authHeaders() {
            const t = getAuthToken();
            return t ? { 'Authorization': 'Bearer ' + t } : {};
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
            if (logged) document.getElementById('auth-logged-email').innerText = localStorage.getItem(AUTH_EMAIL_KEY) || '';
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
                        localStorage.setItem(AUTH_TOKEN_KEY, body.access_token);
                        localStorage.setItem(AUTH_EMAIL_KEY, body.user.email);
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
                localStorage.setItem(AUTH_TOKEN_KEY, body.access_token);
                localStorage.setItem(AUTH_EMAIL_KEY, body.user.email);
                setAuthUI(body.user.email);
                closeAuth();
                showToast('로그인되었습니다! 🌿', 'success');
                updateHistoryBadge();
            } catch (err) { showAuthError('네트워크 오류가 발생했습니다.'); }
        }

        function logoutAuth() {
            localStorage.removeItem(AUTH_TOKEN_KEY);
            localStorage.removeItem(AUTH_EMAIL_KEY);
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

            // 1) URL 해시에서 토큰 추출 (#access_token=...)
            if (window.location.hash) {
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                accessToken = params.get('access_token');
                console.log('[OAuth Debug] Token from hash:', accessToken ? 'Found' : 'Not found');
            }

            // 2) 쿼리 파라미터에서 토큰 추출 (?access_token=...)
            if (!accessToken && window.location.search) {
                const params = new URLSearchParams(window.location.search);
                accessToken = params.get('access_token');
                console.log('[OAuth Debug] Token from query:', accessToken ? 'Found' : 'Not found');
            }

            if (accessToken) {
                console.log('[OAuth Debug] Saving token to localStorage');
                localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
                // URL 정리
                history.replaceState(null, null, window.location.pathname);
                showToast('Google 로그인 처리 중... 🌿', 'info');
            } else if (fullUrl.includes('access_token') || fullUrl.includes('error')) {
                // 토큰이 URL에 있긴 한데 파싱 실패한 경우
                console.warn('[OAuth Debug] URL contains token-like params but parsing failed');
                console.warn('[OAuth Debug] Full URL:', fullUrl);
            }
        }

        async function fetchProfile() {
            if (!isLoggedIn()) return;
            try {
                const res = await fetch('/api/profile/me', { headers: authHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        currentProfile = data.data;
                        updateProfileUI(currentProfile);
                    }
                }
            } catch (err) {
                console.warn('Profile fetch error:', err);
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

            // 2. 프로필 모달 내부 반영
            const modalAvatar = document.getElementById('profile-avatar-display');
            const nickInput = document.getElementById('profile-nickname-input');
            const emailDisp = document.getElementById('profile-email-display');
            const leafCount = document.getElementById('profile-leaf-count');
            const streakCount = document.getElementById('profile-streak-count');

            if (modalAvatar) modalAvatar.innerText = profile.avatar_emoji || '🌱';
            if (nickInput && document.activeElement !== nickInput) nickInput.value = profile.nickname || '새싹 식집사';
            if (emailDisp) emailDisp.innerText = profile.email || '';
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

        function updateShopUI() {
            // 현재 리프 업데이트
            const leafCount = currentProfile?.leaf_balance ?? 50;
            document.getElementById('shop-my-leaves').innerText = leafCount;

            // 이미 구매한 아이템 체크 (로컬 스토리지 활용)
            const ownedItems = JSON.parse(localStorage.getItem('plantwiki_owned_items') || '[]');
            
            document.querySelectorAll('.shop-item-card button').forEach(btn => {
                const onclickAttr = btn.getAttribute('onclick');
                if (onclickAttr) {
                    const itemIdMatch = onclickAttr.match(/'([^']+)'/);
                    if (itemIdMatch && ownedItems.includes(itemIdMatch[1])) {
                        btn.innerText = '보유함';
                        btn.classList.add('owned');
                        btn.disabled = true;
                        btn.removeAttribute('onclick');
                    }
                }
            });
        }

        async function buyItem(itemId, price, emoji) {
            let leafCount = currentProfile?.leaf_balance ?? 50;
            if (leafCount < price) {
                showToast('리프가 부족합니다! 🍃 더 모아주세요.', 'error');
                return;
            }

            try {
                const token = localStorage.getItem('plantwiki_token');
                if (!token) throw new Error('로그인이 필요합니다.');

                const res = await fetch('/api/shop/buy', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ item_id: itemId, price: price, emoji: emoji })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || '구매 실패');
                }

                const data = await res.json();
                
                // 구매 성공 후 프로필 업데이트
                currentProfile = data.profile;
                
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
                    showToast(data.message, 'success');
                    // 리프 획득 팝업 표시
                    showLeafPopup(data.reward, 'daily_checkin');
                    currentProfile = data.profile;
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
            if (!getAuthToken()) return;
            try {
                const res = await fetch('/api/auth/me', { headers: authHeaders() });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: '세션이 만료되었습니다.' }));
                    localStorage.removeItem(AUTH_TOKEN_KEY);
                    localStorage.removeItem(AUTH_EMAIL_KEY);
                    setAuthUI(null);
                    showToast(`로그인 만료: ${err.detail}`, 'error');
                    return;
                }
                const body = await res.json();
                setAuthUI(body.user.email);
            } catch (e) {
                localStorage.removeItem(AUTH_TOKEN_KEY);
                localStorage.removeItem(AUTH_EMAIL_KEY);
                setAuthUI(null);
                showToast('연결 오류로 로그인 상태를 복구할 수 없습니다.', 'error');
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
            if (!document.body.classList.contains('mode-results') && heroInput) {
                return heroInput.value.trim();
            }
            return topbarInput ? topbarInput.value.trim() : '';
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
            event.preventDefault();
            const q = getActiveQuery();
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
            loadHistory();

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
        
        // 물주기 카드 로드
        async function loadWateringCards() {
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
                
                // KST (UTC+9) 기준 오늘 날짜 계산 (백엔드와 동일하게)
                const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
                const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate());
                
                const cards = res.data.map(schedule => {
                    const interval = schedule.watering_interval_days || 7;
                    const nextWatering = new Date(schedule.next_water_date);
                    const diffDays = Math.ceil((nextWatering - today) / (1000 * 60 * 60 * 24));
                    
                    let dDayClass = 'ok';
                    let dDayText = '';
                    if (diffDays < 0) { dDayClass = 'overdue'; dDayText = `${Math.abs(diffDays)}일 지남`; }
                    else if (diffDays === 0) { dDayClass = 'today'; dDayText = 'D-Day!'; }
                    else if (diffDays <= 2) { dDayClass = 'soon'; dDayText = `D-${diffDays}`; }
                    else { dDayClass = 'ok'; dDayText = `D-${diffDays}`; }
                    
                    const progressPercent = Math.max(0, Math.min(100, 100 - (diffDays / interval * 100)));
                    
                    return `
                    <div class="watering-card" data-plant="${esc(schedule.plant_name)}">
                        <div class="watering-card-header">
                            <div class="watering-plant-info">
                                <span class="watering-plant-emoji">${esc(schedule.emoji) || '🌱'}</span>
                                <div>
                                    <div class="watering-plant-name">${esc(schedule.plant_name)}</div>
                                </div>
                            </div>
                            <div class="watering-d-day">
                                <span class="d-day-value ${dDayClass}">${diffDays <= 0 ? '지남' : 'D-' + diffDays}</span>
                                <span class="d-day-label">${dDayText}</span>
                            </div>
                        </div>
                        <div class="watering-progress">
                            <div class="watering-progress-bar ${dDayClass}" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="watering-actions">
                            <button class="watered-btn primary" onclick="markWatered('${esc(schedule.plant_name)}')">
                                ${diffDays <= 0 ? '✅ 물 줬어요!' : '💧 물 줬어요!'}
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
