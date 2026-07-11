// ============================================
// Аптечка — JS-логика
// ============================================

const CATEGORY_COLORS = {
    fatigue: { bg: 'rgba(251,191,36,0.15)', border: '#fbbf24', emoji: '🏋️' },
    apathy: { bg: 'rgba(251,146,60,0.15)', border: '#fb923c', emoji: '🌪' },
    anxiety: { bg: 'rgba(74,222,128,0.15)', border: '#4ade80', emoji: '🧘' },
    negativity: { bg: 'rgba(96,165,250,0.15)', border: '#60a5fa', emoji: '💆' },
};

const CATEGORY_LABELS = {
    fatigue: 'Усталость', apathy: 'Апатия', anxiety: 'Тревога', negativity: 'Негатив',
};

const ACTION_LABELS = {
    instant: '⚡ Моментальный', tactical: '🎯 Тактический', daily: '🌙 Дневной',
};

let currentCategory = '';
let currentType = '';
let currentItemId = null; // для модалки

document.addEventListener('DOMContentLoaded', async () => {
    // Дожидаемся инициализации БД
    try {
        await API.init();
    } catch (e) {
        console.error("DB init error in firstaid:", e);
        return;
    }

    const path = window.location.pathname;
    if (path === '/firstaid') initFirstAid();
    else if (path === '/firstaid/edit') initEdit();
    else if (path === '/firstaid/history') initHistory();
});

// ============================================
// Главная страница
// ============================================

async function initFirstAid() {
    // Фильтры
    document.getElementById('category-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        document.querySelectorAll('#category-filters .btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.value;
        loadItems();
    });

    document.getElementById('type-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        document.querySelectorAll('#type-filters .btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentType = btn.dataset.value;
        loadItems();
    });

    // Модалка использования
    document.getElementById('usage-save').addEventListener('click', () => saveUsage(true));
    document.getElementById('usage-skip').addEventListener('click', () => saveUsage(false));

    await loadItems();
}

let allItems = [];

async function loadItems() {
    try {
        const params = new URLSearchParams();
        if (currentCategory) params.set('category', currentCategory);
        if (currentType) params.set('action_type', currentType);
        const query = params.toString();
        allItems = await API._request(`/api/firstaid/items${query ? '?' + query : ''}`);
        renderItems(allItems);
    } catch (e) {
        document.getElementById('error-display').textContent = e.message;
        document.getElementById('error-display').classList.remove('hidden');
    }
}

function renderItems(items) {
    const container = document.getElementById('items-list');
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = `
            <div class="card" style="text-align:center;padding:40px;">
                <div style="font-size:3rem;margin-bottom:12px;">🧘</div>
                <p style="color:var(--text-muted);">Нет допингов в этой категории.<br>
                <a href="/firstaid/edit">Добавить первый →</a></p>
            </div>`;
        return;
    }

    items.forEach(item => {
        const cat = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.fatigue;
        const card = document.createElement('div');
        card.className = 'card';
        card.style.borderLeft = `4px solid ${cat.border}`;

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:1rem;margin-bottom:4px;">${cat.emoji} ${item.title}</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
                        <span style="font-size:0.75rem;padding:2px 8px;background:var(--bg-input);border-radius:10px;color:${cat.border};">${CATEGORY_LABELS[item.category] || item.category}</span>
                        <span style="font-size:0.75rem;padding:2px 8px;background:var(--bg-input);border-radius:10px;">${ACTION_LABELS[item.action_type] || item.action_type}</span>
                        ${item.time_cost ? `<span style="font-size:0.75rem;padding:2px 8px;background:var(--bg-input);border-radius:10px;color:var(--text-muted);">⏱ ${item.time_cost}</span>` : ''}
                    </div>
                    ${item.duration ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">⟳ эффект: ${item.duration}</div>` : ''}
                    ${item.feelings ? `<div style="font-size:0.85rem;color:var(--text-muted);font-style:italic;margin-bottom:6px;">«${item.feelings}»</div>` : ''}
                    ${item.usage_count > 0 ? `<div style="font-size:0.75rem;color:var(--text-muted);">✅ Использовано ${item.usage_count} раз${item.avg_effectiveness ? `, средний эффект: ${item.avg_effectiveness}/5` : ''}</div>` : ''}
                </div>
            </div>
            <div style="display:flex;gap:6px;margin-top:12px;">
                <button class="btn btn-primary btn-small use-btn" data-id="${item.id}" style="flex:1;">✅ Использовал</button>
                <a href="/firstaid/edit?id=${item.id}" class="btn btn-outline btn-small" style="flex:0;min-width:44px;">✏️</a>
                <button class="btn btn-danger btn-small delete-btn" data-id="${item.id}" style="flex:0;min-width:44px;">🗑️</button>
            </div>
        `;

        container.appendChild(card);
    });

    // Обработчики
    container.querySelectorAll('.use-btn').forEach(btn => {
        btn.addEventListener('click', () => openUsageModal(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteItem(parseInt(btn.dataset.id)));
    });
}

// ============================================
// Случайный допинг
// ============================================

async function pickRandom() {
    const card = document.getElementById('random-content');
    card.innerHTML = '<div style="font-size:1.5rem;">🎲 Ищем...</div>';

    try {
        const params = new URLSearchParams();
        if (currentCategory) params.set('category', currentCategory);
        if (currentType) params.set('action_type', currentType);
        const query = params.toString();
        const item = await API._request(`/api/firstaid/items/random${query ? '?' + query : ''}`);

        if (!item) {
            card.innerHTML = `
                <div style="font-size:2.5rem;margin-bottom:8px;">🤷</div>
                <div style="font-size:0.9rem;color:var(--text-muted);">Нет подходящих допингов</div>
                <div style="font-size:0.8rem;margin-top:4px;color:var(--text-muted);">Нажмите, чтобы попробовать снова</div>`;
            return;
        }

        const cat = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.fatigue;
        card.innerHTML = `
            <div style="font-size:2rem;margin-bottom:4px;">${cat.emoji}</div>
            <div style="font-weight:600;font-size:1.1rem;margin-bottom:4px;">${item.title}</div>
            <div style="font-size:0.8rem;color:${cat.border};margin-bottom:4px;">${CATEGORY_LABELS[item.category]} · ${ACTION_LABELS[item.action_type]}</div>
            ${item.time_cost ? `<div style="font-size:0.8rem;color:var(--text-muted);">⏱ ${item.time_cost} · ⟳ ${item.duration || '—'}</div>` : ''}
            <div style="margin-top:8px;">
                <button class="btn btn-primary btn-small" onclick="event.stopPropagation();openUsageModal(${item.id})" style="display:inline-flex;width:auto;">✅ Использовал</button>
                <button class="btn btn-outline btn-small" onclick="event.stopPropagation();pickRandom()" style="display:inline-flex;width:auto;">🎲 Ещё</button>
            </div>`;
    } catch (e) {
        card.innerHTML = `
            <div style="font-size:2.5rem;margin-bottom:8px;">😵</div>
            <div style="font-size:0.9rem;color:var(--danger);">Ошибка</div>
            <div style="font-size:0.8rem;margin-top:4px;color:var(--text-muted);">Нажмите, чтобы попробовать снова</div>`;
    }
}

// ============================================
// Модалка «Использовал»
// ============================================

function openUsageModal(itemId) {
    currentItemId = itemId;
    document.getElementById('usage-note').value = '';
    // Сбросить подсветку
    document.querySelectorAll('#usage-modal [data-rating]').forEach(b => {
        b.style.background = '#2a2a45';
    });
    document.getElementById('usage-modal').classList.remove('hidden');
}

async function saveUsage(withRating) {
    const modal = document.getElementById('usage-modal');
    const note = document.getElementById('usage-note').value.trim() || null;

    let effectiveness = null;
    if (withRating) {
        const selected = document.querySelector('#usage-modal [data-rating]');
        if (selected) {
            effectiveness = parseInt(selected.dataset.rating);
        }
    }

    try {
        await API._request('/api/firstaid/usages', {
            method: 'POST',
            body: JSON.stringify({
                item_id: currentItemId,
                effectiveness,
                note,
            }),
        });
        modal.classList.add('hidden');
        await loadItems();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// Подсветка оценки
document.addEventListener('click', (e) => {
    const btn = e.target.closest('#usage-modal [data-rating]');
    if (!btn) return;
    document.querySelectorAll('#usage-modal [data-rating]').forEach(b => {
        b.style.background = '#2a2a45';
    });
    btn.style.background = 'var(--accent)';
});

// Закрытие модалки по клику вне
document.addEventListener('click', (e) => {
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) {
        overlay.classList.add('hidden');
    }
});

// ============================================
// Удаление
// ============================================

async function deleteItem(id) {
    const item = allItems.find(i => i.id === id);
    if (!confirm(`Удалить допинг «${item.title}»?`)) return;

    try {
        await API._request(`/api/firstaid/items/${id}`, { method: 'DELETE' });
        await loadItems();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ============================================
// Страница редактирования
// ============================================

async function initEdit() {
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('id');

    if (editId) {
        document.getElementById('form-title').textContent = '✏️ Редактировать допинг';
        try {
            const items = await API._request('/api/firstaid/items?include_inactive=true');
            const item = items.find(i => i.id === parseInt(editId));
            if (item) {
                document.getElementById('fa-title').value = item.title;
                document.getElementById('fa-category').value = item.category;
                document.getElementById('fa-action-type').value = item.action_type;
                document.getElementById('fa-time-cost').value = item.time_cost || '';
                document.getElementById('fa-duration').value = item.duration || '';
                document.getElementById('fa-feelings').value = item.feelings || '';
            }
        } catch (e) {
            console.error(e);
        }
    }

    document.getElementById('edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;

        const data = {
            title: document.getElementById('fa-title').value.trim(),
            category: document.getElementById('fa-category').value,
            action_type: document.getElementById('fa-action-type').value,
            time_cost: document.getElementById('fa-time-cost').value.trim(),
            duration: document.getElementById('fa-duration').value.trim(),
            feelings: document.getElementById('fa-feelings').value.trim() || null,
        };

        try {
            if (editId) {
                await API._request(`/api/firstaid/items/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify(data),
                });
            } else {
                await API._request('/api/firstaid/items', {
                    method: 'POST',
                    body: JSON.stringify(data),
                });
            }
            window.location.href = '/firstaid';
        } catch (err) {
            const errEl = document.getElementById('edit-error');
            errEl.textContent = err.message;
            errEl.classList.remove('hidden');
            btn.disabled = false;
        }
    });

    // Автозаполнение времени/длительности при выборе типа
    document.getElementById('fa-action-type').addEventListener('change', function() {
        const timeField = document.getElementById('fa-time-cost');
        const durField = document.getElementById('fa-duration');
        if (!document.getElementById('edit_id') && !editId) {
            // Только для новых — не перезаписываем ручной ввод
        }
    });
}

// ============================================
// Страница истории
// ============================================

async function initHistory() {
    // Загрузить статистику
    try {
        const stats = await API._request('/api/firstaid/stats');
        document.getElementById('stat-items').textContent = stats.total_items;
        document.getElementById('stat-usages').textContent = stats.total_usages;
        document.getElementById('stat-effect').textContent = stats.avg_effectiveness != null ? stats.avg_effectiveness + '/5' : '—';
        document.getElementById('stats-card').classList.remove('hidden');
    } catch (e) {}

    document.getElementById('filter-apply').addEventListener('click', loadHistory);
    await loadHistory();
}

async function loadHistory() {
    const dateFrom = document.getElementById('filter-from').value || undefined;
    const dateTo = document.getElementById('filter-to').value || undefined;

    try {
        const params = new URLSearchParams();
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        const query = params.toString();
        const usages = await API._request(`/api/firstaid/usages${query ? '?' + query : ''}`);

        const tbody = document.getElementById('history-body');
        tbody.innerHTML = '';

        if (usages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty">Нет использований</td></tr>';
            return;
        }

        usages.forEach(u => {
            const tr = document.createElement('tr');
            const d = new Date(u.used_at);
            const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const cat = CATEGORY_COLORS[u.item_category] || { emoji: '🩹' };
            tr.innerHTML = `
                <td style="font-size:0.8rem;">${dateStr}</td>
                <td style="text-align:left;">${cat.emoji} ${u.item_title}</td>
                <td style="font-size:0.8rem;color:var(--text-muted);">${CATEGORY_LABELS[u.item_category] || u.item_category}</td>
                <td>${u.effectiveness ? '⭐'.repeat(u.effectiveness) : '—'}</td>
                <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;color:var(--text-muted);">${u.note || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        document.getElementById('history-body').innerHTML = `<tr><td colspan="5" class="empty">Ошибка: ${e.message}</td></tr>`;
    }
}
