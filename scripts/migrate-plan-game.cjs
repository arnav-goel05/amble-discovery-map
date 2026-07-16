const path = require("node:path");
const { SqliteGameRepository } = require("./lib/game-repository.cjs");

const root = process.env.PLAN_STORE_ROOT || path.join(process.cwd(), "outputs", "plans");
const repository = new SqliteGameRepository({ root });
try {
  console.log(JSON.stringify({ ok: true, storage: "sqlite", databasePath: repository.databasePath, ...repository.counts() }));
} finally {
  repository.close();
}
