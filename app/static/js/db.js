// ============================================
// SQLite через sql.js — БД на устройстве пользователя
// ============================================

const DB = {
    db: null,
    currentUser: null,
    _dirty: false,
    _saveTimer: null,
    _initPromise: null,  // защита от гонки при параллельных вызовах init()

    // Инициализация sql.js
    init: async function () {
        if (this.db) return this.db;
        if (this._initPromise) return this._initPromise;

        this._initPromise = this._doInit();
        return this._initPromise;
    },

    _doInit: async function () {
        const SQL_URL = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/";

        try {
            // Ждём, пока initSqlJs появится в window (загружен через <script>)
            if (typeof initSqlJs !== "function") {
                console.log("⏳ Ожидание загрузки sql.js...");
                await new Promise((resolve, reject) => {
                    const check = () => {
                        if (typeof initSqlJs === "function") return resolve();
                        setTimeout(check, 100);
                    };
                    setTimeout(() => reject(new Error("sql.js не загрузился за 30 секунд")), 30000);
                    check();
                });
            }

            const SQL = await initSqlJs({
                locateFile: file => SQL_URL + file
            });
            this.SQL = SQL;

            // Пытаемся загрузить существующую БД с диска
            let savedData = null;

            // 1. Пробуем OPFS
            if ("storage" in navigator && "getDirectory" in navigator.storage) {
                try {
                    const root = await navigator.storage.getDirectory();
                    const fileHandle = await root.getFileHandle("tracker.db", { create: false });
                    const file = await fileHandle.getFile();
                    savedData = new Uint8Array(await file.arrayBuffer());
                    console.log("📂 Загружено из OPFS");
                } catch (e) {
                    // Файла ещё нет — нормально
                }
            }

            // 2. Fallback на localStorage
            if (!savedData) {
                const local = localStorage.getItem("tracker_db");
                if (local) {
                    try {
                        const arr = JSON.parse(local);
                        savedData = new Uint8Array(arr);
                        console.log("📂 Загружено из localStorage (" + arr.length + " байт)");
                    } catch (e) {
                        console.warn("Ошибка загрузки из localStorage, стартуем чистую БД");
                    }
                }
                }
            }

            // Открываем БД (с данными или пустую)
            if (savedData) {
                this.db = new SQL.Database(savedData);
            } else {
                this.db = new SQL.Database();
            }

            // Создаём таблицы
            this._createTables();

            // Загружаем текущего пользователя
            const savedId = localStorage.getItem("current_user_id");
            if (savedId) {
                const rows = this.all("SELECT * FROM users WHERE id = ?", [parseInt(savedId)]);
                if (rows.length > 0) {
                    this.currentUser = rows[0];
                }
            }

            console.log("✅ SQLite (sql.js) инициализирован");

            // Сохраняем БД при закрытии страницы
            window.addEventListener("beforeunload", () => {
                if (this.db) this._save();
            });

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
            try { this.db.run(stmt); } catch (e) { console.warn("Table:", e.message); }
        }
    },

    // --- Сохранение БД на диск (синхронное) ---

    _save: function () {
        try {
            const data = this.db.export();
            const bytes = new Uint8Array(data);
            // Сохраняем как JSON-массив чисел — 100% надёжно (не btoa)
            localStorage.setItem("tracker_db", JSON.stringify(Array.from(bytes)));
        } catch (e) {
            console.warn("Save error:", e);
        }
    },

    // Асинхронное сохранение в OPFS (если доступен) — поверх localStorage
    _saveOpfs: async function () {
        if (!("storage" in navigator && "getDirectory" in navigator.storage)) return;
        try {
            const data = this.db.export();
            const root = await navigator.storage.getDirectory();
            const fileHandle = await root.getFileHandle("tracker.db", { create: true });
            const accessHandle = await fileHandle.createSyncAccessHandle();
            accessHandle.truncate(0);
            accessHandle.write(data);
            accessHandle.flush();
            accessHandle.close();
        } catch (e) {
            // OPFS не обязателен — localStorage достаточно
        }
    },

    // --- SQL методы (адаптированы под sql.js) ---

    run: function (sql, params = []) {
        try {
            this.db.run(sql, params.map(p => p === undefined ? null : p));
            this._save();  // синхронное сохранение в localStorage
            // OPFS — асинхронно, не блокирует
            this._saveTimer = this._saveTimer || setTimeout(() => { this._saveTimer = null; this._saveOpfs(); }, 1000);
            if (sql.trim().toUpperCase().startsWith("INSERT")) {
                const rows = this._execRaw("SELECT last_insert_rowid() as id");
                return rows.length > 0 ? rows[0].id : null;
            }
            return true;
        } catch (e) {
            console.error("DB run:", e.message, sql);
            throw e;
        }
    },

    get: function (sql, params = []) {
        const rows = this.all(sql, params);
        return rows.length > 0 ? rows[0] : null;
    },

    all: function (sql, params = []) {
        return this._execRaw(sql, params);
    },

    _execRaw: function (sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            if (params.length > 0) stmt.bind(params.map(p => p === undefined ? null : p));
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            stmt.free();
            return rows;
        } catch (e) {
            console.error("DB query:", e.message, sql);
            return [];
        }
    },

    // --- Seed данных ---

    seedFirstAid: function () {
        if (!this.currentUser) return;
        const rows = this.all("SELECT COUNT(*) as cnt FROM first_aid_items WHERE user_id = ?", [this.currentUser.id]);
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
