import { useEffect, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { InvoiceFile } from "@shared-types/index";
import { getPlatform } from "../platform";
import type { AppPlatform } from "../platform";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "bmp", "gif", "tiff", "webp", "heic"];
const PDF_PREVIEW_SCALE = 0.45;

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface PreviewPage {
  pageNumber: number;
  url: string;
  width: number;
  height: number;
}

export interface FilePreview {
  file: InvoiceFile;
  pages: PreviewPage[];
  error?: string;
}

type CancelCurrent = (cleanup?: () => void) => void;

function once(action?: () => void | Promise<void>): () => void {
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    void action?.();
  };
}

export const useFilePreviews = (files: InvoiceFile[], platform: AppPlatform = getPlatform()) => {
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cancelCurrent: (() => void) | undefined;
    if (!files.length) {
      setPreviews([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const loadPreviews = async () => {
      const next: FilePreview[] = [];
      for (const file of files) {
        if (cancelled) {
          break;
        }

        const ext = file.ext.toLowerCase();

        try {
          if (IMAGE_EXTENSIONS.includes(ext)) {
            const url = await Promise.resolve(platform.imageUrl(file));
            if (cancelled) {
              break;
            }
            next.push({
              file,
              pages: [
                {
                  pageNumber: 1,
                  url,
                  width: 0,
                  height: 0
                }
              ]
            });
            continue;
          }

          if (ext === "pdf") {
            const pages = await renderPdfPages(file, platform, () => cancelled, (cleanup) => {
              cancelCurrent = cleanup;
            });
            cancelCurrent = undefined;
            next.push({ file, pages });
            continue;
          }

          next.push({ file, pages: [] });
        } catch (error) {
          console.error(`[preview] Failed to load ${file.file_name}:`, error);
          next.push({
            file,
            pages: [],
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!cancelled) {
        setPreviews(next);
        setLoading(false);
      }
    };

    loadPreviews();

    return () => {
      cancelled = true;
      cancelCurrent?.();
    };
  }, [files, platform]);

  return { previews, loading };
};

const renderPdfPages = async (
  file: InvoiceFile,
  platform: AppPlatform,
  isCancelled: () => boolean,
  setCancelCurrent: CancelCurrent
): Promise<PreviewPage[]> => {
  const bytes = await platform.readFile(file);
  const task = getDocument({ data: bytes });
  const cancelTask = once(() => task.destroy?.());
  setCancelCurrent(cancelTask);
  if (isCancelled()) {
    cancelTask();
    setCancelCurrent(undefined);
    return [];
  }

  let pdf: PDFDocumentProxy | null = null;

  try {
    pdf = await task.promise;
    const destroyPdf = once(() => pdf?.destroy());
    setCancelCurrent(destroyPdf);

    const pages: PreviewPage[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      if (isCancelled()) {
        break;
      }

      const page = await pdf.getPage(pageIndex);
      const viewport = page.getViewport({ scale: PDF_PREVIEW_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) {
        continue;
      }

      await page.render({ canvasContext: context, canvas, viewport }).promise;
      pages.push({
        pageNumber: pageIndex,
        url: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height
      });
    }

    return pages;
  } finally {
    setCancelCurrent(undefined);
    if (pdf) {
      await pdf.destroy();
    } else {
      await task.destroy?.();
    }
  }
};
