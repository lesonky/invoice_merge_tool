import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { listen } from "@tauri-apps/api/event";
import MergeSummaryDialog from "@components/MergeSummaryDialog";
import FileList from "@components/FileList";
import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";
import { formatBytes } from "@lib/format";
import { useFilePreviews } from "@lib/useFilePreviews";
import type { FilePreview } from "@lib/useFilePreviews";
import { translations } from "@lib/translations";
import type { Language } from "@lib/translations";
import type { ThemeMode, ThemeAppearance, ViewMode, ThemeStyles } from "@shared-types/ui";
import {
  ChevronDown,
  FileText,
  Filter,
  FolderOpen,
  LayoutGrid,
  Layers,
  List as ListIcon,
  Moon,
  Monitor,
  Search,
  Settings,
  Sun,
  Zap
} from "lucide-react";

interface DialogState {
  open: boolean;
  title: string;
  description: string;
  outputPath?: string;
  failed: string[];
  variant: "success" | "error";
}

type StatusState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "found"; count: number }
  | { kind: "progress"; phase: ProgressPayload["phase"]; current: number; total: number }
  | { kind: "merging" }
  | { kind: "error"; message?: string };

const defaultDialog: DialogState = {
  open: false,
  title: "",
  description: "",
  failed: [],
  variant: "success"
};

function App() {
  const [folderPath, setFolderPath] = useState("");
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>({
    field: "file_name",
    direction: "asc"
  });
  const [isMerging, setIsMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [customName, setCustomName] = useState("");
  const [dialog, setDialog] = useState<DialogState>(defaultDialog);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [lang, setLang] = useState<Language>("zh");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [activeTheme, setActiveTheme] = useState<ThemeAppearance>("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [statusState, setStatusState] = useState<StatusState>({ kind: "idle" });
  const [pageSelections, setPageSelections] = useState<Record<string, number>>({});

  const t = translations[lang];
  const { previews, loading: previewLoading } = useFilePreviews(files);
  const accentPalette = useMemo(
    () =>
      files.reduce<Record<string, string>>((map, file, index) => {
        const palette = ["#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
        map[file.path] = palette[index % palette.length];
        return map;
      }, {}),
    [files]
  );
  const previewMap = useMemo(() => mapPreviews(previews), [previews]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      if (themeMode === "system") {
        setActiveTheme(mediaQuery.matches ? "dark" : "light");
      } else {
        setActiveTheme(themeMode);
      }
    };

    applyTheme();
    if (themeMode === "system") {
      mediaQuery.addEventListener("change", applyTheme);
      return () => mediaQuery.removeEventListener("change", applyTheme);
    }
    return undefined;
  }, [themeMode]);

  useEffect(() => {
    const unlistenPromise = listen<ProgressPayload>("merge-progress", (event) => {
      const { current, total, phase } = event.payload;
      if (!total) return;
      setProgress(Math.round((current / total) * 100));
      setStatusState({ kind: "progress", phase, current, total });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    setSelectedMap((prev) => {
      const next: Record<string, boolean> = {};
      files.forEach((file) => {
        next[file.path] = prev[file.path] ?? true;
      });
      return next;
    });
  }, [files]);

  useEffect(() => {
    setPageSelections((prev) => {
      const next: Record<string, number> = {};
      files.forEach((file) => {
        const pages = previewMap[file.path]?.pages ?? [];
        const maxIndex = Math.max(pages.length - 1, 0);
        const prevIndex = prev[file.path] ?? 0;
        next[file.path] = Math.min(prevIndex, maxIndex);
      });
      return next;
    });
  }, [files, previewMap]);

  const selectFolder = useCallback(async () => {
    const folder = await openDialog({ directory: true, multiple: false });
    if (!folder || Array.isArray(folder)) {
      return;
    }

    setStatusState({ kind: "scanning" });
    try {
      const result = await invoke<InvoiceFile[]>("scan_folder_cmd", { folderPath: folder });
      setFolderPath(folder);
      const initial = sortList(result, "file_name", "asc");
      setFiles(initial);
      setSortConfig({ field: "file_name", direction: "asc" });
      setStatusState({ kind: "found", count: result.length });
    } catch (error) {
      console.error(error);
      setStatusState({ kind: "error", message: t.statusText.scanError });
    }
  }, [t.statusText.scanError]);

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedMap[file.path] ?? true),
    [files, selectedMap]
  );

  const selectedCount = selectedFiles.length;
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + Number(file.size ?? 0), 0), [files]);
  const selectedSize = useMemo(
    () => selectedFiles.reduce((sum, file) => sum + Number(file.size ?? 0), 0),
    [selectedFiles]
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
    if (!folderPath || !selectedFiles.length) return;

    setIsMerging(true);
    setProgress(0);
    setDialog(defaultDialog);
    setStatusState({ kind: "merging" });

    try {
      const result = await invoke<MergeResult>("merge_invoices_cmd", {
        req: {
          folder_path: folderPath,
          files: selectedFiles,
          sort_mode: sortConfig ? (sortConfig.field === "modified_ts" ? "ModifiedAsc" : "FileNameAsc") : "Custom",
          output_file_name: customName.trim() ? customName.trim() : null
        }
      });

      if (result.success) {
        const failText = result.failed_files.length ? ` (${result.failed_files.length} failed)` : "";
        setDialog({
          open: true,
          title: t.successTitle,
          description: `${t.successMsg} ${result.output_path}${failText}`,
          outputPath: result.output_path,
          failed: result.failed_files,
          variant: "success"
        });
        setStatusState({ kind: "idle" });
      } else {
        setDialog({
          open: true,
          title: t.statusText.mergeError,
          description: result.message ?? t.statusText.mergeError,
          failed: result.failed_files,
          variant: "error"
        });
        setStatusState({ kind: "error", message: result.message ?? t.statusText.mergeError });
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setDialog({
        open: true,
        title: t.statusText.mergeError,
        description: message,
        failed: [],
        variant: "error"
      });
      setStatusState({ kind: "error", message });
    } finally {
      setIsMerging(false);
    }
  }, [folderPath, selectedFiles, sortConfig, customName, t.successMsg, t.successTitle, t.statusText.mergeError]);

  const closeDialog = useCallback(() => setDialog(defaultDialog), []);

  const changePage = useCallback(
    (path: string, delta: number) => {
      setPageSelections((prev) => {
        const pages = previewMap[path]?.pages ?? [];
        if (!pages.length) {
          return prev;
        }
        const current = prev[path] ?? 0;
        const nextIndex = Math.max(0, Math.min(pages.length - 1, current + delta));
        if (nextIndex === current) {
          return prev;
        }
        return { ...prev, [path]: nextIndex };
      });
    },
    [previewMap]
  );

  const handleReorder = useCallback((newFiles: InvoiceFile[]) => {
    setFiles(newFiles);
    setSortConfig(null);
  }, []);

  const themeStyles: ThemeStyles =
    activeTheme === "dark"
      ? {
          bg: "bg-[#0B0E14]",
          textMain: "text-slate-400",
          textHead: "text-slate-200",
          textSub: "text-slate-500",
          headerBg: "bg-[#0B0E14]/80 border-white/5",
          card: "bg-[#161B26] border-[#1E2433] hover:border-indigo-500/50",
          cardSelected: "bg-[#161B26] border-indigo-500",
          inputBg: "bg-[#161B26] border-[#1E2433] text-slate-200 placeholder:text-slate-600",
          panelBg: "bg-[#11141D] border-[#1E2433]",
          toolbarBtn: "bg-[#161B26] hover:bg-[#1E2433] text-slate-400 border-[#1E2433]",
          accentGradient: "from-indigo-500 to-blue-600",
          checkboxBase: "bg-[#1E2433] border-[#2A3241]",
          modalBg: "bg-[#161B26] border-[#1E2433]",
          floatingBar: "bg-[#161B26] border-[#1E2433] shadow-black/50",
          divider: "bg-[#1E2433]",
          pill: "bg-[#1E2433] text-slate-400"
        }
      : {
          bg: "bg-slate-50",
          textMain: "text-slate-600",
          textHead: "text-slate-900",
          textSub: "text-slate-400",
          headerBg: "bg-white/80 border-slate-200",
          card: "bg-white border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200",
          cardSelected: "bg-indigo-50 border-indigo-500",
          inputBg: "bg-white border-slate-200 text-slate-700",
          panelBg: "bg-white/60 border-slate-200 shadow-sm",
          toolbarBtn: "bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm",
          accentGradient: "from-indigo-500 to-violet-600",
          checkboxBase: "bg-white border-slate-300",
          modalBg: "bg-white border-emerald-100",
          floatingBar: "bg-white border-slate-200 shadow-slate-200/50",
          divider: "bg-slate-200",
          pill: "bg-slate-100 text-slate-500"
        };

  const statusMessage = useMemo(() => {
    switch (statusState.kind) {
      case "idle":
        return t.statusText.ready;
      case "scanning":
        return t.statusText.scanning;
      case "found":
        return t.statusText.found.replace("{count}", String(statusState.count));
      case "merging":
        return t.statusText.mergeStart;
      case "progress":
        return `${t.statusText.phases[statusState.phase]} (${statusState.current}/${statusState.total})`;
      case "error":
        return statusState.message ?? t.statusText.mergeError;
      default:
        return t.statusText.ready;
    }
  }, [statusState, t.statusText]);

  const sortOptions = useMemo(
    () => [
      { id: "file_name", label: t.sortFileNameAsc, field: "file_name" as SortField },
      { id: "modified_ts", label: t.sortModifiedAsc, field: "modified_ts" as SortField }
    ],
    [t.sortFileNameAsc, t.sortModifiedAsc]
  );

  const handlePickSort = (field: SortField) => {
    setSortConfig({ field, direction: "asc" });
    setFiles((prev) => sortList(prev, field, "asc"));
    setShowSortMenu(false);
  };

  const allSelected = files.length > 0 && selectedCount === files.length;

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-400/40 py-16 text-center gap-3">
      <p className={`text-lg font-semibold ${themeStyles.textHead}`}>
        {folderPath ? t.emptyStateNoFiles : t.emptyStateNoFolder}
      </p>
      <p className={`text-sm max-w-md ${themeStyles.textMain}`}>{t.emptyStateAction}</p>
      <button
        onClick={selectFolder}
        className="px-5 py-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-medium shadow-lg shadow-indigo-500/30"
      >
        {t.selectFolder}
      </button>
    </div>
  );

  const statusTone =
    statusState.kind === "error" ? "bg-rose-500" : statusState.kind === "idle" ? "bg-emerald-500" : "bg-indigo-500";

  return (
    <div
      className={`h-screen overflow-hidden ${themeStyles.bg} ${themeStyles.textMain} font-sans selection:bg-indigo-500/30 selection:text-indigo-50 flex flex-col relative`}
    >
      <div
        className={`fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] pointer-events-none ${
          activeTheme === "dark" ? "bg-indigo-600/30" : "bg-indigo-300/30"
        }`}
      />
      <div
        className={`fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] pointer-events-none ${
          activeTheme === "dark" ? "bg-violet-700/30" : "bg-violet-300/30"
        }`}
      />
      <div data-tauri-drag-region className={`flex-shrink-0 z-50 transition-colors duration-300 ${activeTheme === "dark" ? "bg-[#0f1115]/80" : "bg-slate-50/80"} backdrop-blur-xl border-b ${activeTheme === "dark" ? "border-white/5" : "border-slate-200"}`}>
        <header className="px-6 pt-10 pb-2 flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Layers className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className={`text-lg font-bold tracking-tight ${themeStyles.textHead}`}>
                Invoice Merge
              </h1>
              <p className={`text-[10px] font-medium uppercase tracking-widest ${themeStyles.textSub}`}>
                Master Concept
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 no-drag pointer-events-auto">
            <div className={`flex items-center p-1 rounded-lg border-2 ${
              activeTheme === "dark" 
                ? "bg-white/5 border-white/10" 
                : "bg-slate-100 border-slate-300"
            }`}>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md transition ${
                  viewMode === "grid" 
                    ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25" 
                    : activeTheme === "dark" ? "text-slate-400 hover:text-slate-200" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition ${
                  viewMode === "list" 
                    ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25" 
                    : activeTheme === "dark" ? "text-slate-400 hover:text-slate-200" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <ListIcon size={18} />
              </button>
            </div>

            <div className="relative pointer-events-auto">
              <button
                onClick={() => setShowSettings((prev) => !prev)}
                className={`p-2 rounded-full transition-colors ${activeTheme === "dark" ? "hover:bg-white/10 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
              >
                <Settings className={`w-5 h-5 transition-transform ${showSettings ? "text-indigo-500 rotate-45" : ""}`} />
              </button>
              {showSettings ? (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setShowSettings(false)} />
                  <div
                    className={`absolute right-0 top-12 w-64 p-3 rounded-2xl border shadow-xl z-[60] backdrop-blur-xl flex flex-col gap-3 ${
                      activeTheme === "dark" ? "bg-[#1a1d24]/90 border-white/10" : "bg-white/90 border-slate-200"
                    }`}
                  >
                    <div className={`p-2 rounded-xl ${activeTheme === "dark" ? "bg-white/5" : "bg-slate-50"}`}>
                      <span className={`text-xs font-bold uppercase tracking-wider mb-2 block ${themeStyles.textSub}`}>
                        {t.language}
                      </span>
                      <div className="flex gap-2">
                        {(["zh", "en"] as Language[]).map((code) => (
                          <button
                            key={code}
                            onClick={() => setLang(code)}
                            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                              lang === code
                                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                                : themeStyles.textSub
                            }`}
                          >
                            {code === "zh" ? "中文" : "English"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={`p-2 rounded-xl ${activeTheme === "dark" ? "bg-white/5" : "bg-slate-50"}`}>
                      <span className={`text-xs font-bold uppercase tracking-wider mb-2 block ${themeStyles.textSub}`}>
                        {t.theme}
                      </span>
                      <div className="flex gap-2">
                        {[
                          { id: "light", icon: Sun, label: t.modes.light },
                          { id: "dark", icon: Moon, label: t.modes.dark },
                          { id: "system", icon: Monitor, label: t.modes.system }
                        ].map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setThemeMode(item.id as ThemeMode)}
                            title={item.label}
                            className={`flex-1 py-1.5 rounded-md flex items-center justify-center ${
                              themeMode === item.id
                                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                                : themeStyles.textSub
                            }`}
                          >
                            <item.icon size={15} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

          </div>
        </header>

        <div className="px-6 pb-6 pt-2">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-semibold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <FolderOpen size={14} /> {t.sourceDir}
              </label>
              <div className="relative group">
                <input
                  type="text"
                  value={folderPath}
                  readOnly
                  placeholder={t.searchPlaceholder}
                  className={`w-full text-sm rounded-xl px-4 py-3 pl-10 border focus:outline-none focus:ring-2 focus:ring-indigo-500/40 ${themeStyles.inputBg}`}
                />
                <Search
                  className="absolute left-3 top-3.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500"
                />
                <button
                  onClick={selectFolder}
                  className="absolute right-2 top-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs shadow-lg shadow-indigo-500/30"
                >
                  {t.selectFolder}
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-2">
              <label className="text-xs font-semibold text-violet-400 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} /> {t.outputName}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="Merged_Invoices"
                  className={`w-full text-sm rounded-xl px-4 py-3 border focus:outline-none focus:ring-2 focus:ring-violet-500/40 ${themeStyles.inputBg}`}
                />
                <span className={`absolute right-3 top-3 text-xs font-mono ${themeStyles.textSub}`}>.pdf</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest opacity-0 select-none flex items-center gap-2">
                <div className="w-[14px] h-[14px]" /> Stats
              </label>
              <div className={`flex items-center justify-between px-8 min-w-[200px] h-[46px] rounded-xl border ${themeStyles.inputBg}`}>
                <div className="flex flex-col items-center justify-center gap-0.5">
                  <p className={`text-[9px] font-bold uppercase tracking-wider leading-none ${themeStyles.textSub}`}>{t.files}</p>
                  <p className={`text-sm font-bold leading-none ${themeStyles.textHead}`}>{files.length}</p>
                </div>
                <div className={`w-px h-5 ${themeStyles.divider}`} />
                <div className="flex flex-col items-center justify-center gap-0.5">
                  <p className={`text-[9px] font-bold uppercase tracking-wider leading-none ${themeStyles.textSub}`}>{t.selected}</p>
                  <p className="text-sm font-bold leading-none text-indigo-500">{selectedCount}</p>
                </div>
                <div className={`w-px h-5 ${themeStyles.divider}`} />
                <div className="flex flex-col items-center justify-center gap-0.5">
                  <p className={`text-[9px] font-bold uppercase tracking-wider leading-none ${themeStyles.textSub}`}>{t.size}</p>
                  <p className={`text-sm font-bold leading-none ${themeStyles.textHead}`}>{formatBytes(selectedSize || totalSize)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* View Toolbar - Moved to Header */}
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className={`text-xl font-semibold flex items-center gap-2 ${themeStyles.textHead}`}>
              <span className="w-1 h-6 bg-indigo-500 rounded-full block" />
              {viewMode === "grid" ? t.previewGrid : t.previewList}
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleToggleAll(!allSelected)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition ${themeStyles.toolbarBtn}`}
              >
                {allSelected ? t.deselectAll : t.selectAll}
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowSortMenu((prev) => !prev)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition ${themeStyles.toolbarBtn}`}
                >
                  <Filter size={14} />
                  {t.filter}
                  <ChevronDown size={14} />
                </button>
                {showSortMenu ? (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
                    <div
                      className={`absolute right-0 top-11 z-20 w-48 rounded-2xl border p-2 ${activeTheme === "dark" ? "bg-[#1a1d24] border-white/10" : "bg-white border-slate-200"}`}
                    >
                      <p className={`text-[10px] uppercase tracking-widest mb-2 ${themeStyles.textSub}`}>
                        {t.sortTitle}
                      </p>
                      {sortOptions.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => handlePickSort(option.field)}
                          className={`w-full text-left text-sm px-3 py-2 rounded-xl transition ${
                            sortConfig?.field === option.field ? "bg-indigo-500/20 text-indigo-200" : themeStyles.textMain
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-6 pb-32 custom-scrollbar relative">

        {!files.length ? (
          renderEmptyState()
        ) : (
          <FileList
            files={files}
            viewMode={viewMode}
            selectedMap={selectedMap}
            previewMap={previewMap}
            pageSelections={pageSelections}
            themeStyles={themeStyles}
            previewLoading={previewLoading}
            translations={t}
            onToggle={handleToggleFile}
            onChangePage={changePage}
            onReorder={handleReorder}
            accentPalette={accentPalette}
          />
        )}

        <p className={`text-sm mt-4 ${themeStyles.textSub}`}>
          {t.selected}: {selectedCount}/{files.length}
        </p>
      </main>

      <div className="fixed bottom-8 left-0 right-0 flex justify-center z-50 px-6">
        <div
          className={`border-2 rounded-2xl p-3 pl-5 pr-5 flex items-center gap-4 backdrop-blur-2xl max-w-3xl w-full shadow-2xl ${
            activeTheme === "dark" 
              ? "bg-[#1a1d24]/95 border-indigo-500/30" 
              : "bg-white/95 border-indigo-500/40"
          }`}
        >
          <div className="flex flex-col">
            <span className={`text-[10px] uppercase tracking-widest font-semibold ${themeStyles.textSub}`}>
              {t.status}
            </span>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className={`w-2 h-2 rounded-full ${statusTone} ${statusState.kind === "progress" ? "animate-pulse" : ""}`} />
              <span className="text-indigo-400">{statusMessage}</span>
            </div>
          </div>
          <div className={`h-10 w-px ${themeStyles.divider}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm truncate ${themeStyles.textMain}`}>
              {selectedCount} {t.files} {t.into}{" "}
              <span className={`font-semibold ${themeStyles.textHead}`}>
                {(customName || "Merged_Invoices").trim()}.pdf
              </span>
            </p>
            <div className="w-full h-1.5 rounded-full bg-black/10 overflow-hidden mt-2">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <button
            onClick={handleMerge}
            disabled={!selectedCount || !folderPath || isMerging}
            className={`relative overflow-hidden group whitespace-nowrap px-6 py-3 rounded-xl font-bold text-white shadow-lg transition ${
              !selectedCount || !folderPath || isMerging
                ? "bg-slate-500/40 cursor-not-allowed"
                : `bg-gradient-to-r ${themeStyles.accentGradient} hover:shadow-indigo-500/40`
            }`}
          >
            <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="relative z-10 flex items-center gap-2">
              {isMerging ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t.processing}
                </>
              ) : (
                <>
                  <Zap size={18} className="text-yellow-300" />
                  {t.mergeExport}
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      <MergeSummaryDialog
        open={dialog.open}
        title={dialog.title}
        description={
          dialog.failed.length ? `${dialog.description}\nFailed: ${dialog.failed.join(", ")}` : dialog.description
        }
        primaryLabel={t.close}
        onPrimary={closeDialog}
        variant={dialog.variant}
        theme={activeTheme}
      />
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${activeTheme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(15,23,42,0.2)"};
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${activeTheme === "dark" ? "rgba(255,255,255,0.3)" : "rgba(15,23,42,0.35)"};
        }
      `}</style>
    </div>
  );
}

export default App;

type SortField = "file_name" | "ext" | "modified_ts" | "size";
type SortDirection = "asc" | "desc";
type SortConfig = { field: SortField; direction: SortDirection };

const sortList = (list: InvoiceFile[], field: SortField, direction: SortDirection) => {
  const factor = direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (field) {
      case "file_name":
        return factor * a.file_name.localeCompare(b.file_name, "zh");
      case "ext":
        return factor * a.ext.localeCompare(b.ext);
      case "modified_ts":
        return factor * (a.modified_ts - b.modified_ts);
      case "size":
        return factor * (Number(a.size) - Number(b.size));
      default:
        return 0;
    }
  });
};

const mapPreviews = (entries: FilePreview[]) => {
  const map: Record<string, FilePreview> = {};
  entries.forEach((entry) => {
    map[entry.file.path] = entry;
  });
  return map;
};
