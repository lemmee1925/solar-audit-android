# Target architecture (working decision)

## User interface

A locally bundled React + TypeScript application. The UI is recreated from the existing Flask/Jinja PWA. The same screen components are used regardless of connectivity.

## Repository/data boundary

Screens call application services/repositories rather than directly calling `fetch`, IndexedDB or SQLite. The repository chooses the appropriate source:

- Local SQLite for drafts, checkpoint answers, observations, audit state, cached reference data and sync queue.
- App-private filesystem for original photo files; SQLite stores paths and metadata.
- Flask API for authorized bootstrap/reference data, server validation, upload receipt, final submission and official reports.

## Offline-first behavior

1. Read locally available data first.
2. Save user edits locally before attempting network work.
3. Queue server operations with stable client-generated IDs.
4. Retry safe operations when connectivity returns or the app resumes.
5. Track each photo independently.
6. Mark an audit submitted only after server confirmation.
7. Preserve local work after logout or sync failure according to the security/retention policy.

## Native responsibilities

Capacitor runtime and plugins for platform integration. Add SQLite, camera, filesystem, network and secure storage only after the clean shell build is verified. Evaluate a small Kotlin/WorkManager integration for reliable scheduled retries later; background work is best-effort under Android OS constraints.

## Backend responsibilities

The existing Flask backend remains authoritative for identity, permissions, business rules, server records and official PDFs. Before connecting the app, document request/response contracts and test them against a disposable staging database. Do not introduce a second API/authentication contract by accident.

## Key invariant

Online and offline modes must render the same UI. Connectivity changes the data availability/sync status, not the overall navigation or screen design.
