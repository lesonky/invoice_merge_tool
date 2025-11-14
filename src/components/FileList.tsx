import type { InvoiceFile } from "@shared-types/index";
import { formatBytes, formatDate } from "@lib/format";
import React, { useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SortField = "file_name" | "ext" | "modified_ts" | "size";
type SortDirection = "asc" | "desc";

interface FileListProps {
  files: InvoiceFile[];
  emptyMessage: string;
  selected: Record<string, boolean>;
  onToggle: (path: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  sortConfig: { field: SortField; direction: SortDirection } | null;
  onRequestSort: (field: SortField) => void;
}

const FileList: React.FC<FileListProps> = ({
  files,
  emptyMessage,
  selected,
  onToggle,
  onToggleAll,
  onReorder,
  sortConfig,
  onRequestSort
}) => {
  const total = files.length;
  const selectedCount = useMemo(
    () => files.reduce((sum, file) => (selected[file.path] ?? true ? sum + 1 : sum), 0),
    [files, selected]
  );
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const fromIndex = files.findIndex((file) => file.path === activeId);
    const toIndex = files.findIndex((file) => file.path === overId);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }
    onReorder(fromIndex, toIndex);
  };

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
            {[
              { label: "文件名", field: "file_name", width: "40%" },
              { label: "类型", field: "ext", width: "15%" },
              { label: "修改时间", field: "modified_ts", width: "25%" },
              { label: "大小", field: "size", width: "15%" }
            ].map((column) => (
              <th
                key={column.field}
                style={{ width: column.width, cursor: "pointer", userSelect: "none" }}
                onClick={() => onRequestSort(column.field as SortField)}
              >
                {column.label}
                {sortConfig && sortConfig.field === column.field ? (
                  <span style={{ marginLeft: 4 }}>{sortConfig.direction === "asc" ? "↑" : "↓"}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={files.map((file) => file.path)} strategy={verticalListSortingStrategy}>
            <tbody>
              {files.map((file) => (
                <SortableRow
                  key={file.path}
                  file={file}
                  selected={selected[file.path] ?? true}
                  onToggle={onToggle}
                />
              ))}
            </tbody>
          </SortableContext>
        </DndContext>
      </table>
    </div>
  );
};

interface SortableRowProps {
  file: InvoiceFile;
  selected: boolean;
  onToggle: (path: string, checked: boolean) => void;
}

const SortableRow: React.FC<SortableRowProps> = ({ file, selected, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.path });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    cursor: "grab"
  };

  return (
    <tr ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(file.path, event.target.checked)}
          aria-label={`选择 ${file.file_name}`}
        />
      </td>
      <td>{file.file_name}</td>
      <td style={{ textTransform: "uppercase" }}>{file.ext}</td>
      <td>{formatDate(file.modified_ts)}</td>
      <td>{formatBytes(file.size)}</td>
    </tr>
  );
};

export default FileList;
