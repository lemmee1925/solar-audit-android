# Build phases and exit criteria

## Phase 0 — clean shell
- Install dependencies.
- `npm run build` passes.
- Generate the Android platform and run on emulator/device.
- No audit features or network dependencies are required yet.

## Phase 1 — UI parity inventory
- Map PWA routes, templates, labels, assets, and user flows.
- Capture representative screenshots and define screen acceptance checks.
- Recreate the app shell/login/dashboard without fake production metrics.

## Phase 2 — backend contract
- Map current Flask routes, sessions, permissions, payloads and upload constraints.
- Decide API endpoints needed for mobile; add a narrow Flask API adapter only where necessary.
- Test using staging data.

## Phase 3 — local persistence
- Versioned SQLite schema and migration strategy.
- Autosave and restore audit drafts.
- Store photos as private files with SQLite metadata.

## Phase 4 — same UI in offline mode
- Download authorized reference data while online.
- Use the same screens against local repositories offline.
- Display stale data and unavailable operations honestly.

## Phase 5 — synchronization
- Durable queue, idempotency, photo receipts, retries, conflict policy and explicit completion/submission.
- Validate interrupted upload and server confirmation scenarios.

## Phase 6 — native hardening
- Permissions, secure credentials, shared-device isolation, storage management, migrations, diagnostics and accessibility.
- Evaluate WorkManager/native Kotlin bridge only against concrete requirements.

## Phase 7 — release candidate
- Automated tests, device matrix, 100+ photo stress tests, backup/restore, signed build, staged pilot and rollback plan.

No phase is complete merely because the project compiles; each phase must meet its exit criteria.
