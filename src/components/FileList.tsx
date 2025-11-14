import type { InvoiceFile } from "@shared-types/index";
import { formatBytes, formatDate } from "@lib/format";
import React, { useEffect, useMemo, useRef } from "react";

interface FileListProps {
  files: InvoiceFile[];
  emptyMessage: string;
  selected: Record<string, boolean>;
  onToggle: (path: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const FileList: React.FC<FileListProps> = ({
  files,
  emptyMessage,
  selected,
  onToggle,
  onToggleAll,
  onReorder
}) => {
  const total = files.length;
  const selectedCount = useMemo(
    () => files.reduce((sum, file) => (selected[file.path] ?? true ? sum + 1 : sum), 0),
    [files, selected]
  );
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = selectedCount > 0 && selectedCount < total;
  }, [selectedCount, total]);

  if (!files.length) {
    return (
      <div style={{
        padding: "48px 0",
        textAlign: "center",
        color: "#6b7280",
        border: "1px dashed #d1d5db",
        borderRadius: 12
      }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 12, border: "1px solid #e5e7eb" }}>
      <table className="file-table">
        <thead>
          <tr>
            <th style={{ width: "5%" }}>
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={total > 0 && selectedCount === total}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label="全选"
              />
            </th>
            <th style={{ width: "40%" }}>文件名</th>
            <th style={{ width: "15%" }}>类型</th>
            <th style={{ width: "25%" }}>修改时间</th>
            <th style={{ width: "15%" }}>大小</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file, index) => (
            <tr
              key={file.path}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(index));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                if (!Number.isNaN(from) && from !== index) {
                  onReorder(from, index);
                }
              }}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selected[file.path] ?? true}
                  onChange={(event) => onToggle(file.path, event.target.checked)}
                  aria-label={`选择 ${file.file_name}`}
                />
              </td>
              <td>{file.file_name}</td>
              <td style={{ textTransform: "uppercase" }}>{file.ext}</td>
              <td>{formatDate(file.modified_ts)}</td>
              <td>{formatBytes(file.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FileList;
