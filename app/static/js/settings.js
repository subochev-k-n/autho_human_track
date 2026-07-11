// ============================================
// Настройки — управление кастомными колонками
// ============================================

let columns = [];
let draggedIndex = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!API.isAuthenticated()) return;

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

    // Модальное окно
    const modal = document.getElementById('add-modal');
    document.getElementById('add-column-btn').addEventListener('click', () => {
        document.getElementById('modal-name').value = '';
        document.getElementById('modal-type').value = 'rating';
        document.getElementById('modal-error').classList.add('hidden');
        modal.classList.remove('hidden');
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    document.getElementById('modal-save').addEventListener('click', addColumn);

    await loadColumns();
});

async function loadColumns() {
    try {
        columns = await API.listColumns();
        renderColumns();
    } catch (e) {
        showError(e.message);
    }
}

function renderColumns() {
    const list = document.getElementById('column-list');
    list.innerHTML = '';

    if (columns.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Нет дополнительных сфер. Добавьте свою первую сферу.</p>';
        return;
    }

    columns.forEach((col, index) => {
        const item = document.createElement('li');
        item.className = 'column-item';
        item.draggable = true;
        item.dataset.index = index;

        item.innerHTML = `
            <div class="col-info">
                <span class="drag-handle">⠿</span>
                <div>
                    <div class="col-name">${col.name}</div>
                    <span class="col-type">${col.column_type === 'rating' ? 'Оценка' : 'Текст'}</span>
                </div>
            </div>
            <button class="btn btn-danger btn-small" data-id="${col.id}">Удалить</button>
        `;

        // Drag and drop
        item.addEventListener('dragstart', (e) => {
            draggedIndex = index;
            e.dataTransfer.effectAllowed = 'move';
            item.style.opacity = '0.4';
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            draggedIndex = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedIndex !== null && draggedIndex !== index) {
                swapColumns(draggedIndex, index);
            }
        });

        // Touch drag (простой вариант: перемещение через кнопки)
        item.addEventListener('touchstart', () => {
            draggedIndex = index;
        }, { passive: true });

        // Удаление
        item.querySelector('button').addEventListener('click', () => {
            confirmDelete(col.id, col.name);
        });

        list.appendChild(item);
    });
}

async function swapColumns(fromIdx, toIdx) {
    // Меняем местами sort_order
    const fromCol = columns[fromIdx];
    const toCol = columns[toIdx];
    const tempOrder = fromCol.sort_order;
    fromCol.sort_order = toCol.sort_order;
    toCol.sort_order = tempOrder;

    // Оптимистично обновляем UI
    [columns[fromIdx], columns[toIdx]] = [columns[toIdx], columns[fromIdx]];
    renderColumns();

    // Сохраняем на сервере
    try {
        await API.reorderColumns(
            columns.map((col, i) => ({ id: col.id, sort_order: i }))
        );
        await loadColumns(); // перезагрузить с сервера для синхронизации
    } catch (e) {
        showError('Не удалось изменить порядок: ' + e.message);
        await loadColumns(); // восстановить
    }
}

async function addColumn() {
    const name = document.getElementById('modal-name').value.trim();
    const type = document.getElementById('modal-type').value;
    const errorEl = document.getElementById('modal-error');
    const btn = document.getElementById('modal-save');

    if (!name) {
        errorEl.textContent = 'Введите название сферы';
        errorEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Добавление...';

    try {
        await API.createColumn({ name, column_type: type });
        document.getElementById('add-modal').classList.add('hidden');
        await loadColumns();
    } catch (e) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Добавить';
    }
}

async function confirmDelete(id, name) {
    if (!confirm(`Удалить сферу "${name}"? Все её значения в записях также будут удалены.`)) return;

    try {
        await API.deleteColumn(id);
        await loadColumns();
    } catch (e) {
        showError(e.message);
    }
}

function showError(msg) {
    const el = document.getElementById('column-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}
