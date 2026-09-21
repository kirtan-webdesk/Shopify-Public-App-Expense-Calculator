# g4-sprint-3.1-m4 (archived evidence)

`live-evidence.ts` in this folder is ARCHIVED and must not be run: it calls the removed
`getDuplicatePrefill(ctx, id, rules)` signature and connects with `DATABASE_URL` (the hosted database),
which the current test-db and migrate guards forbid. The logs and records here are the historical
evidence for G4-sprint-3.1; the current DB coverage is `tests/db/*.db.test.ts` (RUN_DB_TESTS=1 with
TEST_DATABASE_URL, see tests/README.md).
