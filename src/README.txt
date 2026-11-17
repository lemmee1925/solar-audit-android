Solar Audit Mobile - observation-after-submission workflow fix

Replace these four files in your project's src folder:
- App.tsx
- db.ts
- styles.css
- checklistLibrary.ts

Important:
1. Back up your current src files first.
2. Do NOT uninstall the app or clear app storage; this patch does not require a data reset.
3. Run npm run build.
4. If the build passes, run npx cap sync android and build/install the updated APK over the existing app.

Workflow:
- Only one equipment checklist is displayed at a time using the equipment selector.
- During inspection, mark C / NC / NA / OFI and add remarks. No observation form opens during inspection.
- Tap Submit Audit. The app creates one observation per NC/OFI checkpoint, avoiding duplicates on repeated submission, and marks the audit submitted.
- Go to Observations and tap Complete details to fill severity, responsible person, action, target date, and description.
- Existing audits/checkpoints/remarks are retained; no destructive database reset is included.

Note: This archive is source-only; run the project build and test on your device before using it for live audits.


V2 UI correction: opening an audit no longer auto-selects the first equipment. The checkpoint list stays hidden until the user chooses an equipment item from the selector. The observation detail form remains closed until the user taps Complete details on an observation.
