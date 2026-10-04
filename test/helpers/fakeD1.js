const sqlite3 = require("sqlite3");

// The subset of the Cloudflare D1 binding the stats worker uses, backed by an
// in-memory SQLite database so the real SQL runs.
function createD1() {
  const db = new sqlite3.Database(":memory:");
  const run = (sql, params) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve({ success: true, meta: { changes: this.changes } });
      });
    });
  const all = (sql, params) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ success: true, results: rows });
      });
    });
  const statement = (sql, params) => ({
    bind: (...next) => statement(sql, next),
    run: () => run(sql, params),
    all: () => all(sql, params),
    first: async () => (await all(sql, params)).results[0] ?? null,
  });
  return {
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      await run("BEGIN", []);
      try {
        const results = [];
        for (const item of statements) {
          results.push(await item.run());
        }
        await run("COMMIT", []);
        return results;
      } catch (error) {
        await run("ROLLBACK", []);
        throw error;
      }
    },
    exec: (sql) =>
      new Promise((resolve, reject) => {
        db.exec(sql, (error) => (error ? reject(error) : resolve()));
      }),
    rows: (sql, params = []) => all(sql, params).then((result) => result.results),
    close: () => new Promise((resolve) => db.close(() => resolve())),
  };
}

module.exports = { createD1 };
