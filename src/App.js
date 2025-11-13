import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { open as openShell } from "@tauri-apps/api/shell";
import { listen } from "@tauri-apps/api/event";
import FileList from "@components/FileList";
import MergeSummaryDialog from "@components/MergeSummaryDialog";
const defaultDialog = {
    open: false,
    title: "",
    description: "",
    failed: []
};
function App() {
    const [folderPath, setFolderPath] = useState("");
    const [files, setFiles] = useState([]);
    const [sortMode, setSortMode] = useState("FileNameAsc");
    const [isMerging, setIsMerging] = useState(false);
    const [statusMessage, setStatusMessage] = useState("就绪。");
    const [progress, setProgress] = useState(0);
    const [customName, setCustomName] = useState("");
    const [dialog, setDialog] = useState(defaultDialog);
    useEffect(() => {
        const unlistenPromise = listen("merge-progress", (event) => {
            const { current, total, phase } = event.payload;
            if (!total)
                return;
            const pct = Math.round((current / total) * 100);
            setProgress(pct);
            const labelMap = {
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
            const result = await invoke("scan_folder_cmd", { folderPath: folder });
            setFolderPath(folder);
            setFiles(result);
            setStatusMessage(`已找到 ${result.length} 个可合并文件。`);
        }
        catch (error) {
            console.error(error);
            setStatusMessage("扫描失败，请重试。");
        }
    }, []);
    const sortedFiles = useMemo(() => {
        const sorted = [...files];
        if (sortMode === "FileNameAsc") {
            sorted.sort((a, b) => a.file_name.localeCompare(b.file_name, "zh"));
        }
        else if (sortMode === "ModifiedAsc") {
            sorted.sort((a, b) => a.modified_ts - b.modified_ts);
        }
        return sorted;
    }, [files, sortMode]);
    const handleMerge = useCallback(async () => {
        if (!folderPath || !sortedFiles.length) {
            return;
        }
        setIsMerging(true);
        setProgress(0);
        setStatusMessage("开始合并，请稍候…");
        setDialog(defaultDialog);
        try {
            const result = await invoke("merge_invoices_cmd", {
                req: {
                    folder_path: folderPath,
                    files: sortedFiles,
                    sort_mode: sortMode,
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
            }
            else {
                setDialog({
                    open: true,
                    title: "合并失败",
                    description: result.message ?? "未知错误",
                    failed: result.failed_files
                });
                setStatusMessage("合并失败");
            }
        }
        catch (error) {
            console.error(error);
            setDialog({
                open: true,
                title: "合并失败",
                description: error instanceof Error ? error.message : String(error),
                failed: []
            });
            setStatusMessage("合并失败");
        }
        finally {
            setIsMerging(false);
        }
    }, [folderPath, sortedFiles, sortMode, customName]);
    const openResultFolder = useCallback(async () => {
        if (!dialog.outputPath)
            return;
        await openShell(dialog.outputPath);
        setDialog(defaultDialog);
    }, [dialog.outputPath]);
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("div", { className: "panel", children: [_jsxs("header", { style: { marginBottom: 24 }, children: [_jsx("h1", { children: "Master Concept \u53D1\u7968\u5408\u5E76\u52A9\u624B" }), _jsx("p", { className: "inline-hint", children: "\u9009\u62E9\u53D1\u7968\u6587\u4EF6\u5939\uFF0C\u4E00\u952E\u5408\u5E76 PDF / \u56FE\u7247 / HEIC\u3002" })] }), _jsxs("section", { style: { marginBottom: 24 }, children: [_jsx("label", { className: "inline-hint", style: { display: "block", marginBottom: 8 }, children: "\u5F53\u524D\u6587\u4EF6\u5939" }), _jsxs("div", { style: { display: "flex", gap: 12, alignItems: "center" }, children: [_jsx("div", { style: {
                                            flex: 1,
                                            minHeight: 44,
                                            borderRadius: 12,
                                            border: "1px solid #e5e7eb",
                                            padding: "10px 14px",
                                            background: "#f9fafb",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }, children: folderPath || "未选择" }), _jsx("button", { className: "button secondary", onClick: selectFolder, children: "\u9009\u62E9\u6587\u4EF6\u5939" })] })] }), _jsx("section", { style: { marginBottom: 16 }, children: _jsxs("div", { style: { display: "flex", gap: 24, alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("label", { className: "inline-hint", children: "\u6392\u5E8F\u65B9\u5F0F" }), _jsxs("div", { style: { display: "flex", gap: 16, marginTop: 8 }, children: [_jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [_jsx("input", { type: "radio", name: "sort", value: "FileNameAsc", checked: sortMode === "FileNameAsc", onChange: () => setSortMode("FileNameAsc") }), "\u6309\u6587\u4EF6\u540D"] }), _jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [_jsx("input", { type: "radio", name: "sort", value: "ModifiedAsc", checked: sortMode === "ModifiedAsc", onChange: () => setSortMode("ModifiedAsc") }), "\u6309\u4FEE\u6539\u65F6\u95F4"] })] })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { className: "inline-hint", htmlFor: "outputName", children: "\u8F93\u51FA\u6587\u4EF6\u540D\uFF08\u53EF\u9009\uFF09" }), _jsx("input", { id: "outputName", placeholder: "\u4F8B\u5982\uFF1Amerged_invoices_q1.pdf", value: customName, onChange: (event) => setCustomName(event.target.value), style: {
                                                width: "100%",
                                                marginTop: 8,
                                                borderRadius: 12,
                                                border: "1px solid #e5e7eb",
                                                padding: "10px 14px"
                                            } })] })] }) }), _jsx("section", { children: _jsx(FileList, { files: sortedFiles, emptyMessage: folderPath ? "此目录下没有可合并的文件。" : "尚未选择发票文件夹。" }) }), _jsx("section", { style: { marginTop: 24 }, children: _jsxs("div", { style: { display: "flex", gap: 16, alignItems: "center" }, children: [_jsx("button", { className: "button primary", disabled: isMerging || !sortedFiles.length, onClick: handleMerge, children: isMerging ? "合并中…" : "合并并导出 PDF" }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { className: "progress-shell", children: _jsx("div", { className: "progress-fill", style: { width: `${progress}%` } }) }), _jsx("p", { className: "inline-hint", style: { marginTop: 8 }, children: statusMessage })] })] }) })] }), _jsx(MergeSummaryDialog, { open: dialog.open, title: dialog.title, description: dialog.failed.length
                    ? `${dialog.description}\n失败文件：${dialog.failed.join(", ")}`
                    : dialog.description, primaryLabel: dialog.outputPath ? "打开输出文件" : "关闭", onPrimary: dialog.outputPath ? openResultFolder : () => setDialog(defaultDialog), secondaryLabel: dialog.outputPath ? "完成" : undefined, onSecondary: dialog.outputPath ? () => setDialog(defaultDialog) : undefined })] }));
}
export default App;
