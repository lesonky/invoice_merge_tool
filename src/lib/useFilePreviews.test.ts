import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { InvoiceFile } from "@shared-types/index";
import type { AppPlatform } from "../platform/types";
import { useFilePreviews } from "./useFilePreviews";

const pdfJsMocks = vi.hoisted(() => ({
  workerOptions: { workerSrc: "" },
  getDocument: vi.fn()
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfJsMocks.workerOptions,
  getDocument: pdfJsMocks.getDocument
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.min.mjs"
}));

function meta(path: string): InvoiceFile {
  const fileName = path.split("/").pop() ?? path;
  const dot = fileName.lastIndexOf(".");
  return {
    path,
    file_name: fileName,
    ext: dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "",
    modified_ts: 0,
    size: 0
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function fakePlatform(overrides: Partial<AppPlatform> = {}): AppPlatform {
  return {
    kind: "web",
    selectSource: async () => null,
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    imageUrl: vi.fn(() => "blob:image"),
    merge: vi.fn(),
    dispose: vi.fn(),
    ...overrides
  } as AppPlatform;
}

function stubCanvas() {
  const getContext = vi.fn(() => ({
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn()
  }));
  const toDataURL = vi.fn(() => "data:image/png;base64,preview");
  const createElement = document.createElement.bind(document);
  return vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = createElement(tagName, options);
    if (tagName === "canvas") {
      Object.defineProperty(element, "getContext", { configurable: true, value: getContext });
      Object.defineProperty(element, "toDataURL", { configurable: true, value: toDataURL });
    }
    return element;
  }) as typeof document.createElement);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useFilePreviews", () => {
  test("uses platform bytes for PDF previews", async () => {
    const createElementSpy = stubCanvas();
    const destroy = vi.fn(async () => undefined);
    pdfJsMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getViewport: () => ({ width: 120, height: 80 }),
          render: () => ({ promise: Promise.resolve() })
        })),
        destroy
      })
    });

    const platform = fakePlatform({
      readFile: vi.fn(async () => new Uint8Array([37, 80, 68, 70]))
    });

    const files = [meta("web:invoice.pdf")];
    const { result } = renderHook(() => useFilePreviews(files, platform));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(platform.readFile).toHaveBeenCalledWith(expect.objectContaining({ path: "web:invoice.pdf" }));
    expect(result.current.previews).toEqual([
      {
        file: expect.objectContaining({ path: "web:invoice.pdf" }),
        pages: [{ pageNumber: 1, url: "data:image/png;base64,preview", width: 120, height: 80 }]
      }
    ]);
    expect(destroy).toHaveBeenCalledTimes(1);
    createElementSpy.mockRestore();
  });

  test("awaits async image URLs and ignores stale results", async () => {
    const firstUrl = deferred<string>();
    const secondUrl = deferred<string>();
    const platform = fakePlatform({
      imageUrl: vi.fn((file: InvoiceFile) => {
        return file.path === "web:first.png" ? firstUrl.promise : secondUrl.promise;
      })
    });

    const { result, rerender } = renderHook(
      ({ files }) => useFilePreviews(files, platform),
      { initialProps: { files: [meta("web:first.png")] } }
    );

    rerender({ files: [meta("web:second.png")] });
    await act(async () => {
      firstUrl.resolve("blob:first");
      secondUrl.resolve("blob:second");
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.previews).toEqual([
      {
        file: expect.objectContaining({ path: "web:second.png" }),
        pages: [{ pageNumber: 1, url: "blob:second", width: 0, height: 0 }]
      }
    ]);
  });

  test("cancels an in-flight PDF loading task on cleanup", async () => {
    const loading = deferred<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<unknown>;
      destroy: () => Promise<void>;
    }>();
    const destroyTask = vi.fn(async () => undefined);
    pdfJsMocks.getDocument.mockReturnValue({
      promise: loading.promise,
      destroy: destroyTask
    });

    const platform = fakePlatform();
    const files = [meta("web:invoice.pdf")];
    const { unmount } = renderHook(() => useFilePreviews(files, platform));

    unmount();

    await waitFor(() => expect(destroyTask).toHaveBeenCalledTimes(1));
  });
});
