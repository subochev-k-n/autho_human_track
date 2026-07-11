// ============================================
// Авторизация — локальные профили (без пароля)
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    const path = window.location.pathname;

    // Инициализация БД
    try {
        await API.init();

        // Seed данных для текущего пользователя
        if (DB.currentUser) {
            DB.seedFirstAid();
        }
    } catch (e) {
        console.error("Init error:", e);
        const container = document.getElementById('app') || document.querySelector('.container');
        if (container) {
            container.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
                <div style="font-size:3rem;margin-bottom:16px;">😵</div>
                <h2>Ошибка инициализации</h2>
                <p style="color:var(--text-muted);">${e.message}</p>
                <p style="color:var(--text-muted);font-size:0.85rem;">Попробуйте Chrome или Edge последней версии.</p>
            </div>`;
        }
        return;
    }

    // Перенаправление
    const isAuthPage = path === '/login' || path === '/register' || path === '/' || path === '';
    const isProtected = ['/dashboard', '/entries', '/settings', '/firstaid', '/firstaid/edit', '/firstaid/history'].includes(path.split('?')[0]);

    if (API.isAuthenticated() && (isAuthPage || path === '/' || path === '')) {
        window.location.href = '/dashboard';
        return;
    }

    if (!API.isAuthenticated() && isProtected) {
        window.location.href = '/login';
        return;
    }

    // Инициализация страниц
    if (path === '/login') initLogin();
    if (path === '/register') initRegister();
});

// --- Login ---

function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;

    // Показать список существующих профилей
    const users = DB.all("SELECT * FROM users ORDER BY username");
    if (users.length > 0) {
        const info = document.getElementById('login-info') || document.createElement('div');
        if (!info.id) {
            info.id = 'login-info';
            info.className = 'mt-16';
            info.style.cssText = 'text-align:center;';
            form.parentNode.insertBefore(info, form.nextSibling);
        }
        info.innerHTML = `
            <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:8px;">Или выберите профиль:</p>
            <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;">
                ${users.map(u => `<button class="btn btn-outline btn-small profile-btn" data-username="${u.username}" style="width:auto;">${u.username}</button>`).join('')}
            </div>`;
        info.querySelectorAll('.profile-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('username').value = btn.dataset.username;
                form.querySelector('button').click();
            });
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const errorEl = document.getElementById('login-error');
        const btn = form.querySelector('button');

        if (!username) {
            errorEl.textContent = 'Введите имя';
            errorEl.classList.remove('hidden');
            return;
        }

        errorEl.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Вход...';

        try {
            await API.login(username);
            window.location.href = '/dashboard';
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Войти';
        }
    });
}

// --- Register ---

function initRegister() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const errorEl = document.getElementById('register-error');
        const btn = form.querySelector('button');

        if (!username || username.length < 2) {
            errorEl.textContent = 'Имя должно быть минимум 2 символа';
            errorEl.classList.remove('hidden');
            return;
        }

        errorEl.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Создание...';

        try {
            await API.register(username);
            DB.seedFirstAid();
            window.location.href = '/dashboard';
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Создать профиль';
        }
    });
}

// --- Выход ---

function logout() {
    API.clearTokens();
    window.location.href = '/login';
}
