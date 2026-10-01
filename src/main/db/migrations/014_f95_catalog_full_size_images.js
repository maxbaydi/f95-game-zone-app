// @ts-check

/**
 * Covers and screenshots written by the first catalog syncs pointed at the
 * preview host (scaled copies). The parser now stores the full-size
 * attachments URL (same path, other host); rows already stored are moved
 * the same way so cached images are downloaded at full size from now on.
 */
module.exports = {
  version: 14,
  name: "f95_catalog_full_size_images",
  statements: [
    `
      UPDATE f95_catalog
      SET cover_url = REPLACE(cover_url, 'https://preview.f95zone.to/', 'https://attachments.f95zone.to/'),
          screens = REPLACE(screens, 'https://preview.f95zone.to/', 'https://attachments.f95zone.to/')
      WHERE cover_url LIKE 'https://preview.f95zone.to/%' OR screens LIKE '%https://preview.f95zone.to/%';
    `,
  ],
};
