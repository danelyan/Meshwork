// Unit-тесты не читают .env и не ходят в БД: безопасные значения по умолчанию.
process.env.SESSION_SECRET ??= 'unit-test-secret-unit-test-secret-0000';
process.env.DATABASE_URL ??= 'postgresql://postgres@127.0.0.1:1/unit_tests_have_no_db';
process.env.LLM_PROVIDER ??= 'stub';
