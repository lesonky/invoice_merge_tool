# Repository Guidelines

## Project Structure & Module Organization
The repo tracks the cross-platform invoice merge tool. UI code lives in `src/` (React + TypeScript + Vite) with entry points such as `main.tsx`, `App.tsx`, and reusable components under `src/components/`. Native logic sits in `src-tauri/`: `src-tauri/src/main.rs` wires up commands, while helpers like `fs_scan.rs`, `merge.rs`, and `model.rs` handle file discovery, PDF/image decoding, and output writing. Packaging metadata (`tauri.conf.json`, `Cargo.toml`) also stays in `src-tauri/`. Architecture notes and UX references are stored under `docs/` for quick onboarding.

## Build, Test, and Development Commands
Use npm scripts as the main entry point:
```bash
npm install             # install JS deps plus Tauri prerequisites
npm run tauri dev      # launch React dev server + Rust backend
npm run tauri build    # produce distributable installers
npm run lint           # run ESLint/Prettier checks (add if missing)
```
Rust-side tasks can be called directly (`cargo fmt`, `cargo clippy`, `cargo test`) inside `src-tauri/`.

## Coding Style & Naming Conventions
Prefer TypeScript everywhere, 2-space indentation, and descriptive camelCase for variables/functions (`mergeInvoices`, `folderPath`). React components live in PascalCase files (`FileList.tsx`). Align with ESLint + Prettier defaults; run `npm run lint` before opening PRs. Rust modules should follow `rustfmt`, snake_case identifiers, and derive `Debug` for structs sent across the Tauri bridge. Keep command names (`scan_folder_cmd`, `merge_invoices_cmd`) mirrored between Rust and frontend invoke calls for clarity.

## Testing Guidelines
Front-end: cover pure helpers and hooks with Vitest/React Testing Library via `npm run test`. Snapshot the table renderer with common folder fixtures. Back-end: add unit tests under `src-tauri/src/*_tests.rs` and run `cargo test` to guard file filtering, HEIC decoding fallbacks, and merge ordering. Aim for meaningful coverage on parsing/sorting logic; smoke-test full merges by staging fixtures inside `tests/data/`.

## Commit & Pull Request Guidelines
Adopt Conventional Commits (`feat: add merge progress emitter`, `fix: clamp heic decoder errors`) so changelogs stay scriptable. Keep subject lines under 72 chars and mention the affected layer (`frontend`, `tauri`, `docs`). For PRs, include: purpose summary, testing evidence (`npm run tauri dev`, `cargo test`), screenshots or GIFs for UI tweaks, and linked issue IDs. Request at least one review, ensure lint/tests pass, and note any migrations or manual QA steps.
- When releasing a new version, ensure the version numbers in both `package.json` and `tauri.conf.json` are synchronized before tagging.

## Security & Configuration Tips
Respect the no-network stance: do not add HTTP permissions in `tauri.conf.json` without approval. Only scan user-selected folders, and guard against path traversal by using canonicalized paths before file IO. Avoid logging sensitive filenames outside local logs, and keep release builds signed per platform requirement.
