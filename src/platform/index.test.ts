import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";
import { createBrowserPlatform, createTauriPlatform, getPlatform, isTauriRuntime } from "./index";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
  open: vi.fn(),
  listen: vi.fn(),
  readBinaryFile: vi.fn()
}));

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc
}));

vi.mock("@tauri-apps/api/dialog", () => ({
  open: tauriMocks.open
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen
}));

vi.mock("@tauri-apps/api/fs", () => ({
  readBinaryFile: tauriMocks.readBinaryFile
}));

function meta(fileName: string, path = fileName): InvoiceFile {
  const dot = fileName.lastIndexOf(".");
  return {
    path,
    file_name: fileName,
    ext: dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "",
    modified_ts: 0,
    size: 0
  };
}

async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 842]);
  return pdf.save();
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window as Window & { __TAURI_IPC__?: unknown }, "__TAURI_IPC__");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window as Window & { __TAURI_IPC__?: unknown }, "__TAURI_IPC__");
});

describe("runtime adapters", () => {
  test("detects Tauri only when the IPC bridge exists", () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_IPC__: () => undefined })).toBe(true);
  });

  test("returns a runtime singleton for the active environment", () => {
    const browserPlatform = getPlatform();
    expect(browserPlatform.kind).toBe("web");
    expect(getPlatform()).toBe(browserPlatform);
  });

  test("browser picker accepts a directory with multiple supported formats", async () => {
    let createdInput: HTMLInputElement | null = null;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "input") {
        createdInput = element as HTMLInputElement;
      }
      return element;
    }) as typeof document.createElement);

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function click(this: HTMLInputElement) {
      const pdf = new File(["pdf"], "b.pdf", { lastModified: 2_000 });
      const png = new File(["png"], "a.png", { lastModified: 1_000 });
      Object.defineProperty(pdf, "webkitRelativePath", { configurable: true, value: "Invoices/b.pdf" });
      Object.defineProperty(png, "webkitRelativePath", { configurable: true, value: "Invoices/a.png" });
      Object.defineProperty(this, "files", { configurable: true, value: [pdf, png] });
      this.dispatchEvent(new Event("change"));
    });

    const platform = createBrowserPlatform();
    const selection = await platform.selectSource();

    clickSpy.mockRestore();

    expect(createdInput).not.toBeNull();
    if (!createdInput) {
      throw new Error("Expected file input to be created");
    }
    const input = createdInput as HTMLInputElement & { webkitdirectory?: boolean };
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif");
    expect(input.webkitdirectory).toBe(true);
    expect(selection).toMatchObject({
      folderLabel: "Invoices",
      files: [expect.objectContaining({ file_name: "a.png" }), expect.objectContaining({ file_name: "b.pdf" })]
    });
  });

  test("browser merge downloads a local blob and revokes the temporary URL", async () => {
    const pdfBytes = await makePdf();
    const createObjectURL = vi.fn(() => "blob:merged");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const anchorClick = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { configurable: true, value: anchorClick });
      }
      return element;
    }) as typeof document.createElement);

    const platform = createBrowserPlatform({
      registry: {
        read: vi.fn(async () => pdfBytes),
        imageUrl: vi.fn(),
        dispose: vi.fn(),
        replace: vi.fn()
      }
    });

    const result = await platform.merge({ files: [meta("invoice.pdf", "web:invoice.pdf")], outputFileName: "June" }, () => {
      return undefined;
    });

    expect(result).toMatchObject({
      success: true,
      output_path: "June.pdf",
      failed_files: []
    } satisfies Partial<MergeResult>);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:merged");
  });

  test("tauri merge preserves visible order and merge-progress events", async () => {
    tauriMocks.open.mockResolvedValue("/Invoices");
    tauriMocks.invoke.mockResolvedValueOnce([meta("b.pdf", "/Invoices/b.pdf"), meta("a.pdf", "/Invoices/a.pdf")]);
    const unlisten = vi.fn();
    tauriMocks.listen.mockImplementation(async (_eventName: string, handler: (event: { payload: ProgressPayload }) => void) => {
      handler({ payload: { current: 1, total: 2, phase: "scan" } });
      return unlisten;
    });
    tauriMocks.invoke.mockResolvedValueOnce({
      success: true,
      output_path: "/Invoices/June.pdf",
      failed_files: [],
      message: null
    } satisfies MergeResult);

    const platform = createTauriPlatform();
    const selection = await platform.selectSource();
    const progress = vi.fn();
    const result = await platform.merge(
      { files: selection?.files ?? [], outputFileName: "June" },
      progress
    );

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "scan_folder_cmd", { folderPath: "/Invoices" });
    expect(tauriMocks.listen).toHaveBeenCalledWith("merge-progress", expect.any(Function));
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "merge_invoices_cmd", {
      req: {
        folder_path: "/Invoices",
        files: selection?.files ?? [],
        sort_mode: "Custom",
        output_file_name: "June"
      }
    });
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 2, phase: "scan" });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(result.output_path).toBe("/Invoices/June.pdf");
  });
});
