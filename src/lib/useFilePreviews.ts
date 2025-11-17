import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { readBinaryFile } from "@tauri-apps/api/fs";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { InvoiceFile } from "@shared-types/index";

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

export const useFilePreviews = (files: InvoiceFile[]) => {
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
            next.push({
              file,
              pages: [
                {
                  pageNumber: 1,
                  url: convertFileSrc(file.path),
                  width: 0,
                  height: 0
                }
              ]
            });
            continue;
          }

          if (ext === "pdf") {
            const pages = await renderPdfPages(file.path, () => cancelled);
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
    };
  }, [files]);

  return { previews, loading };
};

const renderPdfPages = async (path: string, isCancelled: () => boolean): Promise<PreviewPage[]> => {
  const bytes = await readBinaryFile(path);
  const task = getDocument({ data: bytes });
  const pdf = await task.promise;
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

  await pdf.destroy();
  return pages;
};
