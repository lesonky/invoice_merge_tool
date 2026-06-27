# Pure Web Version Design

## Goal

Add a browser-only version of Invoice Merge while preserving the existing Tauri
desktop application. The Web version must run as a static Cloudflare deployment,
process files locally, and make no network requests for invoice contents.

## Scope

The first Web release supports:

- PDF
- JPG and JPEG
- PNG
- WebP
- BMP
- GIF, using its first frame

HEIC and TIFF remain desktop-only for this release. The Web version does not
include authentication, uploads, R2 storage, a server-side API, or analytics.

## Architecture

The React interface remains shared. Platform-specific operations are moved
behind a small runtime interface responsible for:

- selecting source files
- exposing file metadata to the existing UI
- reading file bytes for previews
- merging selected files
- delivering the generated PDF
- reporting progress

The Tauri implementation keeps using the existing commands and event stream.
The Web implementation owns an in-memory registry from generated file IDs to
browser `File` objects. UI models remain serializable and do not carry browser
objects.

Runtime selection happens once at application startup. Tauri modules are loaded
only for the desktop runtime so that browser execution does not call native APIs.

## Browser File Selection

The existing "choose folder" action opens a hidden file input configured for
directory and multiple-file selection. Only supported extensions are accepted.
The relative directory name is shown in place of the native absolute path.

Files are sorted by name after selection. Selecting a new directory replaces the
current list and releases preview resources from the previous selection.

## Preview Flow

Image previews use browser object URLs. PDF previews continue to use PDF.js, but
read bytes from the platform interface rather than directly from Tauri.

Object URLs are revoked when files are removed, replaced, or the component is
unmounted. A preview failure affects only that file and remains visible through
the existing unavailable-preview state.

## Merge Flow

`pdf-lib` is loaded dynamically when the user starts a merge.

For each selected file in the current UI order:

1. PDF pages are copied into the output document.
2. Browser-decodable images are rendered to a canvas.
3. Transparent pixels are flattened onto white.
4. The rendered image is embedded on an A4 portrait page while preserving aspect
   ratio and margins.
5. GIF input contributes its first decoded frame.

The Web merger reports scan, conversion, merge, and write progress through the
same payload shape used by Tauri. Failed files are collected without stopping
other valid files. The operation fails only when no output page can be produced.

The completed document is downloaded with the configured name. A missing `.pdf`
suffix is added automatically. The browser success dialog reports the downloaded
filename rather than a native filesystem path.

## Desktop Compatibility

Existing Tauri behavior remains unchanged:

- native folder selection
- Rust scanning and conversion, including HEIC and TIFF
- native output in the selected folder
- Tauri progress events

The user's current language and theme persistence changes in `App.tsx` must be
preserved.

## Cloudflare Deployment

The Web build is a static Vite artifact in `dist/`. Project documentation will
include Cloudflare Pages or Workers Static Assets settings:

- build command: `npm run build`
- output directory: `dist`

No Cloudflare runtime bindings are required.

## Error Handling

- Unsupported files are filtered during selection.
- An empty supported selection returns the existing no-files state.
- Decode or PDF parse errors are recorded per file.
- Browser download failures display the existing error dialog.
- Merge controls remain disabled while an operation is active.

## Testing

Tests are added before production implementation for:

- filtering and mapping browser files to UI metadata
- output filename normalization
- selected-order preservation
- PDF page copying
- image-to-page conversion
- partial failure and empty-output behavior

The final verification includes:

- unit tests
- lint
- TypeScript and Vite production build
- Tauri compile compatibility
- browser smoke tests with PDF and image fixtures
- desktop and mobile viewport checks for overflow and control accessibility

## Acceptance Criteria

- `npm run dev` opens a functional browser version without Tauri.
- A supported directory can be selected and previewed.
- Selected files merge in the visible order.
- The result downloads as a valid PDF.
- Invoice bytes never leave the browser.
- The existing Tauri application still compiles and retains native behavior.
- The static build can be deployed to Cloudflare without backend services.
