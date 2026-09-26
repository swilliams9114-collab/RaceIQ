# RaceIQ

RaceIQ is a mobile-first TornPDA userscript for managing the Aurora Surrealis racing program without requiring Google Sheets.

## Current version

**1.0.2**

## Core features

- 8 qualifying races and 4 Championship races
- Torn race discovery and race-result syncing
- Aurora Surrealis faction-member eligibility filtering
- Qualifying standings, Top 8, Bubble Watch, starts, wins, and podiums
- Championship Top 8 lock, points reset, and Championship standings
- Weekly random prize drawings with unique winners
- Prize inventory and prize history
- Share Center with copyable standings, results, prize winners, and race messages
- Full and short weekly race announcement generators
- Diagnostics
- PDA_storage persistence
- Backup/import support and automatic safety snapshots

## TornPDA installation

RaceIQ is intended to be distributed through Greasy Fork. The GitHub repository is the source of truth; Greasy Fork synchronizes from `RaceIQ.user.js`, and TornPDA updates the installed Greasy Fork script.

## Update workflow

1. Update `RaceIQ.user.js` in GitHub.
2. Increment the userscript `@version`.
3. Commit the change.
4. Greasy Fork syncs from GitHub.
5. Update the script in TornPDA.

## Data

RaceIQ stores season data in TornPDA `PDA_storage`. Race results, prize history, settings, and backups are not stored in this GitHub repository.

## Safety

Before major operations such as Championship start, prize drawings, imports, and resets, RaceIQ creates internal snapshots when TornPDA storage is available.
