// ============================================
// API-клиент для трекера автогуманиста
// ============================================

const API = {
    BASE: '',  // относительные пути

    // Получить токен из localStorage
    _token: () => localStorage.getItem('access_token'),

    _refreshToken: () => localStorage.getItem('refresh_token'),

    // Сохранить токены
    setTokens: (access, refresh) => {
        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);
    },

    // Удалить токены (выход)
    clearTokens: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
    },

    // Проверить, есть ли токен
    isAuthenticated: () => !!localStorage.getItem('access_token'),

    // Универсальный запрос
    _request: async (path, options = {}) => {
        const token = API._token();
        const headers = { 'Content-Type': 'application/json', ...options.headers };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(API.BASE + path, {
            ...options,
            headers,
        });

        if (res.status === 204) {
            return null; // No content
        }

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || 'Ошибка запроса');
        }

        return data;
    },

    // --- Auth ---
    register: (username, email, password) =>
        API._request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password }),
        }),

    login: (username, password) =>
        API._request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        }),

    getMe: () => API._request('/api/auth/me'),

    refreshToken: (refreshToken) =>
        API._request('/api/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: refreshToken }),
        }),

    // --- Entries ---
    getTodayStatus: () => API._request('/api/entries/today'),

    createEntry: (data) =>
        API._request('/api/entries/', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    listEntries: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.page) qs.set('page', params.page);
        if (params.per_page) qs.set('per_page', params.per_page);
        if (params.date_from) qs.set('date_from', params.date_from);
        if (params.date_to) qs.set('date_to', params.date_to);
        const query = qs.toString();
        return API._request(`/api/entries/${query ? '?' + query : ''}`);
    },

    getEntry: (id) => API._request(`/api/entries/${id}`),

    getStats: (dateFrom, dateTo) => {
        const qs = new URLSearchParams();
        if (dateFrom) qs.set('date_from', dateFrom);
        if (dateTo) qs.set('date_to', dateTo);
        const query = qs.toString();
        return API._request(`/api/entries/stats${query ? '?' + query : ''}`);
    },

    getCalendar: (year, month) =>
        API._request(`/api/entries/calendar?year=${year}&month=${month}`),

    // --- Custom columns ---
    listColumns: () => API._request('/api/columns/'),

    createColumn: (data) =>
        API._request('/api/columns/', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    updateColumn: (id, data) =>
        API._request(`/api/columns/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    deleteColumn: (id) =>
        API._request(`/api/columns/${id}`, { method: 'DELETE' }),

    reorderColumns: (items) =>
        API._request('/api/columns/reorder', {
            method: 'PUT',
            body: JSON.stringify({ items }),
        }),
};
