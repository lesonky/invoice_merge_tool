import type { InvoiceFile, ProgressPayload } from "@shared-types/index";
import type { MergeInput } from "./types";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 24;
const DEFAULT_OUTPUT_FILE_NAME = "merged_invoices.pdf";
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif"]);

export interface FittedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConvertedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  format?: "jpeg" | "png";
}

export interface BrowserMergeResult {
  bytes: Uint8Array;
  failedFiles: string[];
  outputFileName: string;
}

export type BrowserImageConverter = (
  bytes: Uint8Array,
  file: InvoiceFile
) => Promise<ConvertedImage>;

function round(value: number): number {
  return Number(value.toFixed(3));
}

function isPdf(file: InvoiceFile): boolean {
  return file.ext.toLowerCase() === "pdf";
}

function isImage(file: InvoiceFile): boolean {
  return imageExtensions.has(file.ext.toLowerCase());
}

function mimeTypeFor(file: InvoiceFile): string {
  switch (file.ext.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
        return;
      }
      reject(new Error("Unable to read encoded image"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read encoded image"));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
          return;
        }
        reject(new Error("Unable to encode image"));
      }, "image/jpeg", 0.92);
    });
    return blobToBytes(blob);
  }

  if (typeof canvas.toDataURL === "function") {
    return dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92));
  }

  throw new Error("Unable to encode image");
}

async function renderImageToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<ConvertedImage> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create canvas context");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  return {
    bytes: await canvasToJpegBytes(canvas),
    width: canvas.width,
    height: canvas.height,
    format: "jpeg"
  };
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to decode image"));
    });

    image.src = objectUrl;
    if (typeof image.decode === "function") {
      await image.decode().catch(async () => {
        await loaded;
      });
    } else {
      await loaded;
    }
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeImage(bytes: Uint8Array, file: InvoiceFile): Promise<ConvertedImage> {
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes], { type: mimeTypeFor(file) });

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      return await renderImageToJpeg(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close?.();
    }
  }

  const image = await loadImageElement(blob);
  return renderImageToJpeg(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
}

async function loadPdfLib() {
  return import("pdf-lib");
}

async function embedConvertedImage(
  output: Awaited<ReturnType<typeof loadPdfLib>>["PDFDocument"]["prototype"],
  image: ConvertedImage
) {
  if (image.format === "png") {
    return output.embedPng(image.bytes);
  }

  try {
    return await output.embedJpg(image.bytes);
  } catch (jpegError) {
    try {
      return await output.embedPng(image.bytes);
    } catch {
      throw jpegError;
    }
  }
}

export function normalizePdfName(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    return DEFAULT_OUTPUT_FILE_NAME;
  }
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
}

export function fitWithinPage(
  sourceWidth: number,
  sourceHeight: number,
  pageWidth = A4_WIDTH,
  pageHeight = A4_HEIGHT,
  margin = PAGE_MARGIN
): FittedBox {
  const safeSourceWidth = Math.max(sourceWidth, 1);
  const safeSourceHeight = Math.max(sourceHeight, 1);
  const availableWidth = Math.max(pageWidth - margin * 2, 0);
  const availableHeight = Math.max(pageHeight - margin * 2, 0);
  const scale = Math.min(availableWidth / safeSourceWidth, availableHeight / safeSourceHeight);
  const width = safeSourceWidth * scale;
  const height = safeSourceHeight * scale;

  return {
    x: round((pageWidth - width) / 2),
    y: round((pageHeight - height) / 2),
    width: round(width),
    height: round(height)
  };
}

export async function mergeBrowserFiles(
  input: MergeInput,
  readFile: (file: InvoiceFile) => Promise<Uint8Array>,
  onProgress: (payload: ProgressPayload) => void,
  convertImage: BrowserImageConverter = decodeImage
): Promise<BrowserMergeResult> {
  const { PDFDocument } = await loadPdfLib();
  const total = input.files.length;
  const output = await PDFDocument.create();
  const failedFiles: string[] = [];

  for (const [index, file] of input.files.entries()) {
    onProgress({ current: index, total, phase: "scan" });
    try {
      const bytes = await readFile(file);

      if (isPdf(file)) {
        const source = await PDFDocument.load(bytes);
        onProgress({ current: index + 1, total, phase: "convert" });

        const pages = await output.copyPages(source, source.getPageIndices());
        if (pages.length === 0) {
          throw new Error("No pages in PDF");
        }
        for (const page of pages) {
          output.addPage(page);
        }
        onProgress({ current: index + 1, total, phase: "merge" });
        continue;
      }

      if (!isImage(file)) {
        throw new Error("Unsupported file type");
      }

      const converted = await convertImage(bytes, file);
      onProgress({ current: index + 1, total, phase: "convert" });

      const embedded = await embedConvertedImage(output, converted);
      const page = output.addPage([A4_WIDTH, A4_HEIGHT]);
      const placement = fitWithinPage(converted.width, converted.height);
      page.drawImage(embedded, placement);
      onProgress({ current: index + 1, total, phase: "merge" });
    } catch {
      failedFiles.push(file.file_name);
      onProgress({ current: index + 1, total, phase: "convert" });
    }
  }

  if (output.getPageCount() === 0) {
    throw new Error("No pages could be produced");
  }

  const bytes = await output.save();
  onProgress({ current: total, total, phase: "write" });

  return {
    bytes,
    failedFiles,
    outputFileName: normalizePdfName(input.outputFileName)
  };
}
