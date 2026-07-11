// ============================================
// API-клиент — локальное хранение (SQLite Wasm)
// Все методы сохраняют те же названия и сигнатуры
// ============================================

// Глобальная функция выхода — не зависит от инициализации
function logout() {
    localStorage.removeItem("current_user_id");
    if (typeof DB !== 'undefined' && DB.currentUser) DB.currentUser = null;
    window.location.href = '/login';
}

const API = {
    isReady: false,

    // === Инициализация ===

    init: async function () {
        try {
            await DB.init();
            this.isReady = true;
        } catch (e) {
            console.error("API init failed:", e);
            throw e;
        }
    },

    isAuthenticated: function () {
        return DB.currentUser !== null;
    },

    // === Auth (локальные профили) ===

    register: function (username) {
        try {
            const id = DB.run(
                "INSERT INTO users (username) VALUES (?)",
                [username.trim()]
            );
            const user = DB.get("SELECT * FROM users WHERE id = ?", [id]);
            DB.currentUser = user;
            localStorage.setItem("current_user_id", String(user.id));
            return Promise.resolve({ id: user.id, username: user.username });
        } catch (e) {
            return Promise.reject(new Error("Пользователь с таким именем уже существует"));
        }
    },

    login: function (username) {
        const user = DB.get("SELECT * FROM users WHERE username = ?", [username.trim()]);
        if (!user) {
            return Promise.reject(new Error("Пользователь не найден"));
        }
        DB.currentUser = user;
        localStorage.setItem("current_user_id", String(user.id));
        return Promise.resolve({
            access_token: "local",
            refresh_token: "local",
            token_type: "local",
        });
    },

    clearTokens: function () {
        localStorage.removeItem("current_user_id");
        DB.currentUser = null;
    },

    setTokens: function () {},

    getMe: function () {
        if (!DB.currentUser) return Promise.reject(new Error("Не авторизован"));
        return Promise.resolve(DB.currentUser);
    },

    // === Entries ===

    getTodayStatus: function () {
        const today = new Date().toISOString().split("T")[0];
        const entry = DB.get(
            "SELECT id FROM entries WHERE user_id = ? AND date = ?",
            [DB.currentUser.id, today]
        );
        const hour = new Date().getHours();
        const can_fill = hour >= 18;
        return Promise.resolve({
            filled: !!entry,
            can_fill: can_fill,
            reminder: can_fill && !entry,
        });
    },

    createEntry: function (data) {
        const dayOfWeek = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
        const d = new Date(data.date + "T12:00:00");
        const dow = dayOfWeek[d.getDay()];

        try {
            const id = DB.run(
                `INSERT INTO entries (user_id, date, day_of_week, energy, comfort, productivity,
                 interaction, sovereignty, self_score, day_score, event)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [DB.currentUser.id, data.date, dow,
                 data.energy, data.comfort, data.productivity,
                 data.interaction, data.sovereignty,
                 data.self_score, data.day_score, data.event || null]
            );

            // Кастомные значения
            if (data.custom_values) {
                for (const cv of data.custom_values) {
                    DB.run(
                        "INSERT INTO entry_column_values (column_id, entry_id, value) VALUES (?, ?, ?)",
                        [cv.column_id, id, cv.value]
                    );
                }
            }

            return this.getEntry(id);
        } catch (e) {
            if (e.message && e.message.includes("UNIQUE")) {
                return Promise.reject(new Error("Запись за этот день уже существует"));
            }
            return Promise.reject(e);
        }
    },

    listEntries: function (params = {}) {
        let sql = "SELECT * FROM entries WHERE user_id = ?";
        const bind = [DB.currentUser.id];

        if (params.date_from) {
            sql += " AND date >= ?";
            bind.push(params.date_from);
        }
        if (params.date_to) {
            sql += " AND date <= ?";
            bind.push(params.date_to);
        }

        sql += " ORDER BY date DESC";

        const page = params.page || 1;
        const perPage = params.per_page || 30;
        sql += " LIMIT ? OFFSET ?";
        bind.push(perPage, (page - 1) * perPage);

        const entries = DB.all(sql, bind);

        // Считаем total
        let countSql = "SELECT COUNT(*) as cnt FROM entries WHERE user_id = ?";
        const countBind = [DB.currentUser.id];
        if (params.date_from) {
            countSql += " AND date >= ?";
            countBind.push(params.date_from);
        }
        if (params.date_to) {
            countSql += " AND date <= ?";
            countBind.push(params.date_to);
        }
        const total = DB.get(countSql, countBind);

        // Обогащаем кастомными значениями
        const enriched = entries.map(e => this._enrichEntry(e));

        return Promise.resolve({
            entries: enriched,
            total: total ? total.cnt : 0,
            page,
            per_page: perPage,
        });
    },

    getEntry: function (id) {
        const entry = DB.get(
            "SELECT * FROM entries WHERE id = ? AND user_id = ?",
            [id, DB.currentUser.id]
        );
        if (!entry) return Promise.reject(new Error("Запись не найдена"));
        return Promise.resolve(this._enrichEntry(entry));
    },

    _enrichEntry: function (entry) {
        const values = DB.all(
            `SELECT ecv.*, cc.name as column_name, cc.column_type
             FROM entry_column_values ecv
             JOIN custom_columns cc ON cc.id = ecv.column_id
             WHERE ecv.entry_id = ?`,
            [entry.id]
        );
        return {
            ...entry,
            custom_values: values.map(v => ({
                column_id: v.column_id,
                column_name: v.column_name,
                value: v.value,
                column_type: v.column_type,
            })),
        };
    },

    getStats: function (dateFrom, dateTo) {
        let sql = "SELECT * FROM entries WHERE user_id = ?";
        const bind = [DB.currentUser.id];
        if (dateFrom) { sql += " AND date >= ?"; bind.push(dateFrom); }
        if (dateTo) { sql += " AND date <= ?"; bind.push(dateTo); }
        sql += " ORDER BY date ASC";

        const entries = DB.all(sql, bind);
        const fields = ["energy","comfort","productivity","interaction",
                        "sovereignty","self_score","day_score"];

        const averages = {}, mins = {}, maxs = {}, trends = {};
        let bestDay = null, worstDay = null;
        let streak = 0;

        if (entries.length > 0) {
            for (const f of fields) {
                const values = entries.map(e => e[f]).filter(v => v !== null);
                if (values.length > 0) {
                    averages[f] = Math.round(values.reduce((a,b) => a+b, 0) / values.length * 10) / 10;
                    mins[f] = Math.min(...values);
                    maxs[f] = Math.max(...values);
                    const half = Math.max(Math.floor(values.length / 2), 1);
                    const firstHalf = values.slice(0, half).reduce((a,b) => a+b, 0) / half;
                    const secondHalf = values.slice(-half).reduce((a,b) => a+b, 0) / half;
                    trends[f] = Math.round((secondHalf - firstHalf) * 10) / 10;
                }
            }

            // Streak
            const dates = [...new Set(entries.map(e => e.date))].sort().reverse();
            const today = new Date().toISOString().split("T")[0];
            let check = today;
            for (const d of dates) {
                if (d === check) { streak++; check = this._prevDate(check); }
                else break;
            }

            // Best/worst
            let bestAvg = -Infinity, worstAvg = Infinity;
            for (const e of entries) {
                const vals = fields.map(f => e[f]).filter(v => v !== null);
                if (vals.length > 0) {
                    const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
                    if (avg > bestAvg) { bestAvg = avg; bestDay = { date: e.date, avg_score: Math.round(avg * 10) / 10 }; }
                    if (avg < worstAvg) { worstAvg = avg; worstDay = { date: e.date, avg_score: Math.round(avg * 10) / 10 }; }
                }
            }
        }

        return Promise.resolve({ averages, mins, maxs, best_day: bestDay, worst_day: worstDay, streak, trend: trends });
    },

    _prevDate: function (d) {
        const dt = new Date(d + "T12:00:00");
        dt.setDate(dt.getDate() - 1);
        return dt.toISOString().split("T")[0];
    },

    getCalendar: function (year, month) {
        const daysInMonth = new Date(year, month, 0).getDate();
        const entries = DB.all(
            "SELECT * FROM entries WHERE user_id = ? AND date >= ? AND date <= ?",
            [DB.currentUser.id, `${year}-${String(month).padStart(2,"0")}-01`,
             `${year}-${String(month).padStart(2,"0")}-${daysInMonth}`]
        );
        const entryMap = {};
        for (const e of entries) entryMap[e.date] = e;

        const fields = ["energy","comfort","productivity","interaction",
                        "sovereignty","self_score","day_score"];
        const result = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const e = entryMap[dateStr];
            if (e) {
                const vals = fields.map(f => e[f]).filter(v => v !== null);
                const avg = vals.length > 0 ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length * 10) / 10 : null;
                result.push({ date: dateStr, avg_score: avg, filled: true });
            } else {
                result.push({ date: dateStr, avg_score: null, filled: false });
            }
        }

        return Promise.resolve(result);
    },

    // === Custom columns ===

    listColumns: function () {
        const cols = DB.all(
            "SELECT * FROM custom_columns WHERE user_id = ? ORDER BY sort_order",
            [DB.currentUser.id]
        );
        return Promise.resolve(cols);
    },

    createColumn: function (data) {
        const maxOrder = DB.get(
            "SELECT MAX(sort_order) as m FROM custom_columns WHERE user_id = ?",
            [DB.currentUser.id]
        );
        const nextOrder = (maxOrder && maxOrder.m !== null) ? maxOrder.m + 1 : 0;
        const id = DB.run(
            "INSERT INTO custom_columns (user_id, name, column_type, sort_order) VALUES (?, ?, ?, ?)",
            [DB.currentUser.id, data.name, data.column_type, nextOrder]
        );
        return Promise.resolve(DB.get("SELECT * FROM custom_columns WHERE id = ?", [id]));
    },

    updateColumn: function (id, data) {
        const fields = [];
        const bind = [];
        if (data.name !== undefined) { fields.push("name = ?"); bind.push(data.name); }
        if (data.column_type !== undefined) { fields.push("column_type = ?"); bind.push(data.column_type); }
        if (data.sort_order !== undefined) { fields.push("sort_order = ?"); bind.push(data.sort_order); }
        if (fields.length === 0) return Promise.reject(new Error("Нет полей для обновления"));
        bind.push(id, DB.currentUser.id);
        DB.run(
            `UPDATE custom_columns SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
            bind
        );
        return Promise.resolve(
            DB.get("SELECT * FROM custom_columns WHERE id = ?", [id])
        );
    },

    deleteColumn: function (id) {
        DB.run("DELETE FROM custom_columns WHERE id = ? AND user_id = ?", [id, DB.currentUser.id]);
        return Promise.resolve(null);
    },

    reorderColumns: function (items) {
        for (const item of items) {
            DB.run(
                "UPDATE custom_columns SET sort_order = ? WHERE id = ? AND user_id = ?",
                [item.sort_order, item.id, DB.currentUser.id]
            );
        }
        return this.listColumns();
    },

    // === First Aid ===

    _getFirstAidItemUrl: function (path) {
        // Эмуляция API — на самом деле всё вызываем напрямую
        return path;
    },

    // Специальный метод для firstaid.js — эмулирует API._request
    _request: function (path, options = {}) {
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : {};

        // Пути: /api/firstaid/items, /api/firstaid/usages, /api/firstaid/stats
        const match = path.match(/\/api\/firstaid\/(\w+)/);
        const resource = match ? match[1] : null;

        if (resource === "items") {
            return this._firstAidItems(path, method, body);
        } else if (resource === "usages") {
            return this._firstAidUsages(path, method, body);
        } else if (resource === "stats") {
            return this._firstAidStats();
        }

        return Promise.reject(new Error("Unknown firstaid endpoint"));
    },

    _firstAidItems: function (path, method, body) {
        if (method === "GET") {
            if (path.includes("/random")) {
                // random
                const url = new URL(path, "http://localhost");
                let sql = "SELECT * FROM first_aid_items WHERE user_id = ? AND is_active = 1";
                const bind = [DB.currentUser.id];
                if (url.searchParams.get("category")) { sql += " AND category = ?"; bind.push(url.searchParams.get("category")); }
                if (url.searchParams.get("action_type")) { sql += " AND action_type = ?"; bind.push(url.searchParams.get("action_type")); }
                const items = DB.all(sql, bind);
                if (items.length === 0) return Promise.resolve(null);
                const item = items[Math.floor(Math.random() * items.length)];
                return Promise.resolve(this._enrichFirstAidItem(item));
            }
            // list
            let sql = "SELECT * FROM first_aid_items WHERE user_id = ?";
            const bind = [DB.currentUser.id];
            const inact = path.includes("include_inactive=true");
            if (!inact) sql += " AND is_active = 1";
            sql += " ORDER BY sort_order";
            const items = DB.all(sql, bind);
            return Promise.resolve(items.map(i => this._enrichFirstAidItem(i)));
        }

        if (method === "POST") {
            const id = DB.run(
                `INSERT INTO first_aid_items (user_id, title, category, action_type, time_cost, duration, feelings, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [DB.currentUser.id, body.title, body.category, body.action_type,
                 body.time_cost || "", body.duration || "", body.feelings || null,
                 (DB.get("SELECT MAX(sort_order) as m FROM first_aid_items WHERE user_id = ?", [DB.currentUser.id])?.m || -1) + 1]
            );
            return Promise.resolve(this._enrichFirstAidItem(
                DB.get("SELECT * FROM first_aid_items WHERE id = ?", [id])
            ));
        }

        if (method === "PUT") {
            const id = parseInt(path.split("/").pop());
            const fields = [], bind = [];
            if (body.title !== undefined) { fields.push("title = ?"); bind.push(body.title); }
            if (body.category !== undefined) { fields.push("category = ?"); bind.push(body.category); }
            if (body.action_type !== undefined) { fields.push("action_type = ?"); bind.push(body.action_type); }
            if (body.time_cost !== undefined) { fields.push("time_cost = ?"); bind.push(body.time_cost); }
            if (body.duration !== undefined) { fields.push("duration = ?"); bind.push(body.duration); }
            if (body.feelings !== undefined) { fields.push("feelings = ?"); bind.push(body.feelings); }
            if (body.is_active !== undefined) { fields.push("is_active = ?"); bind.push(body.is_active ? 1 : 0); }
            if (body.sort_order !== undefined) { fields.push("sort_order = ?"); bind.push(body.sort_order); }
            fields.push("updated_at = datetime('now','localtime')");
            bind.push(id, DB.currentUser.id);
            DB.run(`UPDATE first_aid_items SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`, bind);
            return Promise.resolve(this._enrichFirstAidItem(
                DB.get("SELECT * FROM first_aid_items WHERE id = ?", [id])
            ));
        }

        if (method === "DELETE") {
            const id = parseInt(path.split("/").pop());
            DB.run("DELETE FROM first_aid_items WHERE id = ? AND user_id = ?", [id, DB.currentUser.id]);
            return Promise.resolve(null);
        }

        return Promise.reject(new Error("Unknown method"));
    },

    _firstAidUsages: function (path, method, body) {
        if (method === "GET") {
            let sql = `SELECT fu.*, fi.title as item_title, fi.category as item_category
                       FROM first_aid_usages fu
                       JOIN first_aid_items fi ON fi.id = fu.item_id
                       WHERE fu.user_id = ?`;
            const bind = [DB.currentUser.id];
            const url = new URL(path, "http://localhost");
            if (url.searchParams.get("item_id")) { sql += " AND fu.item_id = ?"; bind.push(parseInt(url.searchParams.get("item_id"))); }
            if (url.searchParams.get("date_from")) { sql += " AND fu.used_at >= ?"; bind.push(url.searchParams.get("date_from")); }
            if (url.searchParams.get("date_to")) { sql += " AND fu.used_at <= ?"; bind.push(url.searchParams.get("date_to") + " 23:59"); }
            sql += " ORDER BY fu.used_at DESC";
            return Promise.resolve(DB.all(sql, bind));
        }

        if (method === "POST") {
            const id = DB.run(
                "INSERT INTO first_aid_usages (item_id, user_id, effectiveness, note) VALUES (?, ?, ?, ?)",
                [body.item_id, DB.currentUser.id, body.effectiveness || null, body.note || null]
            );
            const usage = DB.get(
                `SELECT fu.*, fi.title as item_title, fi.category as item_category
                 FROM first_aid_usages fu JOIN first_aid_items fi ON fi.id = fu.item_id
                 WHERE fu.id = ?`, [id]
            );
            return Promise.resolve(usage);
        }

        if (method === "PUT") {
            const id = parseInt(path.split("/").pop());
            const fields = [], bind = [];
            if (body.effectiveness !== undefined) { fields.push("effectiveness = ?"); bind.push(body.effectiveness); }
            if (body.note !== undefined) { fields.push("note = ?"); bind.push(body.note); }
            if (fields.length === 0) return Promise.reject(new Error("Нет полей"));
            bind.push(id, DB.currentUser.id);
            DB.run(`UPDATE first_aid_usages SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`, bind);
            return Promise.resolve(DB.get(
                `SELECT fu.*, fi.title as item_title, fi.category as item_category
                 FROM first_aid_usages fu JOIN first_aid_items fi ON fi.id = fu.item_id
                 WHERE fu.id = ?`, [id]
            ));
        }

        return Promise.reject(new Error("Unknown method"));
    },

    _firstAidStats: function () {
        const items = DB.all("SELECT COUNT(*) as cnt FROM first_aid_items WHERE user_id = ? AND is_active = 1", [DB.currentUser.id]);
        const totalUsages = DB.all("SELECT COUNT(*) as cnt FROM first_aid_usages WHERE user_id = ?", [DB.currentUser.id]);

        const topItems = DB.all(
            `SELECT fi.id, fi.title, fi.category, COUNT(fu.id) as cnt
             FROM first_aid_usages fu
             JOIN first_aid_items fi ON fi.id = fu.item_id
             WHERE fu.user_id = ?
             GROUP BY fi.id ORDER BY cnt DESC LIMIT 5`,
            [DB.currentUser.id]
        );

        const avgEff = DB.get(
            "SELECT AVG(effectiveness) as avg FROM first_aid_usages WHERE user_id = ? AND effectiveness IS NOT NULL",
            [DB.currentUser.id]
        );

        return Promise.resolve({
            total_items: items[0]?.cnt || 0,
            total_usages: totalUsages[0]?.cnt || 0,
            top_items: topItems.map(t => ({ id: t.id, title: t.title, category: t.category, count: t.cnt })),
            avg_effectiveness: avgEff?.avg ? Math.round(avgEff.avg * 10) / 10 : null,
        });
    },

    _enrichFirstAidItem: function (item) {
        if (!item) return null;
        const usages = DB.all("SELECT effectiveness FROM first_aid_usages WHERE item_id = ?", [item.id]);
        const vals = usages.map(u => u.effectiveness).filter(v => v !== null);
        return {
            ...item,
            is_active: !!item.is_active,
            usage_count: usages.length,
            avg_effectiveness: vals.length > 0 ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length * 10) / 10 : null,
        };
    },
};
