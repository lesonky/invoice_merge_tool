import type { InvoiceFile } from "@shared-types/index";
import { formatBytes, formatDate } from "@lib/format";
import React from "react";

interface FileListProps {
  files: InvoiceFile[];
  emptyMessage: string;
}

const FileList: React.FC<FileListProps> = ({ files, emptyMessage }) => {
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
            <th style={{ width: "45%" }}>文件名</th>
            <th style={{ width: "15%" }}>类型</th>
            <th style={{ width: "25%" }}>修改时间</th>
            <th style={{ width: "15%" }}>大小</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.path}>
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
