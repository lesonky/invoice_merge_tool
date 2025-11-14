import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { listen } from "@tauri-apps/api/event";
import FileList from "@components/FileList";
import MergeSummaryDialog from "@components/MergeSummaryDialog";
import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";

interface DialogState {
  open: boolean;
  title: string;
  description: string;
  outputPath?: string;
  failed: string[];
}

const defaultDialog: DialogState = {
  open: false,
  title: "",
  description: "",
  failed: []
};

type SortField = "file_name" | "ext" | "modified_ts" | "size";
type SortDirection = "asc" | "desc";

function App() {
  const [folderPath, setFolderPath] = useState<string>("");
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: SortDirection }>({
    field: "file_name",
    direction: "asc"
  });
  const [isCustomOrder, setIsCustomOrder] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("就绪。");
  const [progress, setProgress] = useState(0);
  const [customName, setCustomName] = useState("");
  const [dialog, setDialog] = useState<DialogState>(defaultDialog);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unlistenPromise = listen<ProgressPayload>("merge-progress", (event) => {
      const { current, total, phase } = event.payload;
      if (!total) return;
      const pct = Math.round((current / total) * 100);
      setProgress(pct);
      const labelMap: Record<ProgressPayload["phase"], string> = {
        scan: "读取文件中…",
        convert: "转换图片为 PDF…",
        merge: "合并 PDF…",
        write: "写入结果…"
      };
      setStatusMessage(`${labelMap[phase]} (${current}/${total})`);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const selectFolder = useCallback(async () => {
    const folder = await openDialog({ directory: true, multiple: false });
    if (!folder || Array.isArray(folder)) {
      return;
    }

    setStatusMessage("正在扫描文件夹…");
    try {
      const result = await invoke<InvoiceFile[]>("scan_folder_cmd", { folderPath: folder });
      setFolderPath(folder);
      setFiles(result);
      setIsCustomOrder(false);
      setStatusMessage(`已找到 ${result.length} 个可合并文件。`);
    } catch (error) {
      console.error(error);
      setStatusMessage("扫描失败，请重试。");
    }
  }, []);

  const sortedFiles = useMemo(() => {
    if (isCustomOrder) {
      return files;
    }
    const sorted = [...files];
    if (sortConfig) {
      const direction = sortConfig.direction === "asc" ? 1 : -1;
      sorted.sort((a, b) => {
        switch (sortConfig.field) {
          case "file_name":
            return direction * a.file_name.localeCompare(b.file_name, "zh");
          case "ext":
            return direction * a.ext.localeCompare(b.ext);
          case "modified_ts":
            return direction * (a.modified_ts - b.modified_ts);
          case "size":
            return direction * (Number(a.size) - Number(b.size));
          default:
            return 0;
        }
      });
    }
    return sorted;
  }, [files, sortConfig, isCustomOrder]);

  useEffect(() => {
    setSelectedMap((prev) => {
      const next: Record<string, boolean> = {};
      files.forEach((file) => {
        next[file.path] = prev[file.path] ?? true;
      });
      return next;
    });
  }, [files]);

  const selectedFiles = useMemo(
    () => sortedFiles.filter((file) => selectedMap[file.path] ?? true),
    [sortedFiles, selectedMap]
  );

  const handleToggleFile = useCallback((path: string, checked: boolean) => {
    setSelectedMap((prev) => ({ ...prev, [path]: checked }));
  }, []);

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      setSelectedMap((prev) => {
        const next = { ...prev };
        files.forEach((file) => {
          next[file.path] = checked;
        });
        return next;
      });
    },
    [files]
  );

  const handleMerge = useCallback(async () => {
    if (!folderPath || !selectedFiles.length) {
      return;
    }

    setIsMerging(true);
    setProgress(0);
    setStatusMessage("开始合并，请稍候…");
    setDialog(defaultDialog);

    try {
      const result = await invoke<MergeResult>("merge_invoices_cmd", {
        req: {
          folder_path: folderPath,
          files: selectedFiles,
          sort_mode: sortConfig.field === "modified_ts" ? "ModifiedAsc" : "FileNameAsc",
          output_file_name: customName.trim() ? customName.trim() : null
        }
      });

      if (result.success) {
        const failText = result.failed_files.length
          ? `，其中 ${result.failed_files.length} 个文件失败`
          : "";
        setDialog({
          open: true,
          title: "合并完成",
          description: `输出文件：${result.output_path}${failText}`,
          outputPath: result.output_path,
          failed: result.failed_files
        });
        setStatusMessage("合并完成。");
      } else {
        setDialog({
          open: true,
          title: "合并失败",
          description: result.message ?? "未知错误",
          failed: result.failed_files
        });
        setStatusMessage("合并失败");
      }
    } catch (error) {
      console.error(error);
      setDialog({
        open: true,
        title: "合并失败",
        description: error instanceof Error ? error.message : String(error),
        failed: []
      });
      setStatusMessage("合并失败");
    } finally {
      setIsMerging(false);
    }
  }, [folderPath, selectedFiles, sortConfig, customName]);

  const closeDialog = useCallback(() => setDialog(defaultDialog), []);

  return (
    <div className="app-shell">
      <div className="panel">
        <header style={{ marginBottom: 24 }}>
          <h1>Master Concept 发票合并助手</h1>
          <p className="inline-hint">选择发票文件夹，一键合并 PDF / 图片 / HEIC。</p>
        </header>

        <section style={{ marginBottom: 24 }}>
          <label className="inline-hint" style={{ display: "block", marginBottom: 8 }}>
            当前文件夹
          </label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                padding: "10px 14px",
                background: "#f9fafb",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {folderPath || "未选择"}
            </div>
            <button className="button secondary" onClick={selectFolder}>
              选择文件夹
            </button>
          </div>
        </section>

        <section style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <label className="inline-hint" htmlFor="outputName">
                输出文件名（可选）
              </label>
              <input
                id="outputName"
                placeholder="例如：merged_invoices_q1.pdf"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                style={{
                  width: "100%",
                  marginTop: 8,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  padding: "10px 14px"
                }}
              />
            </div>
          </div>
          <p className="inline-hint" style={{ marginTop: 8 }}>
            提示：点击列表表头可排序，再次点击切换升/降序；按住行可拖拽调整顺序。
          </p>
        </section>

        <section>
          <FileList
            files={sortedFiles}
            emptyMessage={folderPath ? "此目录下没有可合并的文件。" : "尚未选择发票文件夹。"}
            selected={selectedMap}
            onToggle={handleToggleFile}
            onToggleAll={handleToggleAll}
            sortConfig={isCustomOrder ? null : sortConfig}
            onRequestSort={(field) => {
              setSortConfig((prev) => {
                if (prev && prev.field === field) {
                  return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
                }
                return { field, direction: "asc" };
              });
              setIsCustomOrder(false);
            }}
            onReorder={(fromIndex, toIndex) => {
              const next = [...sortedFiles];
              const [moved] = next.splice(fromIndex, 1);
              next.splice(toIndex, 0, moved);
              setFiles(next);
              setIsCustomOrder(true);
            }}
          />
        </section>

        <p className="inline-hint" style={{ marginTop: 12 }}>
          已选择 {selectedFiles.length} / {sortedFiles.length} 个文件
        </p>

        <section style={{ marginTop: 24 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <button className="button primary" disabled={isMerging || !selectedFiles.length} onClick={handleMerge}>
              {isMerging ? "合并中…" : "合并并导出 PDF"}
            </button>
            <div style={{ flex: 1 }}>
              <div className="progress-shell">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="inline-hint" style={{ marginTop: 8 }}>
                {statusMessage}
              </p>
            </div>
          </div>
        </section>
      </div>

      <MergeSummaryDialog
        open={dialog.open}
        title={dialog.title}
        description={
          dialog.failed.length
            ? `${dialog.description}\n失败文件：${dialog.failed.join(", ")}`
            : dialog.description
        }
        primaryLabel="完成"
        onPrimary={closeDialog}
      />
    </div>
  );
}

export default App;
