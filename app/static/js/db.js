// ============================================
// SQLite Wasm + OPFS — БД на устройстве пользователя
// ============================================

const DB = {
    db: null,
    currentUser: null,

    // Инициализация SQLite Wasm
    init: async function () {
        if (this.db) return;

        try {
            // sqlite3.js загружен через <script> в HTML
            // и создаёт глобальную функцию sqlite3InitModule
            if (typeof sqlite3InitModule !== "function") {
                throw new Error("SQLite Wasm не загрузился. Проверьте интернет-соединение.");
            }

            const sqlite3 = await sqlite3InitModule();
            this.sqlite3 = sqlite3;

            // Пытаемся открыть БД в OPFS
            if ("storage" in navigator && "getDirectory" in navigator.storage) {
                try {
                    const root = await navigator.storage.getDirectory();
                    // Проверяем, можем ли открыть OPFS
                    await root.getFileHandle("test_opfs", { create: true });
                    this.db = new sqlite3.oo1.OpfsDb("/tracker.db");
                    console.log("✅ SQLite: OPFS mode (данные на диске)");
                } catch (e) {
                    console.warn("OPFS не доступен, fallback на память:", e.message);
                    this.db = new sqlite3.oo1.DB("/memory/tracker.db", "c");
                    this._isMemory = true;
                }
            } else {
                console.warn("OPFS не поддерживается браузером, fallback на память");
                this.db = new sqlite3.oo1.DB("/memory/tracker.db", "c");
                this._isMemory = true;
            }

            // Включаем внешние ключи
            this.db.exec("PRAGMA foreign_keys = ON;");

            // Создаём таблицы
            this._createTables();

            // Загружаем текущего пользователя
            const savedId = localStorage.getItem("current_user_id");
            if (savedId) {
                const rows = this.db.exec({
                    sql: "SELECT * FROM users WHERE id = ?",
                    bind: [parseInt(savedId)],
                    returnValue: "resultRows",
                });
                if (rows.length > 0) {
                    this.currentUser = rows[0];
                }
            }

            return true;
        } catch (e) {
            console.error("❌ SQLite init error:", e);
            throw e;
        }
    },

    _createTables: function () {
        const statements = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )`,

            `CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                date TEXT NOT NULL,
                day_of_week TEXT NOT NULL,
                energy INTEGER,
                comfort INTEGER,
                productivity INTEGER,
                interaction INTEGER,
                sovereignty INTEGER,
                self_score INTEGER,
                day_score INTEGER,
                event TEXT,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime')),
                UNIQUE(user_id, date)
            )`,

            `CREATE TABLE IF NOT EXISTS custom_columns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                column_type TEXT NOT NULL DEFAULT 'rating',
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )`,

            `CREATE TABLE IF NOT EXISTS entry_column_values (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                column_id INTEGER NOT NULL REFERENCES custom_columns(id) ON DELETE CASCADE,
                entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
                value TEXT NOT NULL,
                UNIQUE(column_id, entry_id)
            )`,

            `CREATE TABLE IF NOT EXISTS first_aid_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                action_type TEXT NOT NULL,
                time_cost TEXT DEFAULT '',
                duration TEXT DEFAULT '',
                feelings TEXT,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            )`,

            `CREATE TABLE IF NOT EXISTS first_aid_usages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES first_aid_items(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                used_at TEXT DEFAULT (datetime('now','localtime')),
                effectiveness INTEGER,
                note TEXT
            )`,
        ];

        for (const stmt of statements) {
            try {
                this.db.exec(stmt);
            } catch (e) {
                console.warn("Table creation:", e.message);
            }
        }
    },

    // --- SQL методы ---

    run: function (sql, params = []) {
        try {
            this.db.exec({
                sql: sql,
                bind: params.map(p => p === undefined ? null : p),
                returnValue: "resultRows",
            });
            if (sql.trim().toUpperCase().startsWith("INSERT")) {
                const rows = this.db.exec({
                    sql: "SELECT last_insert_rowid() as id",
                    bind: [],
                    returnValue: "resultRows",
                });
                return rows.length > 0 ? rows[0].id : null;
            }
            return true;
        } catch (e) {
            console.error("DB run:", e.message, sql);
            throw e;
        }
    },

    get: function (sql, params = []) {
        try {
            const rows = this.db.exec({
                sql: sql,
                bind: params.map(p => p === undefined ? null : p),
                returnValue: "resultRows",
            });
            return rows.length > 0 ? rows[0] : null;
        } catch (e) {
            console.error("DB get:", e.message, sql);
            return null;
        }
    },

    all: function (sql, params = []) {
        try {
            return this.db.exec({
                sql: sql,
                bind: params.map(p => p === undefined ? null : p),
                returnValue: "resultRows",
            });
        } catch (e) {
            console.error("DB all:", e.message, sql);
            return [];
        }
    },

    // --- Seed данных ---

    seedFirstAid: function () {
        if (!this.currentUser) return;
        const rows = this.all(
            "SELECT COUNT(*) as cnt FROM first_aid_items WHERE user_id = ?",
            [this.currentUser.id]
        );
        if (rows.length > 0 && rows[0].cnt > 0) return;

        const seed = [
            { title: "Замедленное дыхание: удлинённый выдох", category: "anxiety", action_type: "instant", time_cost: "1-2 минуты", duration: "15-60 минут", feelings: "Выдох на 6-8 счетов при вдохе на 4 — тело получает сигнал, что опасность прошла." },
            { title: "Удар холода: лёд к лицу или запястьям", category: "anxiety", action_type: "instant", time_cost: "1-2 минуты", duration: "15-30 минут", feelings: "Холод резко переключает нервную систему. Паника отступает." },
            { title: "Тряска конечностями", category: "fatigue", action_type: "instant", time_cost: "30-60 секунд", duration: "10-30 минут", feelings: "Встряхивание рук и ног сбрасывает мышечное возбуждение." },
            { title: "Обратный счёт: 5-4-3-2-1", category: "anxiety", action_type: "instant", time_cost: "1-2 минуты", duration: "15-30 минут", feelings: "5 предметов, 4 звука, 3 ощущения, 2 запаха, 1 цвет — возвращает в реальность." },
            { title: "Мышечный сброс: напряжение-расслабление", category: "negativity", action_type: "instant", time_cost: "1 минута", duration: "15-30 минут", feelings: "Напрячь всё тело на 5 сек, расслабить. При упадке — тонус, при стрессе — покой." },
            { title: "Яркий вкус: имбирь, мята, гвоздика", category: "apathy", action_type: "instant", time_cost: "1-2 минуты", duration: "15-30 минут", feelings: "Резкий вкус отвлекает от зацикленных мыслей, встряхивает." },
        ];

        for (let i = 0; i < seed.length; i++) {
            const s = seed[i];
            this.run(
                `INSERT INTO first_aid_items (user_id, title, category, action_type, time_cost, duration, feelings, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [this.currentUser.id, s.title, s.category, s.action_type, s.time_cost, s.duration, s.feelings, i]
            );
        }
        console.log("✅ Seed: 6 стартовых допингов добавлены");
    },
};
