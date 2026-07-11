// ============================================
// Тесты локального хранения (sql.js)
// Запуск: node test_db.js
// ============================================

const initSqlJs = require("sql.js");

let db, PASS, FAIL;

function all(sql, params) {
    const stmt = db.prepare(sql);
    if (params && params.length) stmt.bind(params.map(p => p === undefined ? null : p));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function get(sql, params) {
    const rows = all(sql, params);
    return rows.length ? rows[0] : null;
}

function run(sql, params) {
    db.run(sql, (params || []).map(p => p === undefined ? null : p));
    if (sql.trim().toUpperCase().startsWith("INSERT")) {
        return get("SELECT last_insert_rowid() as id").id;
    }
    return true;
}

function check(desc, expected, actual) {
    const ok = typeof expected === "function" ? expected(actual) : actual === expected;
    if (ok) { console.log("  ✅ " + desc); PASS++; }
    else { console.log("  ❌ " + desc + " (ожидалось: " + JSON.stringify(expected) + ", получено: " + JSON.stringify(actual) + ")"); FAIL++; }
}

function createTables(database) {
    database.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')))");
    database.run("CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL, day_of_week TEXT NOT NULL, energy INTEGER, comfort INTEGER, productivity INTEGER, interaction INTEGER, sovereignty INTEGER, self_score INTEGER, day_score INTEGER, event TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(user_id, date))");
    database.run("CREATE TABLE IF NOT EXISTS custom_columns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, column_type TEXT NOT NULL DEFAULT 'rating', sort_order INTEGER DEFAULT 0)");
    database.run("CREATE TABLE IF NOT EXISTS entry_column_values (id INTEGER PRIMARY KEY AUTOINCREMENT, column_id INTEGER NOT NULL REFERENCES custom_columns(id) ON DELETE CASCADE, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE, value TEXT NOT NULL, UNIQUE(column_id, entry_id))");
    database.run("CREATE TABLE IF NOT EXISTS first_aid_items (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, category TEXT NOT NULL, action_type TEXT NOT NULL, time_cost TEXT DEFAULT '', duration TEXT DEFAULT '', feelings TEXT, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))");
    database.run("CREATE TABLE IF NOT EXISTS first_aid_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES first_aid_items(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), used_at TEXT DEFAULT (datetime('now','localtime')), effectiveness INTEGER, note TEXT)");
}

const seed = [
    { title: "Замедленное дыхание: удлинённый выдох", category: "anxiety", action_type: "instant", time_cost: "1-2 минуты", duration: "15-60 минут" },
    { title: "Удар холода: лёд к лицу или запястьям", category: "anxiety", action_type: "instant", time_cost: "1-2 минуты", duration: "15-30 минут" },
    { title: "Тряска конечностями", category: "fatigue", action_type: "instant", time_cost: "30-60 секунд", duration: "10-30 минут" },
];

async function main() {
    PASS = 0; FAIL = 0;
    console.log("============================================");
    console.log("  ТЕСТЫ ЛОКАЛЬНОГО ХРАНЕНИЯ (sql.js)");
    console.log("============================================\n");

    const SQL = await initSqlJs();
    db = new SQL.Database();
    createTables(db);

    console.log("--- 1. Создание профиля (регистрация) ---");
    const id1 = run("INSERT INTO users (username) VALUES (?)", ["alice"]);
    check("INSERT вернул id = 1", 1, id1);
    const user1 = get("SELECT * FROM users WHERE id = ?", [1]);
    check("Пользователь создан с username = alice", "alice", user1.username);
    check("id = 1", 1, user1.id);
    check("created_at не пустая", d => d && d.length > 0, user1.created_at);

    console.log("\n--- 2. Вход (логин) ---");
    const loginUser = get("SELECT * FROM users WHERE username = ?", ["alice"]);
    check("Пользователь найден по username", "alice", loginUser.username);
    check("id совпадает", 1, loginUser.id);
    const noUser = get("SELECT * FROM users WHERE username = ?", ["bob"]);
    check("Несущ. пользователь → null", null, noUser);

    console.log("\n--- 3. Дубликаты (UNIQUE) ---");
    try {
        run("INSERT INTO users (username) VALUES (?)", ["alice"]);
        console.log("  ❌ Дубликат — ошибка не выброшена");
        FAIL++;
    } catch (e) {
        check("Дубликат username → UNIQUE constraint", true, (e.message || "").includes("UNIQUE"));
    }

    console.log("\n--- 4. Множественные пользователи ---");
    const id2 = run("INSERT INTO users (username) VALUES (?)", ["bob"]);
    check("bob id = 2", 2, id2);
    const users = all("SELECT username FROM users ORDER BY username");
    check("Всего 2 пользователя", 2, users.length);
    check("alice < bob", "alice", users[0].username);

    console.log("\n--- 5. Изоляция данных ---");
    run("INSERT INTO entries (user_id, date, day_of_week, energy, comfort, productivity, interaction, sovereignty, self_score, day_score) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [1, "2026-07-11", "суббота", 5, 3, 7, 6, 8, 4, 5]);
    check("У alice 1 запись", 1, all("SELECT * FROM entries WHERE user_id = ?", [1]).length);
    check("У bob 0 записей", 0, all("SELECT * FROM entries WHERE user_id = ?", [2]).length);

    console.log("\n--- 6. Seed аптечки (First Aid) ---");
    const cnt = get("SELECT COUNT(*) as cnt FROM first_aid_items WHERE user_id = ?", [1]);
    if (cnt && cnt.cnt === 0) {
        for (let i = 0; i < seed.length; i++) {
            const s = seed[i];
            run("INSERT INTO first_aid_items (user_id, title, category, action_type, time_cost, duration, sort_order) VALUES (?,?,?,?,?,?,?)",
                [1, s.title, s.category, s.action_type, s.time_cost, s.duration, i]);
        }
    }
    check("После seed: 3 допинга", 3, all("SELECT * FROM first_aid_items WHERE user_id = ?", [1]).length);
    check("У bob 0 допингов (изоляция)", 0, all("SELECT * FROM first_aid_items WHERE user_id = ?", [2]).length);

    console.log("\n--- 7. Кастомные колонки ---");
    const colId = run("INSERT INTO custom_columns (user_id, name, column_type, sort_order) VALUES (?,?,?,?)", [1, "Семья", "rating", 0]);
    check("Колонка 'Семья' id=1", 1, colId);
    check("У bob 0 колонок", 0, all("SELECT * FROM custom_columns WHERE user_id = ?", [2]).length);

    console.log("\n--- 8. Entry с кастомными значениями ---");
    const eid = run("INSERT INTO entries (user_id, date, day_of_week, energy) VALUES (?,?,?,?)", [1, "2026-07-12", "воскресенье", 8]);
    run("INSERT INTO entry_column_values (column_id, entry_id, value) VALUES (?,?,?)", [1, eid, "7"]);
    check("Кастомное значение сохранено", "7", get("SELECT * FROM entry_column_values WHERE entry_id = ?", [eid]).value);

    console.log("\n--- 9. Сохранение и перезагрузка БД ---");
    const exported = db.export();
    check("Экспорт вернул данные", true, exported.byteLength > 0);
    const db2 = new SQL.Database(exported);
    const stmt = db2.prepare("SELECT COUNT(*) as cnt FROM users"); stmt.step();
    const r2 = stmt.getAsObject(); stmt.free();
    check("После перезагрузки: 2 пользователя", 2, r2.cnt);

    console.log("\n--- 10. Валидация полей ---");
    try {
        run("INSERT INTO users (username) VALUES (?)", [null]);
        console.log("  ❌ NULL username — ошибка не выброшена");
        FAIL++;
    } catch (e) {
        check("NOT NULL constraint сработал", true, true);
    }

    // --- ИТОГ ---
    console.log("\n============================================");
    console.log("  РЕЗУЛЬТАТ: " + PASS + " пройдено, " + FAIL + " провалено");
    console.log("============================================");
    if (FAIL === 0) console.log("  ✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ");
    else console.log("  ❌ ЕСТЬ ПРОВАЛЕННЫЕ ТЕСТЫ");
    process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(e => { console.error("Ошибка:", e); process.exit(1); });
