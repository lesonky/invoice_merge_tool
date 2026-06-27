import type { InvoiceFile } from "@shared-types/index";
import type { SourceSelection } from "./types";

const supportedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp", "bmp", "gif"]);

interface BrowserFileEntry {
  file: File;
  objectUrl: string;
}

interface BrowserFileMetadata {
  file: File;
  metadata: InvoiceFile;
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  return fileName.slice(lastDot + 1).toLowerCase();
}

function getRelativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

function getFolderLabel(files: File[]): string {
  for (const file of files) {
    const relativePath = getRelativePath(file);
    const slashIndex = relativePath.indexOf("/");
    if (slashIndex > 0) {
      return relativePath.slice(0, slashIndex);
    }
  }
  return files.length > 0 ? "Selected files" : "";
}

function buildBrowserId(file: File, index: number): string {
  const relativePath = getRelativePath(file);
  return [
    "browser",
    index,
    file.lastModified,
    file.size,
    encodeURIComponent(relativePath)
  ].join(":");
}

function createObjectUrl(file: File, fallbackId: string): string {
  if (typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(file);
  }
  return `browser-file:${fallbackId}`;
}

function revokeObjectUrl(objectUrl: string): void {
  if (typeof URL.revokeObjectURL === "function" && objectUrl.startsWith("blob:")) {
    URL.revokeObjectURL(objectUrl);
  }
}

function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
        return;
      }
      reject(new Error("Unable to read file bytes"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read file bytes"));
    };
    reader.readAsArrayBuffer(file);
  });
}

function toInvoiceFile(file: File, index: number): InvoiceFile {
  return {
    path: buildBrowserId(file, index),
    file_name: file.name,
    ext: getFileExtension(file.name),
    modified_ts: Math.floor(file.lastModified / 1000),
    size: file.size
  };
}

function sortByFileName(left: InvoiceFile, right: InvoiceFile): number {
  const byName = left.file_name.localeCompare(right.file_name, undefined, {
    sensitivity: "base",
    numeric: true
  });
  if (byName !== 0) {
    return byName;
  }
  return left.path.localeCompare(right.path);
}

function buildSelection(files: File[]): { selection: SourceSelection; records: BrowserFileMetadata[] } {
  const supportedFiles = files.filter(isSupportedFile);
  const folderLabel = getFolderLabel(supportedFiles);
  const records = supportedFiles.map((file, index) => {
    return { file, metadata: toInvoiceFile(file, index) };
  });

  const sortedFiles = records.map((record) => record.metadata).sort(sortByFileName);
  return {
    selection: {
      folderLabel,
      files: sortedFiles
    },
    records
  };
}

export function isSupportedFile(file: File): boolean {
  return supportedExtensions.has(getFileExtension(file.name));
}

export function filesToSelection(files: File[]): SourceSelection {
  return buildSelection(files).selection;
}

export class BrowserFileRegistry {
  private records = new Map<string, BrowserFileEntry>();

  replace(files: File[]): SourceSelection {
    this.clear();
    const { selection, records } = buildSelection(files);
    for (const record of records) {
      this.records.set(record.metadata.path, {
        file: record.file,
        objectUrl: createObjectUrl(record.file, record.metadata.path)
      });
    }
    return selection;
  }

  async read(file: InvoiceFile): Promise<Uint8Array> {
    const entry = this.records.get(file.path);
    if (!entry) {
      throw new Error("File is no longer available");
    }
    return readFileBytes(entry.file);
  }

  imageUrl(file: InvoiceFile): string {
    const entry = this.records.get(file.path);
    if (!entry) {
      throw new Error("File is no longer available");
    }
    return entry.objectUrl;
  }

  clear(): void {
    for (const { objectUrl } of this.records.values()) {
      revokeObjectUrl(objectUrl);
    }
    this.records.clear();
  }

  dispose(): void {
    this.clear();
  }
}
