# Changelog

All notable RaceIQ changes will be recorded here.

## 1.0.2 — Racer name repair

- Automatically repairs already-synced results that only contain player IDs.
- Uses the faction roster first for faction-member names.
- Falls back to cached names, then Torn's user/basic endpoint.
- Adds name-repair diagnostics with source counts.
- Repairs existing season data on startup without resetting results.

## 1.0.0 — Initial release

- Added standalone TornPDA race management.
- Added 8-week qualifying season support.
- Added 4-week Championship support.
- Added Torn race discovery and result syncing.
- Added faction-only racer filtering.
- Added qualifying standings, Top 8, and Bubble Watch.
- Added participation statistics including starts, wins, podiums, best finish, and average finish.
- Added random weekly prize drawings with unique winners.
- Added prize inventory and prize history.
- Added Championship finalist locking and standings.
- Added Share Center and copyable race/standings/prize posts.
- Added weekly race announcement and results-message generation.
- Added diagnostics.
- Added PDA_storage persistence and backup/import tools.
