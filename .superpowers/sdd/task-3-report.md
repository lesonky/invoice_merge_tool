# Task 3 Report

## Scope

- Added runtime adapters in `src/platform/browserPlatform.ts`, `src/platform/tauriPlatform.ts`, and `src/platform/index.ts`.
- Updated `src/lib/useFilePreviews.ts` to use the platform abstraction instead of static Tauri APIs.
- Added focused tests in `src/platform/index.test.ts` and `src/lib/useFilePreviews.test.ts`.
- Extended `AppPlatform.imageUrl()` in `src/platform/types.ts` to support lazy async Tauri URLs.

## RED

Command:

```bash
npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts
```

Observed failure before implementation:

- `src/platform/index.test.ts` could not run because the runtime adapter module did not exist yet.
- `src/lib/useFilePreviews.test.ts` failed because previews still used static Tauri imports, ignored injected platform reads, and did not cancel a pending PDF loading task on cleanup.

## GREEN

Command:

```bash
npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts
```

Result:

- `2` test files passed.
- `8` tests passed.
- Verified browser runtime detection, browser directory picker wiring, browser Blob download cleanup, Tauri custom-order merge payloads/progress events, platform-driven PDF reads, async image URLs, and PDF preview cleanup.

## Extra Verification

Command:

```bash
npm run build
```

Result:

- TypeScript and Vite production build completed successfully.
- Build warnings remain about static Tauri imports in `src/App.tsx`; that is expected until Task 4 replaces the direct runtime calls there.

## Self-Review

- Confirmed browser merge always revokes the temporary download URL in a `finally` block.
- Confirmed Tauri-only imports are isolated to `src/platform/tauriPlatform.ts`.
- Confirmed Tauri merge sends `sort_mode: "Custom"` and preserves existing command/event names.
- Confirmed preview loading now uses `platform.readFile()` / `platform.imageUrl()` and tears down pending PDF loading tasks on cleanup.
- Left the existing unrelated modification in `src/App.tsx` untouched.

## Follow-up Fix: Browser Picker Cancellation

Issue from review:

- `BrowserPlatform.selectSource()` did not settle when the native picker emitted the HTML input `cancel` event, leaving the transient input in the DOM and making reuse unsafe.

Fix:

- Added a shared idempotent `settle()` path for both `change` and `cancel`.
- `settle()` now removes both listeners, removes the transient input, and resolves exactly once.
- Added regression coverage for:
  - `cancel` resolving `null`
  - transient input removal after `cancel`
  - a second `selectSource()` call succeeding after a prior `cancel`
  - `change` with an empty `FileList` resolving `null`

RED evidence:

```bash
npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts
```

Output:

- `src/platform/index.test.ts > browser picker resolves null on cancel, removes the transient input, and remains reusable`
- failed by timing out after `5000ms`, showing the first `selectSource()` never resolved on `cancel`

GREEN evidence:

```bash
npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts
```

Output:

- `2` test files passed
- `10` tests passed

Build evidence:

```bash
npm run build
```

Output:

- `tsc -b && vite build` completed successfully
- existing Vite warnings remain about static Tauri imports in `src/App.tsx`, which is outside this follow-up fix
