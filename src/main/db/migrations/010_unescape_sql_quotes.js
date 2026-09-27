// @ts-check

/**
 * Older releases doubled every apostrophe ("O'Neil" -> "O''Neil") before
 * binding the value as a parameter, so the doubled form was stored verbatim.
 * That broke folder paths with apostrophes (the recorded path never existed),
 * version lookups and title display. The data layer now binds raw values and
 * this migration repairs the rows that were written the old way.
 *
 * `UPDATE OR IGNORE` keeps a row escaped if unescaping it would collide with a
 * clean duplicate; such rows are rare and remain readable.
 */
module.exports = {
  version: 10,
  name: "unescape_sql_quotes",
  statements: [
    `
      UPDATE OR IGNORE games
      SET
        title = REPLACE(title, '''''', ''''),
        creator = REPLACE(creator, '''''', ''''),
        engine = REPLACE(engine, '''''', '''')
      WHERE title LIKE '%''''%' OR creator LIKE '%''''%' OR engine LIKE '%''''%';
    `,
    `
      UPDATE OR IGNORE versions
      SET
        version = REPLACE(version, '''''', ''''),
        game_path = REPLACE(game_path, '''''', ''''),
        exec_path = REPLACE(exec_path, '''''', '''')
      WHERE version LIKE '%''''%' OR game_path LIKE '%''''%' OR exec_path LIKE '%''''%';
    `,
    `
      UPDATE OR IGNORE banners
      SET path = REPLACE(path, '''''', '''')
      WHERE path LIKE '%''''%';
    `,
    `
      UPDATE OR IGNORE previews
      SET path = REPLACE(path, '''''', '''')
      WHERE path LIKE '%''''%';
    `,
  ],
};
