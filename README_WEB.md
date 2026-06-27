# Invoice Merge Assistant Web Guide

Invoice Merge Assistant also ships as a browser-only build. The Web app runs as
static files, keeps invoice contents inside the browser, and does not require a
backend, authentication, or Cloudflare bindings.

## Privacy and runtime scope

- Invoice contents stay in the current browser session.
- The app does not upload source files or merged PDFs.
- Cloudflare Pages only serves the static assets in `dist/`.
- HEIC and TIFF remain desktop-only for this release.

## Supported formats

### Web build

- PDF
- JPG / JPEG
- PNG
- WebP
- BMP
- GIF (first frame only)

### Desktop build

The Tauri desktop app supports the same formats as the Web build, plus:

- HEIC
- TIFF

## Local development

Install dependencies:

```bash
npm install
```

Start the browser development server:

```bash
npm run dev
```

Build the static Web bundle:

```bash
npm run build
```

Preview the production bundle locally:

```bash
npm run preview
```

For the native desktop runtime, use:

```bash
npm run tauri dev
npm run tauri build
```

## Cloudflare Pages

Deploy the generated `dist/` directory as a static Pages project with:

- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: `20` or newer
- Bindings: none
- Authentication: none
- Backend services: none

No Pages Functions, Workers bindings, R2, D1, KV, or auth gateway are required.

## Browser behavior

- File selection is local to the browser and replaces the current list.
- Files merge in the same order shown in the UI.
- The merged result downloads as a PDF to the user's default browser download
  location.
