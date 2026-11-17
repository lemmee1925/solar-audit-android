# Source baseline review

## Reviewed source

`SolarAuditMobile_COMPLETE_SAFETY_CIVIL_OFFLINE_FIX(5).zip` (uploaded in the current project context).

## Confirmed characteristics

- Flask backend with Python application modules and SQLAlchemy-style models.
- Jinja templates under `frontend/templates`, including `base.html`, `dashboard.html`, `login.html`, equipment, Safety, Civil, site, submission, observation, reports and settings pages.
- Static CSS and JavaScript under `frontend/static`.
- Existing PWA manifest and service worker.
- Existing server-side business logic, authentication/session routes, audit processing and PDF reporting.
- Existing offline endpoints documented in the project review: `/api/offline/bootstrap`, `/api/offline/sync/audit`, `/api/offline/sync/photo`, `/api/offline/sync/complete`.

## Architectural consequence

The server-rendered templates depend on Flask/Jinja and cannot be treated as a standalone React bundle. A remote-only WebView wrapper would fail the offline requirement. The new Android client must have locally bundled UI screens and a local data layer. The interface should stay the same in both online and offline modes; data access should be abstracted behind a repository layer.

## Preserve

- Existing visual design tokens, labels, navigation and responsive behavior as the UI reference.
- Existing audit/checkpoint definitions, validation and scoring behavior.
- Existing server authorization, site assignments, observation lifecycle and official report generation.
- Existing backend as the authoritative server until a separately reviewed API adapter is agreed.

## Do not assume

- A route name automatically provides a JSON API.
- Browser IndexedDB/service-worker behavior is equivalent to native SQLite.
- A successful build proves API or device behavior.
- A local save is equivalent to server submission.
