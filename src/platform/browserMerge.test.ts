import { afterEach, describe, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { InvoiceFile } from "@shared-types/index";
import { fitWithinPage, mergeBrowserFiles, normalizePdfName } from "./browserMerge";

function meta(fileName: string): InvoiceFile {
  const dot = fileName.lastIndexOf(".");
  return {
    path: `browser:${fileName}`,
    file_name: fileName,
    ext: dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "",
    modified_ts: 0,
    size: 0
  };
}

async function makePdf(widths: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const width of widths) {
    pdf.addPage([width, 842]);
  }
  return pdf.save();
}

const tinyPngBytes = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5mQAAAAASUVORK5CYII=",
    "base64"
  )
);

const tinyJpegBytes = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
    "base64"
  )
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser merge engine", () => {
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
      { files: [meta("second.pdf"), meta("first.pdf")], outputFileName: " invoices " },
      async (file) => (file.file_name === "first.pdf" ? first : second),
      () => undefined
    );

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPages().map((page) => page.getWidth())).toEqual([400, 300, 301]);
    expect(result.failedFiles).toEqual([]);
    expect(result.outputFileName).toBe("invoices.pdf");
  });

  test("converts an image into one A4 page", async () => {
    const result = await mergeBrowserFiles(
      { files: [meta("photo.png")] },
      async () => new Uint8Array([1]),
      () => undefined,
      async () => ({ bytes: tinyPngBytes, width: 2, height: 1, format: "png" })
    );

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(1);
    expect(output.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  test("emits scan/convert during preparation and merge/write after partial failures", async () => {
    const goodPdf = await makePdf([300]);
    const progress: string[] = [];

    const result = await mergeBrowserFiles(
      { files: [meta("bad.pdf"), meta("good.pdf"), meta("photo.png")] },
      async (file) => {
        if (file.file_name === "bad.pdf") {
          return new Uint8Array([0]);
        }
        return file.file_name === "good.pdf" ? goodPdf : new Uint8Array([1]);
      },
      (payload) => {
        progress.push(`${payload.phase}:${payload.current}/${payload.total}`);
      },
      async () => ({ bytes: tinyPngBytes, width: 2, height: 1, format: "png" })
    );

    const output = await PDFDocument.load(result.bytes);
    expect(result.failedFiles).toEqual(["bad.pdf"]);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getWidth()).toBe(300);
    expect(output.getPage(1).getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(progress).toEqual([
      "scan:0/3",
      "scan:1/3",
      "convert:2/3",
      "scan:2/3",
      "convert:3/3",
      "merge:0/2",
      "merge:1/2",
      "merge:2/2",
      "write:3/3"
    ]);
  });

  test("falls back to HTMLImageElement when createImageBitmap rejects", async () => {
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect,
      drawImage
    }));
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob([tinyJpegBytes], { type: "image/jpeg" }));
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas") {
        Object.defineProperty(element, "getContext", { configurable: true, value: getContext });
        Object.defineProperty(element, "toBlob", { configurable: true, value: toBlob });
      }
      return element;
    }) as typeof document.createElement);

    const createObjectURL = vi.fn(() => "blob:fallback-gif");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bitmap failed"))));

    class FakeImage {
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public naturalWidth = 2;
      public naturalHeight = 1;
      public width = 2;
      public height = 1;
      public src = "";

      async decode(): Promise<void> {
        this.onload?.();
      }
    }

    vi.stubGlobal("Image", FakeImage);

    const result = await mergeBrowserFiles(
      { files: [meta("animated.gif")] },
      async () => Uint8Array.from([71, 73, 70]),
      () => undefined
    );

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fallback-gif");
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  test("passes the GIF blob through createImageBitmap and flattens onto white canvas", async () => {
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const close = vi.fn();
    const getContext = vi.fn(() => ({
      fillStyle: "",
      fillRect,
      drawImage
    }));
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: unknown) => {
      expect(type).toBe("image/jpeg");
      expect(quality).toBe(0.92);
      callback(new Blob([tinyJpegBytes], { type: "image/jpeg" }));
    });

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas") {
        Object.defineProperty(element, "getContext", { configurable: true, value: getContext });
        Object.defineProperty(element, "toBlob", { configurable: true, value: toBlob });
      }
      return element;
    }) as typeof document.createElement);
    const createImageBitmap = vi.fn(async (blob: Blob) => {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/gif");
      return {
        width: 2,
        height: 1,
        close
      };
    });
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await mergeBrowserFiles(
      { files: [meta("animated.gif")] },
      async () => Uint8Array.from([71, 73, 70]),
      () => undefined
    );

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(1);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("returns partial failures and rejects empty output", async () => {
    const valid = await makePdf([300]);
    const partial = await mergeBrowserFiles(
      { files: [meta("bad.pdf"), meta("good.pdf")] },
      async (file) => (file.file_name === "bad.pdf" ? new Uint8Array([0]) : valid),
      () => undefined
    );
    expect(partial.failedFiles).toEqual(["bad.pdf"]);

    await expect(
      mergeBrowserFiles({ files: [meta("bad.pdf")] }, async () => new Uint8Array([0]), () => undefined)
    ).rejects.toThrow("No pages could be produced");
  });
});
