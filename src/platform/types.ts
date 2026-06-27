import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";

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
  imageUrl(file: InvoiceFile): string | Promise<string>;
  merge(
    input: MergeInput,
    onProgress: (payload: ProgressPayload) => void
  ): Promise<MergeResult>;
  dispose(): void;
}
