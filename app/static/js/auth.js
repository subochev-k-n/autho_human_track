// ============================================
// Авторизация (логин, регистрация, проверка)
// ============================================

// Проверка авторизации при загрузке
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    const isAuthPage = path === '/login' || path === '/register';

    // Если есть токен и мы на странице входа — редирект на дашборд
    if (API.isAuthenticated() && isAuthPage) {
        window.location.href = '/dashboard';
        return;
    }

    // Если нет токена и мы не на странице входа — редирект на логин
    if (!API.isAuthenticated() && !isAuthPage && path !== '/') {
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

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('login-error');
        const btn = form.querySelector('button');

        errorEl.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Вход...';

        try {
            const data = await API.login(username, password);
            API.setTokens(data.access_token, data.refresh_token);
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
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm-password').value;
        const errorEl = document.getElementById('register-error');
        const btn = form.querySelector('button');

        errorEl.classList.add('hidden');

        if (password !== confirm) {
            errorEl.textContent = 'Пароли не совпадают';
            errorEl.classList.remove('hidden');
            return;
        }

        if (password.length < 4) {
            errorEl.textContent = 'Пароль должен быть минимум 4 символа';
            errorEl.classList.remove('hidden');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Регистрация...';

        try {
            await API.register(username, email, password);
            window.location.href = '/login?registered=1';
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Зарегистрироваться';
        }
    });
}

// --- Выход ---

function logout() {
    API.clearTokens();
    window.location.href = '/login';
}
