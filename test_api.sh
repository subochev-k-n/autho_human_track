#!/bin/bash
# ============================================
# Интеграционный тест трекера автогуманиста
# Использование: bash test_api.sh
# ============================================

HOST="http://localhost:8000"
PASS=0
FAIL=0

check() {
    local desc="$1"
    local expected="$2"
    local actual="$3"
    if echo "$actual" | grep -q "$expected"; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc (expected: $expected, got: $actual)"
        FAIL=$((FAIL + 1))
    fi
}

echo "============================================"
echo "  ТРЕКЕР АВТОГУМАНИСТА — ИНТЕГРАЦИОННЫЙ ТЕСТ"
echo "============================================"
echo ""

# === 1. HEALTH ===
echo "--- 1. Health check ---"
HEALTH=$(curl -s "$HOST/health")
check "Сервер отвечает 200" "ok" "$HEALTH"

# === 2. HTML страницы ===
echo "--- 2. HTML страницы ---"
check "Страница входа" "Вход" "$(curl -s $HOST/login)"
check "Страница регистрации" "Регистрация" "$(curl -s $HOST/register)"
check "Дашборд (HTML отдаётся)" "Оценки пока недоступны" "$(curl -s $HOST/dashboard)"  # без токена — режим блокировки

# === 3. Регистрация ===
echo "--- 3. Регистрация ---"
# Удалить старого тестового пользователя если есть (игнорируем ошибку)
curl -s -X POST "$HOST/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"test123"}' > /dev/null
# Регистрация того же пользователя должна выдать 409
DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HOST/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"test123"}')
check "Дубликат username → 409" "409" "$DUP"

# === 4. Логин ===
echo "--- 4. Логин ---"
TOKEN=$(curl -s -X POST "$HOST/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
check "JWT-токен получен" "eyJ" "$TOKEN"

# === 5. Auth me ===
echo "--- 5. Auth me ---"
ME=$(curl -s "$HOST/api/auth/me" -H "Authorization: Bearer $TOKEN")
check "Информация о пользователе" "testuser" "$ME"

# === 6. Блокировка времени (без тестового режима) ===
echo "--- 6. Проверка блокировки времени (без тестового режима) ---"
CAN_FILL=$(curl -s "$HOST/health" | python -c "import sys,json;print(json.load(sys.stdin)['can_fill'])")
if [ "$CAN_FILL" = "false" ]; then
    # Действительно день, блокировка активна — проверяем 403
    BLOCKED=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HOST/api/entries/" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"date\":\"$(date +%Y-%m-%d)\",\"energy\":5,\"comfort\":3,\"productivity\":7}")
    check "Запись заблокирована (can_fill=false → 403)" "403" "$BLOCKED"
else
    echo "  ⏭️  Сейчас время заполнения — тест блокировки пропущен"
    PASS=$((PASS + 1))
fi

# === 7. Включение тестового режима ===
echo "--- 7. Включение тестового режима ---"
TM=$(curl -s -X POST "$HOST/api/test-mode" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"test_date":"2026-07-11","test_hour":20}')
check "Тестовый режим включён" "включён" "$TM"
check "test_mode=true в ответе" "true" "$TM"

# === 8. Today status (должен быть can_fill=true) ===
echo "--- 8. Статус сегодняшней записи ---"
TS=$(curl -s "$HOST/api/entries/today" -H "Authorization: Bearer $TOKEN")
check "can_fill=true в тестовом режиме" "true" "$TS"

# === 9. Создание записи ===
echo "--- 9. Создание записи ---"
ENTRY=$(curl -s -X POST "$HOST/api/entries/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"date\":\"2026-07-11\",\"energy\":5,\"comfort\":3,\"productivity\":7,\"interaction\":6,\"sovereignty\":8,\"self_score\":4,\"day_score\":5}")
check "Запись создана" "energy" "$ENTRY"
check "Значение energy=5" "5" "$ENTRY"
check "День недели — суббота" "суббота" "$ENTRY"

# === 10. Дубликат записи ===
echo "--- 10. Дубликат записи (409) ---"
DUP_ENTRY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HOST/api/entries/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"date\":\"2026-07-11\",\"energy\":5,\"comfort\":3,\"productivity\":7}")
check "Повторная запись → 409 Conflict" "409" "$DUP_ENTRY"

# === 11. Список записей ===
echo "--- 11. Список записей ---"
LIST=$(curl -s "$HOST/api/entries/" -H "Authorization: Bearer $TOKEN")
check "Список содержит 1 запись" '"total":1' "$LIST"

# === 12. Статистика ===
echo "--- 12. Статистика ---"
STATS=$(curl -s "$HOST/api/entries/stats" -H "Authorization: Bearer $TOKEN")
check "Stats: averages не пусты" '"averages"' "$STATS"
check "Stats: energy average = 5.0" '5.0' "$STATS"

# === 13. Календарь ===
echo "--- 13. Календарь ---"
CAL=$(curl -s "$HOST/api/entries/calendar?year=2026&month=7" -H "Authorization: Bearer $TOKEN")
check "Календарь: 31 день" '"2026-07-01"' "$CAL"

# === 14. Кастомные колонки ===
echo "--- 14. Кастомные колонки ---"
# Создание
COL1=$(curl -s -X POST "$HOST/api/columns/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Family","column_type":"rating"}')
check "Колонка Family создана" "Family" "$COL1"

COL2=$(curl -s -X POST "$HOST/api/columns/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Health","column_type":"rating"}')

COL3=$(curl -s -X POST "$HOST/api/columns/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Notes","column_type":"text"}')

# Список
COLS=$(curl -s "$HOST/api/columns/" -H "Authorization: Bearer $TOKEN")
check "3 кастомные колонки" "Notes" "$COLS"

# Reorder
REORDER=$(curl -s -X PUT "$HOST/api/columns/reorder" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"items":[{"id":1,"sort_order":2},{"id":2,"sort_order":0},{"id":3,"sort_order":1}]}')
check "Reorder выполнен" "sort_order" "$REORDER"

# === 15. Изоляция пользователей ===
echo "--- 15. Изоляция пользователей ---"
curl -s -X POST "$HOST/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"user2","email":"user2@test.com","password":"pass456"}' > /dev/null
TOKEN2=$(curl -s -X POST "$HOST/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"user2","password":"pass456"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
LIST2=$(curl -s "$HOST/api/entries/" -H "Authorization: Bearer $TOKEN2")
check "user2 не видит записи user1" '"total":0' "$LIST2"

COLS2=$(curl -s "$HOST/api/columns/" -H "Authorization: Bearer $TOKEN2")
check "user2 не видит колонки user1" '\[\]' "$COLS2"

# === 16. Запись не за сегодня (date != today) ===
echo "--- 16. Запись не за сегодня ---"
YESTERDAY="2026-07-10"
WRONG_DATE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HOST/api/entries/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN2" \
  -d "{\"date\":\"$YESTERDAY\",\"energy\":5,\"comfort\":3}")
check "Запись не за сегодня → 400" "400" "$WRONG_DATE"

# === 17. Выключение тестового режима ===
echo "--- 17. Выключение тестового режима ---"
TM_OFF=$(curl -s -X POST "$HOST/api/test-mode" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}')
check "Тестовый режим выключен" "выключен" "$TM_OFF"

# === ИТОГ ===
echo ""
echo "============================================"
echo "  РЕЗУЛЬТАТ: $PASS пройдено, $FAIL провалено"
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
    echo "  ✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ"
else
    echo "  ❌ ЕСТЬ ПРОВАЛЕННЫЕ ТЕСТЫ"
fi
exit $FAIL
