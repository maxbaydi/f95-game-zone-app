# ADR 0005: Engine-Aware Save Profile Strategies

## context

The app could only detect Ren'Py save locations reliably. That was already too narrow for the actual F95 Windows library, where save data also lives in:

- install-relative save directories
- install-root save files for older RPG Maker variants
- `%AppData%`
- `%LocalAppData%`
- `%LocalLow%`

Trying to bolt every engine-specific path directly into vault backup, cloud sync, restore and delete logic would create the exact architectural mess this project is supposed to avoid.

At the same time, backing up an entire install directory just because a game writes `Save01.rvdata2` into its root would be a data-safety failure and a bandwidth/storage bug.

## decision

Introduce an engine-aware save profile model with reusable strategy types instead of hardcoding Ren'Py rules everywhere.

The save subsystem now works with these strategy classes:

- `install-relative`
- `install-file-patterns`
- `windows-known-folder`
- legacy `renpy-appdata` support for backward compatibility with older stored profiles/manifests

Detection remains in the Electron main process and now maps popular Windows engine layouts onto those strategies. Backup, restore, cloud archive generation and safe delete all resolve paths through the same strategy layer.

## alternatives

1. Keep extending the Ren'Py detector with unrelated engine rules.
Rejected because the file would become a grab bag of path heuristics with no clean contract for vault/cloud/delete flows.

2. Represent every engine as a bespoke strategy type.
Rejected because it would duplicate the same path-resolution behavior under different names and would make restore/delete logic harder to reason about.

3. Back up whole install folders when exact save files are hard to model.
Rejected because it risks copying game binaries/content, wastes storage, and violates the priority order where user data safety and reproducibility come before convenience.

## consequences

- the app can now describe and transport save locations from multiple engines through one consistent contract
- older Ren'Py manifests remain restorable because the legacy `renpy-appdata` strategy is still understood
- new engines can be added by mapping their save locations onto an existing strategy instead of rewriting the whole save stack
- some engines still rely on heuristic folder matching in Windows app-data roots, so manual smoke validation against real installs remains necessary
