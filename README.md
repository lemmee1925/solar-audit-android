# Solar Audit Mobile — Dashboard UI Phase 1 Patch

## Contents
- `src/App.tsx` — dashboard and primary navigation UI
- `src/styles.css` — responsive mobile-first styling

## Apply
From the project root `SolarAuditAndroid_Foundation\SolarAuditAndroid_Foundation`, back up the existing `src\App.tsx` and `src\styles.css`, then replace them with these files.

Then run:
```powershell
npm run build
npx cap sync android
```
Open the emulator and run the app again from Android Studio or install the newly built debug APK.

## Important scope note
This is the first UI milestone only. It intentionally displays no fabricated audit counts or observations. Live data, authentication, audit forms, local database, photo handling and sync are not connected yet. The UI labels this clearly. The existing Flask backend remains authoritative; this patch does not change it.
