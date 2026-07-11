// ============================================
// Дашборд — логика трёх режимов
// ============================================

const STANDARD_FIELDS = [
    { key: 'energy', label: 'Энергия', desc: 'Силы, желание что-то делать' },
    { key: 'comfort', label: 'Комфорт', desc: 'Физический, эмоциональный, социальный' },
    { key: 'productivity', label: 'Продуктивность', desc: 'Насколько результативным был день' },
    { key: 'interaction', label: 'Взаимодействие', desc: 'Общение на работе, в семье, в обществе' },
    { key: 'sovereignty', label: 'Суверенитет', desc: 'Свобода и ответственность' },
    { key: 'self_score', label: 'Я', desc: 'Насколько вы довольны собой' },
    { key: 'day_score', label: 'День', desc: 'Общая оценка дня' },
];

let customFields = [];
let lineChart = null;
let radarChart = null;
let currentPeriod = 'week';
let calYear, calMonth;

document.addEventListener('DOMContentLoaded', async () => {
    if (!API.isAuthenticated()) return;

    try {
        // Загружаем кастомные колонки
        customFields = await API.listColumns();
    } catch (e) {
        console.error('Failed to load columns:', e);
    }

    // Форматируем дату
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    document.getElementById('form-date').textContent =
        now.toLocaleDateString('ru-RU', options);

    await updateDashboard();
});

async function updateDashboard() {
    try {
        const status = await API.getTodayStatus();

        if (!status.can_fill) {
            showMode('blocked');
        } else if (status.can_fill && !status.filled) {
            showMode('form');
            buildForm();
            // Показать напоминание на других страницах
            document.getElementById('reminder-banner').classList.remove('hidden');
        } else {
            showMode('view');
            document.getElementById('reminder-banner').classList.add('hidden');
            await loadTodayView();
            await loadCharts(currentPeriod);
            initCalendar();
        }
    } catch (e) {
        console.error('Dashboard error:', e);
    }
}

function showMode(mode) {
    document.getElementById('mode-blocked').classList.toggle('hidden', mode !== 'blocked');
    document.getElementById('mode-form').classList.toggle('hidden', mode !== 'form');
    document.getElementById('mode-view').classList.toggle('hidden', mode !== 'view');
}

// ============================================
// Форма (Режим Б)
// ============================================

function buildForm() {
    const container = document.getElementById('sliders-container');
    container.innerHTML = '';

    // Стандартные поля
    STANDARD_FIELDS.forEach(f => {
        container.appendChild(createSlider(f.key, f.label, f.desc));
    });

    // Кастомные поля rating
    customFields.forEach(cf => {
        if (cf.column_type === 'rating') {
            container.appendChild(createSlider(`custom_${cf.id}`, cf.name, ''));
        }
    });

    // Кастомные текстовые поля
    customFields.forEach(cf => {
        if (cf.column_type === 'text') {
            const group = document.createElement('div');
            group.className = 'form-group';
            group.innerHTML = `
                <label for="custom_text_${cf.id}">${cf.name}</label>
                <input type="text" id="custom_text_${cf.id}" class="custom-text-input"
                       placeholder="Введите значение" maxlength="500"
                       style="width:100%;padding:12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:1rem;">
            `;
            container.appendChild(group);
        }
    });

    // Обработчик отправки
    document.getElementById('entry-form').addEventListener('submit', handleFormSubmit);
}

function createSlider(key, label, desc) {
    const group = document.createElement('div');
    group.className = 'slider-group';

    group.innerHTML = `
        <div class="slider-header">
            <label for="slider_${key}">${label} ${desc ? `<span style="color:var(--text-muted);font-size:0.75rem;">— ${desc}</span>` : ''}</label>
            <span class="slider-value" id="val_${key}">0</span>
        </div>
        <input type="range" id="slider_${key}" min="-10" max="10" value="0" step="1">
        <div class="slider-labels">
            <span>-10</span>
            <span>0</span>
            <span>+10</span>
        </div>
    `;

    const input = group.querySelector('input');
    const valueDisplay = group.querySelector('.slider-value');
    input.addEventListener('input', () => {
        const val = parseInt(input.value);
        valueDisplay.textContent = val > 0 ? `+${val}` : val;
        valueDisplay.className = 'slider-value' + (val > 0 ? ' positive' : val < 0 ? ' negative' : '');
    });

    return group;
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('form-submit-btn');
    const errorEl = document.getElementById('form-error');

    btn.disabled = true;
    btn.textContent = 'Сохранение...';
    errorEl.classList.add('hidden');

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    const data = {
        date: dateStr,
        energy: parseInt(document.getElementById('slider_energy')?.value || 0),
        comfort: parseInt(document.getElementById('slider_comfort')?.value || 0),
        productivity: parseInt(document.getElementById('slider_productivity')?.value || 0),
        interaction: parseInt(document.getElementById('slider_interaction')?.value || 0),
        sovereignty: parseInt(document.getElementById('slider_sovereignty')?.value || 0),
        self_score: parseInt(document.getElementById('slider_self_score')?.value || 0),
        day_score: parseInt(document.getElementById('slider_day_score')?.value || 0),
        event: document.getElementById('event')?.value?.trim() || null,
        custom_values: [],
    };

    // Кастомные поля
    customFields.forEach(cf => {
        if (cf.column_type === 'rating') {
            const el = document.getElementById(`slider_custom_${cf.id}`);
            if (el) {
                data.custom_values.push({ column_id: cf.id, value: el.value });
            }
        } else {
            const el = document.getElementById(`custom_text_${cf.id}`);
            if (el && el.value.trim()) {
                data.custom_values.push({ column_id: cf.id, value: el.value.trim() });
            }
        }
    });

    if (data.custom_values.length === 0) {
        delete data.custom_values;
    }

    try {
        await API.createEntry(data);
        // После успешного сохранения — переключаемся в режим просмотра
        window.location.reload();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить';
    }
}

// ============================================
// Просмотр (Режим В)
// ============================================

async function loadTodayView() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    try {
        const list = await API.listEntries({ date_from: dateStr, date_to: dateStr, per_page: 1 });
        if (list.entries.length === 0) return;

        const entry = list.entries[0];
        const card = document.getElementById('today-card');
        card.innerHTML = '';

        const allFields = [
            ...STANDARD_FIELDS,
            ...customFields.filter(cf => cf.column_type === 'rating').map(cf => ({
                key: `custom_${cf.id}`,
                label: cf.name,
            })),
        ];

        allFields.forEach(f => {
            let val;
            if (f.key.startsWith('custom_')) {
                const cv = (entry.custom_values || []).find(cv => cv.column_id === parseInt(f.key.replace('custom_', '')));
                val = cv ? parseInt(cv.value) : null;
            } else {
                val = entry[f.key];
            }

            const div = document.createElement('div');
            div.className = 'metric';
            const valStr = val !== null && val !== undefined
                ? (val > 0 ? `+${val}` : val)
                : '—';
            const valClass = val > 0 ? 'positive' : val < 0 ? 'negative' : '';
            div.innerHTML = `
                <div class="label">${f.label}</div>
                <div class="value ${valClass}">${valStr}</div>
            `;
            card.appendChild(div);
        });

        // Событие дня
        if (entry.event) {
            const eventBlock = document.getElementById('entry-event-display');
            document.getElementById('event-text').textContent = entry.event;
            eventBlock.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Failed to load today entry:', e);
    }
}

// ============================================
// Графики
// ============================================

async function loadCharts(period) {
    const { dateFrom, dateTo } = getPeriodDates(period);

    try {
        const [stats, entries] = await Promise.all([
            API.getStats(dateFrom, dateTo),
            API.listEntries({
                date_from: dateFrom,
                date_to: dateTo,
                per_page: 365,
            }),
        ]);

        renderLineChart(entries.entries);
        renderRadarChart(stats.averages);
        renderStats(stats);
    } catch (e) {
        console.error('Charts error:', e);
    }
}

function getPeriodDates(period) {
    const now = new Date();
    const dateFrom = new Date();

    switch (period) {
        case 'week': dateFrom.setDate(now.getDate() - 7); break;
        case 'month': dateFrom.setMonth(now.getMonth() - 1); break;
        case '3months': dateFrom.setMonth(now.getMonth() - 3); break;
        case '6months': dateFrom.setMonth(now.getMonth() - 6); break;
        case 'year': dateFrom.setFullYear(now.getFullYear() - 1); break;
    }

    return {
        dateFrom: dateFrom.toISOString().split('T')[0],
        dateTo: now.toISOString().split('T')[0],
    };
}

function renderLineChart(entries) {
    const ctx = document.getElementById('line-chart').getContext('2d');

    if (lineChart) {
        lineChart.destroy();
    }

    const labels = entries.map(e => {
        const d = new Date(e.date);
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }).reverse();

    const colors = ['#7c5cfc', '#4ade80', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#34d399'];
    const datasets = STANDARD_FIELDS.map((f, i) => ({
        label: f.label,
        data: entries.map(e => e[f.key]).reverse(),
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.3,
        fill: false,
    }));

    // Добавить кастомные рейтинги
    let colorIdx = STANDARD_FIELDS.length;
    customFields.filter(cf => cf.column_type === 'rating').forEach(cf => {
        datasets.push({
            label: cf.name,
            data: entries.map(e => {
                const cv = (e.custom_values || []).find(cv => cv.column_id === cf.id);
                return cv ? parseInt(cv.value) : null;
            }).reverse(),
            borderColor: colors[colorIdx % colors.length],
            backgroundColor: colors[colorIdx % colors.length] + '20',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: false,
            borderDash: [5, 3],
        });
        colorIdx++;
    });

    lineChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { color: '#8888aa', boxWidth: 12, padding: 8 } },
            },
            scales: {
                x: {
                    ticks: { color: '#8888aa', maxTicksLimit: 15 },
                    grid: { color: '#2a2a45' },
                },
                y: {
                    min: -10,
                    max: 10,
                    ticks: { color: '#8888aa', stepSize: 5 },
                    grid: { color: '#2a2a45' },
                },
            },
        },
    });
}

function renderRadarChart(averages) {
    const ctx = document.getElementById('radar-chart').getContext('2d');

    if (radarChart) {
        radarChart.destroy();
    }

    const labels = STANDARD_FIELDS.map(f => f.label);
    const data = STANDARD_FIELDS.map(f => averages[f] || 0);

    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [{
                label: 'Среднее за период',
                data,
                backgroundColor: 'rgba(124, 92, 252, 0.2)',
                borderColor: '#7c5cfc',
                borderWidth: 2,
                pointBackgroundColor: '#7c5cfc',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
            },
            scales: {
                r: {
                    min: -10,
                    max: 10,
                    ticks: { color: '#8888aa', backdropColor: 'transparent', stepSize: 5 },
                    grid: { color: '#2a2a45' },
                    angleLines: { color: '#2a2a45' },
                    pointLabels: { color: '#e0e0f0', font: { size: 11 } },
                },
            },
        },
    });
}

function renderStats(stats) {
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = '';

    const items = [
        { label: 'Streak', value: `${stats.streak} дн.`, desc: 'Дней подряд' },
        { label: 'Лучший день', value: stats.best_day?.avg_score != null ? stats.best_day.avg_score : '—', desc: stats.best_day?.date || '' },
        { label: 'Худший день', value: stats.worst_day?.avg_score != null ? stats.worst_day.avg_score : '—', desc: stats.worst_day?.date || '' },
        ...STANDARD_FIELDS.map(f => ({
            label: f.label,
            value: stats.averages[f.key] != null ? stats.averages[f.key] : '—',
            desc: stats.trend[f.key] != null
                ? (stats.trend[f.key] > 0 ? `+${stats.trend[f.key]}` : stats.trend[f.key])
                : '',
        })),
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'stat-item';
        const valClass = typeof item.value === 'number' && item.value > 0 ? 'positive' :
                         typeof item.value === 'number' && item.value < 0 ? 'negative' : '';
        div.innerHTML = `
            <div class="stat-label">${item.label}</div>
            <div class="stat-value ${valClass}">${item.value}</div>
            ${item.desc ? `<div style="font-size:0.7rem;color:var(--text-muted);">${item.desc}</div>` : ''}
        `;
        grid.appendChild(div);
    });
}

// ============================================
// Календарь (тепловая карта)
// ============================================

function initCalendar() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth() + 1;
    renderCalendar();

    document.getElementById('cal-prev').addEventListener('click', () => {
        calMonth--;
        if (calMonth < 1) { calMonth = 12; calYear--; }
        renderCalendar();
    });

    document.getElementById('cal-next').addEventListener('click', () => {
        calMonth++;
        if (calMonth > 12) { calMonth = 1; calYear++; }
        renderCalendar();
    });
}

async function renderCalendar() {
    const daysHeader = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const grid = document.getElementById('calendar-grid');
    const label = document.getElementById('cal-label');
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    label.textContent = `${monthNames[calMonth - 1]} ${calYear}`;

    try {
        const data = await API.getCalendar(calYear, calMonth);

        grid.innerHTML = '';
        // Заголовки дней
        daysHeader.forEach(d => {
            const div = document.createElement('div');
            div.style.cssText = 'text-align:center;font-size:0.7rem;color:var(--text-muted);padding:4px 0;';
            div.textContent = d;
            grid.appendChild(div);
        });

        // Пустые ячейки до первого дня месяца
        const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
        const offset = firstDay === 0 ? 6 : firstDay - 1; // ПН=0
        for (let i = 0; i < offset; i++) {
            const div = document.createElement('div');
            grid.appendChild(div);
        }

        // Ячейки дней
        const today = new Date();
        data.forEach(d => {
            const div = document.createElement('div');
            const dayDate = new Date(d.date);
            const isToday = dayDate.toDateString() === today.toDateString();

            let bg = 'var(--bg-input)';
            if (d.filled && d.avg_score != null) {
                // Цвет от красного (-10) до зелёного (+10)
                const ratio = (d.avg_score + 10) / 20; // 0..1
                const r = Math.round(255 * (1 - ratio));
                const g = Math.round(255 * ratio);
                bg = `rgba(${r}, ${g}, 120, 0.3)`;
            }

            div.style.cssText = `
                text-align:center;padding:6px 0;border-radius:6px;font-size:0.8rem;
                background:${bg};
                ${isToday ? 'border:1px solid var(--accent);font-weight:600;' : ''}
                ${d.filled ? '' : 'color:var(--text-muted);opacity:0.5;'}
            `;
            div.textContent = dayDate.getDate();
            grid.appendChild(div);
        });
    } catch (e) {
        console.error('Calendar error:', e);
    }
}

// ============================================
// Переключатель периодов
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('period-selector');
    if (!selector) return;

    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-period]');
        if (!btn) return;

        selector.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        loadCharts(currentPeriod);
    });
});
