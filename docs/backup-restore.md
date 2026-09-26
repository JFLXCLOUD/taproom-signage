# Backup and restore

Version 1.2.2 introduces complete version-2 JSON backups. Use **Venue > App tools &
backups > Download backup**. They contain menu/section/item/price records, poster
content and absolute expiry metadata, image bytes and checksums, venue settings,
rotations, TV identity/assignment/orientation, and ordering/visibility. Passwords,
sessions, the listening port and OS service configuration are excluded.

## Restore modes

- Add content creates new menu and rotation IDs, remaps rotation links, and gives
  conflicting display addresses a suffix. Current settings and TVs are preserved.
- Replace restores content, settings and TV records with their original IDs in a
  single database transaction. TV last-seen times reset to zero until real devices
  reconnect. Download a destination backup before replacing it.

Selecting a file does not start a restore. Review its counts and warnings, confirm
replacement if selected, then apply. If the server changes after review, review
again. Validation completes before writes. New image files are removed on a
database rollback. Existing image files are never overwritten or removed; an
image-name collision with different bytes gets a new name and remapped references.
Unreferenced existing uploads remain available on disk.

Limits are 128 MB per JSON backup, 64 MB of image bytes total, and 4 MB per image.
Image paths, supported types, decoded byte lengths and SHA-256 hashes are checked.
The download fails explicitly if image files or references are missing rather
than reporting a successful but incomplete backup.

## Older files and migration

Version-1 exports contain no image bytes. They also cannot be restored completely
by the pre-1.2.2 importer, which omits poster content, rotations and TV assignments.
The new importer accepts version-1 records only if their referenced images already
exist on the destination. Otherwise use a complete backup from an updated source,
or copy the original data directory while both applications using it are stopped.

Server addresses are device settings, not part of the backup. Moving from port
8100 to 8099 requires the TVs to use the new address even when their identity and
content assignments have been restored. A browser's local storage belongs to an
origin (including its port), so a browser display may need pairing again after a
port change.

## Validation

Run `npm run verify:backups` for isolated two-server coverage. Set
`PLAYWRIGHT_MODULE` to a Playwright `index.mjs` path for the mobile browser flow.
Tests cover cross-server image/content restore, expiry across server timezones,
TV IDs and assignments, append remapping, repeated replacement, legacy files,
invalid references/paths/checksums, stale previews, and a forced SQL failure that
proves database rollback and image cleanup. Browser tests cover download,
selection without mutation, review, confirmation, restore/reload and invalid-file
recovery.
