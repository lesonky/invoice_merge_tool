import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatBytes, formatDate } from "@lib/format";
const FileList = ({ files, emptyMessage }) => {
    if (!files.length) {
        return (_jsx("div", { style: {
                padding: "48px 0",
                textAlign: "center",
                color: "#6b7280",
                border: "1px dashed #d1d5db",
                borderRadius: 12
            }, children: emptyMessage }));
    }
    return (_jsx("div", { style: { maxHeight: 320, overflow: "auto", borderRadius: 12, border: "1px solid #e5e7eb" }, children: _jsxs("table", { className: "file-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { width: "45%" }, children: "\u6587\u4EF6\u540D" }), _jsx("th", { style: { width: "15%" }, children: "\u7C7B\u578B" }), _jsx("th", { style: { width: "25%" }, children: "\u4FEE\u6539\u65F6\u95F4" }), _jsx("th", { style: { width: "15%" }, children: "\u5927\u5C0F" })] }) }), _jsx("tbody", { children: files.map((file) => (_jsxs("tr", { children: [_jsx("td", { children: file.file_name }), _jsx("td", { style: { textTransform: "uppercase" }, children: file.ext }), _jsx("td", { children: formatDate(file.modified_ts) }), _jsx("td", { children: formatBytes(file.size) })] }, file.path))) })] }) }));
};
export default FileList;
