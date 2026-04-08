// @ts-check

module.exports = {
  version: 8,
  name: "game_favorites",
  statements: [
    `
      ALTER TABLE games
      ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_games_is_favorite
      ON games (is_favorite);
    `,
  ],
};
