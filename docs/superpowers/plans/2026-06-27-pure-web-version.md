# Pure Web Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static, browser-only invoice merger that shares the existing React UI and preserves the Tauri desktop application.

**Architecture:** Introduce a runtime interface for file selection, byte access, previews, progress, and merge output. The Web runtime keeps browser `File` objects in memory and uses a dynamically loaded `pdf-lib` engine; the Tauri runtime delegates to the existing commands.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Vitest, PDF.js, pdf-lib 1.17.1, Tauri 1.5

## Global Constraints

- Process invoice contents locally with no uploads or application network requests.
- Support PDF, JPG/JPEG, PNG, WebP, BMP, and the first frame of GIF.
- Keep HEIC and TIFF desktop-only.
- Preserve existing Tauri folder selection, Rust conversion, native output, and progress events.
- Preserve the current uncommitted language and theme persistence changes in `src/App.tsx`.
- Produce a static `dist/` build requiring no Cloudflare bindings.

## File Structure

- `src/platform/types.ts`: shared runtime contracts.
- `src/platform/browserFiles.ts`: browser file filtering, metadata mapping, registry, and picker.
- `src/platform/browserMerge.ts`: browser PDF/image merge engine and download.
- `src/platform/browserPlatform.ts`: Web runtime implementation.
- `src/platform/tauriPlatform.ts`: lazy Tauri runtime implementation.
- `src/platform/index.ts`: runtime detection and singleton selection.
- `src/lib/useFilePreviews.ts`: platform-neutral previews.
- `src/App.tsx`: consume the selected runtime and mount the hidden browser picker.
- `src/**/*.test.ts`: focused unit and integration tests.
- `README_WEB.md`: local usage and Cloudflare deployment instructions.

---

### Task 1: Browser File Registry

**Files:**
- Create: `src/platform/types.ts`
- Create: `src/platform/browserFiles.ts`
- Test: `src/platform/browserFiles.test.ts`

**Interfaces:**
- Produces: `AppPlatform`, `SourceSelection`, `MergeInput`, `BrowserFileRegistry`, `isSupportedFile`, and `filesToSelection`.
- Consumes: existing `InvoiceFile`, `MergeResult`, and `ProgressPayload` types.

- [ ] **Step 1: Write the failing browser-file tests**

```ts
import { describe, expect, test } from "vitest";
import { BrowserFileRegistry, filesToSelection, isSupportedFile } from "./browserFiles";

describe("browser file selection", () => {
  test("accepts only the Web format set", () => {
    expect(isSupportedFile(new File([], "a.PDF"))).toBe(true);
    expect(isSupportedFile(new File([], "a.webp"))).toBe(true);
    expect(isSupportedFile(new File([], "a.heic"))).toBe(false);
    expect(isSupportedFile(new File([], "a.tiff"))).toBe(false);
  });

  test("maps files to stable UI metadata and preserves relative folder", () => {
    const pdf = new File([new Uint8Array([1, 2])], "one.pdf", { lastModified: 2000 });
    Object.defineProperty(pdf, "webkitRelativePath", { value: "Invoices/one.pdf" });
    const selection = filesToSelection([pdf]);
    expect(selection.folderLabel).toBe("Invoices");
    expect(selection.files[0]).toMatchObject({
      file_name: "one.pdf",
      ext: "pdf",
      modified_ts: 2,
      size: 2
    });
  });

  test("registry resolves selected bytes and clears stale files", async () => {
    const registry = new BrowserFileRegistry();
    const first = new File(["first"], "first.pdf");
    const selection = registry.replace([first]);
    expect(new TextDecoder().decode(await registry.read(selection.files[0]))).toBe("first");
    registry.clear();
    await expect(registry.read(selection.files[0])).rejects.toThrow("File is no longer available");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run src/platform/browserFiles.test.ts`

Expected: FAIL because `src/platform/browserFiles.ts` does not exist.

- [ ] **Step 3: Implement contracts and registry**

Define:

```ts
export interface SourceSelection {
  folderLabel: string;
  files: InvoiceFile[];
}

export interface MergeInput {
  files: InvoiceFile[];
  outputFileName?: string | null;
}

export interface AppPlatform {
  kind: "web" | "tauri";
  selectSource(): Promise<SourceSelection | null>;
  readFile(file: InvoiceFile): Promise<Uint8Array>;
  imageUrl(file: InvoiceFile): string;
  merge(input: MergeInput, onProgress: (payload: ProgressPayload) => void): Promise<MergeResult>;
  dispose(): void;
}
```

Implement a case-insensitive extension allowlist of `pdf`, `jpg`, `jpeg`,
`png`, `webp`, `bmp`, and `gif`. Generate browser IDs from the relative path,
size, modified time, and index. `BrowserFileRegistry.replace()` must clear old
object URLs, register supported files, and return filename-sorted metadata.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test -- --run src/platform/browserFiles.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/platform/types.ts src/platform/browserFiles.ts src/platform/browserFiles.test.ts
git commit -m "feat(web): add browser file registry"
```

---

### Task 2: Browser Merge Engine

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/platform/browserMerge.ts`
- Test: `src/platform/browserMerge.test.ts`

**Interfaces:**
- Consumes: `MergeInput` and a `(file: InvoiceFile) => Promise<Uint8Array>` reader.
- Produces: `normalizePdfName`, `fitWithinPage`, and `mergeBrowserFiles`.

- [ ] **Step 1: Install the PDF dependency**

Run: `npm install pdf-lib@1.17.1`

Expected: `pdf-lib` appears under `dependencies`.

- [ ] **Step 2: Write failing merge tests**

Create tests that:

```ts
test("normalizes output names", () => {
  expect(normalizePdfName(" invoices ")).toBe("invoices.pdf");
  expect(normalizePdfName("report.PDF")).toBe("report.PDF");
});

test("fits an image inside A4 without changing aspect ratio", () => {
  expect(fitWithinPage(2000, 1000, 595.28, 841.89, 24)).toEqual({
    x: 24,
    y: 284.125,
    width: 547.28,
    height: 273.64
  });
});

test("copies PDF pages in visible file order", async () => {
  const first = await makePdf([300, 301]);
  const second = await makePdf([400]);
  const result = await mergeBrowserFiles(
    [meta("second.pdf"), meta("first.pdf")],
    async (file) => file.file_name === "first.pdf" ? first : second,
    () => undefined
  );
  const output = await PDFDocument.load(result.bytes);
  expect(output.getPages().map((page) => page.getWidth())).toEqual([400, 300, 301]);
});

test("converts an image into one A4 page", async () => {
  const result = await mergeBrowserFiles(
    [meta("photo.png")],
    async () => new Uint8Array([1]),
    () => undefined,
    async () => ({ bytes: tinyJpegBytes, width: 2, height: 1 })
  );
  const output = await PDFDocument.load(result.bytes);
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
});

test("returns partial failures and rejects empty output", async () => {
  const valid = await makePdf([300]);
  const partial = await mergeBrowserFiles(
    [meta("bad.pdf"), meta("good.pdf")],
    async (file) => file.file_name === "bad.pdf" ? new Uint8Array([0]) : valid,
    () => undefined
  );
  expect(partial.failedFiles).toEqual(["bad.pdf"]);
  await expect(
    mergeBrowserFiles([meta("bad.pdf")], async () => new Uint8Array([0]), () => undefined)
  ).rejects.toThrow("No pages could be produced");
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- --run src/platform/browserMerge.test.ts`

Expected: FAIL because merge exports do not exist.

- [ ] **Step 4: Implement PDF and image merging**

Implement sequential PDF page copying with `PDFDocument.load()` and
`copyPages()`. Decode images with `createImageBitmap()` when available and an
`HTMLImageElement` fallback otherwise. Draw onto a white canvas, export JPEG at
quality `0.92`, embed it on an A4 page (`595.28 x 841.89` points) with a
24-point margin, and report progress after every file. Accept an optional image
converter as the fourth argument so the real merge path can be tested without
mocking browser canvas internals. Return bytes and failed filenames; throw when
no pages are produced.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- --run src/platform/browserMerge.test.ts`

Expected: all merge tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/platform/browserMerge.ts src/platform/browserMerge.test.ts
git commit -m "feat(web): merge invoices in browser"
```

---

### Task 3: Runtime Adapters and Platform-Neutral Previews

**Files:**
- Create: `src/platform/browserPlatform.ts`
- Create: `src/platform/tauriPlatform.ts`
- Create: `src/platform/index.ts`
- Modify: `src/lib/useFilePreviews.ts`
- Test: `src/platform/index.test.ts`
- Test: `src/lib/useFilePreviews.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and registry, Task 2 merge engine.
- Produces: `getPlatform()`, `isTauriRuntime()`, and `useFilePreviews(files, platform)`.

- [ ] **Step 1: Write failing runtime tests**

```ts
test("detects Tauri only when the IPC bridge exists", () => {
  expect(isTauriRuntime({})).toBe(false);
  expect(isTauriRuntime({ __TAURI_IPC__: () => undefined })).toBe(true);
});

test("uses platform bytes for PDF previews", async () => {
  const platform = fakePlatform({ "web:invoice.pdf": validPdfBytes });
  const { result } = renderHook(() => useFilePreviews([meta("web:invoice.pdf")], platform));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(platform.readFile).toHaveBeenCalledWith(expect.objectContaining({ path: "web:invoice.pdf" }));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts`

Expected: FAIL because the runtime adapters and hook signature do not exist.

- [ ] **Step 3: Implement both adapters**

The browser adapter creates an input with `type=file`, `multiple`,
`webkitdirectory`, and the supported `accept` extensions. It delegates reading
to the registry, merging to `mergeBrowserFiles`, creates a Blob download, clicks
a temporary anchor, then revokes the download URL.

The Tauri adapter uses dynamic imports for:

```ts
const [{ invoke, convertFileSrc }, { open }, { listen }, { readBinaryFile }] =
  await Promise.all([
    import("@tauri-apps/api/tauri"),
    import("@tauri-apps/api/dialog"),
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/fs")
  ]);
```

It preserves `scan_folder_cmd`, `merge_invoices_cmd`, and `merge-progress`
payloads. `getPlatform()` returns a singleton selected by `window.__TAURI_IPC__`.

- [ ] **Step 4: Make previews runtime-neutral**

Remove static Tauri imports from `useFilePreviews.ts`. Use
`platform.imageUrl(file)` for image previews and
`platform.readFile(file)` for PDF data. Keep PDF.js rendering and cancellation
behavior unchanged.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- --run src/platform/index.test.ts src/lib/useFilePreviews.test.ts`

Expected: runtime and preview tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/platform src/lib/useFilePreviews.ts src/lib/useFilePreviews.test.ts
git commit -m "feat(frontend): add web and tauri runtime adapters"
```

---

### Task 4: Connect the Shared React UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/translations.ts`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `getPlatform()` and `AppPlatform`.
- Produces: the same visible application in both Web and Tauri runtimes.

- [ ] **Step 1: Write failing UI tests**

```tsx
test("loads browser-selected files and enables merge", async () => {
  const platform = fakePlatform({
    selectSource: async () => ({ folderLabel: "Invoices", files: [meta("one.pdf")] })
  });
  render(<App platform={platform} />);
  await userEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
  expect(await screen.findByDisplayValue("Invoices")).toBeInTheDocument();
  expect(screen.getByText("one.pdf")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /合并/ })).toBeEnabled();
});

test("downloads with the configured filename", async () => {
  const platform = fakePlatformWithOneFile();
  render(<App platform={platform} />);
  await selectSource();
  await userEvent.type(screen.getByLabelText("输出文件名"), "June");
  await userEvent.click(screen.getByRole("button", { name: /合并/ }));
  expect(platform.merge).toHaveBeenCalledWith(
    expect.objectContaining({ outputFileName: "June" }),
    expect.any(Function)
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/App.test.tsx`

Expected: FAIL because `App` does not accept a platform and still invokes Tauri
directly.

- [ ] **Step 3: Replace direct native calls**

Accept an optional `platform` prop defaulting to `getPlatform()`. Replace
`openDialog`, `invoke`, and `listen` usage with `platform.selectSource()` and
`platform.merge()`. Pass the platform to `useFilePreviews`. Keep selection,
sorting, dragging, progress, dialogs, language storage, and theme storage.

Use `folderLabel` as the Web source value. For Web success, display the
downloaded filename returned in `MergeResult.output_path`. Add accessible labels
and titles to the existing icon-only controls touched by the tests.

- [ ] **Step 4: Add Web-specific copy**

Add localized strings for local processing and downloaded output. Do not add a
marketing panel or instructions inside the main work surface.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- --run src/App.test.tsx`

Expected: UI tests pass.

- [ ] **Step 6: Run the full frontend checks**

Run: `npm run check && npm run build`

Expected: Vitest, ESLint, TypeScript, and Vite finish with exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/lib/translations.ts
git commit -m "feat(frontend): connect pure web workflow"
```

---

### Task 5: Cloudflare Documentation and Cross-Runtime Verification

**Files:**
- Create: `README_WEB.md`
- Modify: `README_CN.md`

**Interfaces:**
- Consumes: the completed static Web build.
- Produces: reproducible local and Cloudflare deployment instructions.

- [ ] **Step 1: Document local and Cloudflare usage**

Document:

```md
## Local Web development
npm install
npm run dev

## Production build
npm run build

## Cloudflare Pages
Build command: npm run build
Output directory: dist
Node.js: 20 or newer
```

State that processing is local, no backend is required, and HEIC/TIFF remain
desktop-only. Link this guide from `README_CN.md`.

- [ ] **Step 2: Verify frontend and Rust**

Run:

```bash
npm run check
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0.

- [ ] **Step 3: Start and smoke-test the Web application**

Run: `npm run dev -- --host 127.0.0.1`

Use Playwright at desktop `1440x900` and mobile `390x844`. Select generated PDF,
PNG, and GIF fixtures, verify previews, reorder items, merge, intercept the
download, and load the downloaded bytes with PDF.js to verify page count and
order. Check the browser console for uncaught errors and inspect screenshots for
overlap or clipped controls.

- [ ] **Step 4: Inspect final changes**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors and only intended source, test, dependency, and
documentation changes. The user's pre-existing `App.tsx` changes remain present.

- [ ] **Step 5: Commit documentation**

```bash
git add README_WEB.md README_CN.md
git commit -m "docs: add Cloudflare web deployment guide"
```
