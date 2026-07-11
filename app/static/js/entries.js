// ============================================
// Таблица записей (только чтение)
// ============================================

let currentPage = 1;
const PER_PAGE = 50;
let customFields = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!API.isAuthenticated()) return;

    try {
        customFields = await API.listColumns();
    } catch (e) {
        console.error('Failed to load custom columns:', e);
    }

    // Показать напоминание
    try {
        const status = await API.getTodayStatus();
        if (status.reminder) {
            const banner = document.getElementById('reminder-banner');
            banner.innerHTML = `
                <div class="reminder-banner">
                    <p>📝 Сегодня ещё не заполнено. Внесите оценку дня.</p>
                    <a href="/dashboard" class="btn btn-primary" style="max-width:280px;">Заполнить сегодня</a>
                </div>
            `;
            banner.classList.remove('hidden');
        }
    } catch (e) {}

    // Фильтры
    document.getElementById('filter-apply').addEventListener('click', () => loadEntries(1));
    document.getElementById('filter-reset').addEventListener('click', () => {
        document.getElementById('filter-from').value = '';
        document.getElementById('filter-to').value = '';
        loadEntries(1);
    });

    await loadEntries(1);
});

async function loadEntries(page) {
    currentPage = page;
    const dateFrom = document.getElementById('filter-from').value || undefined;
    const dateTo = document.getElementById('filter-to').value || undefined;

    try {
        const data = await API.listEntries({
            page,
            per_page: PER_PAGE,
            date_from: dateFrom,
            date_to: dateTo,
        });

        renderTable(data);
        renderPagination(data);
    } catch (e) {
        document.getElementById('entries-body').innerHTML =
            `<tr><td colspan="10" class="empty">Ошибка загрузки: ${e.message}</td></tr>`;
    }
}

function renderTable(data) {
    const tbody = document.getElementById('entries-body');
    tbody.innerHTML = '';

    if (data.entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty">Нет записей</td></tr>';
        return;
    }

    // Обновить заголовки для кастомных колонок
    const thead = document.querySelector('#entries-table thead tr');
    if (customFields.length > 0) {
        // Удалить старые заголовки кастомов
        thead.querySelectorAll('.custom-th').forEach(el => el.remove());
        customFields.forEach(cf => {
            const th = document.createElement('th');
            th.className = 'custom-th';
            th.textContent = cf.name.substring(0, 4);
            thead.appendChild(th);
        });
    }

    data.entries.forEach(entry => {
        const tr = document.createElement('tr');
        const d = new Date(entry.date);
        const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

        const val = (v) => v != null ? v : '—';
        const dayOfWeek = entry.day_of_week?.substring(0, 2) || '—';

        let html = `
            <td class="date-col">${dateStr}</td>
            <td>${dayOfWeek}</td>
            <td>${val(entry.energy)}</td>
            <td>${val(entry.comfort)}</td>
            <td>${val(entry.productivity)}</td>
            <td>${val(entry.interaction)}</td>
            <td>${val(entry.sovereignty)}</td>
            <td>${val(entry.self_score)}</td>
            <td>${val(entry.day_score)}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${entry.event || '—'}</td>
        `;

        // Кастомные колонки
        customFields.forEach(cf => {
            const cv = (entry.custom_values || []).find(v => v.column_id === cf.id);
            html += `<td>${cv ? cv.value : '—'}</td>`;
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function renderPagination(data) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    const totalPages = Math.ceil(data.total / data.per_page);
    if (totalPages <= 1) return;

    if (currentPage > 1) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline btn-small';
        btn.textContent = '← Назад';
        btn.addEventListener('click', () => loadEntries(currentPage - 1));
        container.appendChild(btn);
    }

    const pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'display:flex;align-items:center;padding:0 12px;font-size:0.85rem;color:var(--text-muted);';
    pageInfo.textContent = `${currentPage} / ${totalPages}`;
    container.appendChild(pageInfo);

    if (currentPage < totalPages) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline btn-small';
        btn.textContent = 'Вперёд →';
        btn.addEventListener('click', () => loadEntries(currentPage + 1));
        container.appendChild(btn);
    }
}
