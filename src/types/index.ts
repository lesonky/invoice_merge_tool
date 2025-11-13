export type InvoiceFile = {
  path: string;
  file_name: string;
  ext: string;
  modified_ts: number;
  size: number;
};

export type SortMode = "FileNameAsc" | "ModifiedAsc";

export interface MergeResult {
  success: boolean;
  output_path: string;
  failed_files: string[];
  message?: string | null;
}

export interface ProgressPayload {
  current: number;
  total: number;
  phase: "scan" | "convert" | "merge" | "write";
}
