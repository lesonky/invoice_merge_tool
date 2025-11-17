import type { InvoiceFile } from "@shared-types/index";
import { formatBytes, formatDate } from "@lib/format";
import { useFilePreviews } from "@lib/useFilePreviews";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FilePreview } from "@lib/useFilePreviews";

type SortField = "file_name" | "ext" | "modified_ts" | "size";
type SortDirection = "asc" | "desc";
type ViewMode = "files" | "pages";

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

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

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
  const [viewMode, setViewMode] = useState<ViewMode>("files");
  const [zoom, setZoom] = useState(0.85);
  const [pageSelections, setPageSelections] = useState<Record<string, number>>({});
  const total = files.length;
  const selectedCount = useMemo(
    () => files.reduce((sum, file) => (selected[file.path] ?? true ? sum + 1 : sum), 0),
    [files, selected]
  );
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const { previews, loading: previewLoading } = useFilePreviews(files);
  const previewMap = useMemo(() => mapPreviews(previews), [previews]);
  const zoomPct = Math.round(zoom * 100);

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

  useEffect(() => {
    setPageSelections((prev) => {
      const next: Record<string, number> = {};
      files.forEach((file) => {
        const previewsForFile = previewMap[file.path]?.pages ?? [];
        const existing = prev[file.path] ?? 0;
        const maxIndex = previewsForFile.length ? previewsForFile.length - 1 : 0;
        next[file.path] = Math.min(existing, maxIndex);
      });
      return next;
    });
  }, [files, previewMap]);

  const adjustZoom = (delta: number) => {
    setZoom((prev) => {
      const next = +(prev + delta).toFixed(2);
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });
  };

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

  const tableView = (
    <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 12, border: "1px solid #e5e7eb" }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((file) => file.path)} strategy={verticalListSortingStrategy}>
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
          </table>
        </SortableContext>
      </DndContext>
    </div>
  );

  const galleryView = (
    <div className="gallery-shell">
      {previewLoading ? (
        <p className="inline-hint" style={{ marginBottom: 12 }}>
          预览生成中，请稍候…
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={files.map((file) => file.path)} strategy={rectSortingStrategy}>
          <div className="gallery-grid">
            {files.map((file) => {
              const previewPages = previewMap[file.path]?.pages ?? [];
              const pageIndex = pageSelections[file.path] ?? 0;
              const currentPage = previewPages[pageIndex];
              return (
                <SortablePreviewCard
                  key={file.path}
                  file={file}
                  selected={selected[file.path] ?? true}
                  preview={currentPage}
                  pageCount={previewPages.length}
                  pageIndex={pageIndex}
                  zoom={zoom}
                  loading={previewLoading && previewPages.length === 0}
                  onToggle={onToggle}
                  onPageChange={(nextIndex) =>
                    setPageSelections((prev) => ({
                      ...prev,
                      [file.path]: Math.max(0, Math.min(nextIndex, Math.max(previewPages.length - 1, 0)))
                    }))
                  }
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );

  return (
    <div>
      <div className="file-list-toolbar">
        <div className="zoom-control">
          <button
            type="button"
            className="toolbar-button"
            onClick={() => adjustZoom(-0.15)}
            disabled={viewMode !== "pages" || zoom <= MIN_ZOOM}
            aria-label="缩小"
          >
            −
          </button>
          <span className="zoom-label">{zoomPct}%</span>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => adjustZoom(0.15)}
            disabled={viewMode !== "pages" || zoom >= MAX_ZOOM}
            aria-label="放大"
          >
            +
          </button>
        </div>
        <div className="view-toggle">
          <button
            type="button"
            className={`toolbar-button ${viewMode === "files" ? "active" : ""}`}
            onClick={() => setViewMode("files")}
          >
            文件
          </button>
          <button
            type="button"
            className={`toolbar-button ${viewMode === "pages" ? "active" : ""}`}
            onClick={() => setViewMode("pages")}
          >
            页面
          </button>
        </div>
      </div>
      {viewMode === "files" ? tableView : galleryView}
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

interface SortablePreviewCardProps {
  file: InvoiceFile;
  selected: boolean;
  preview?: { pageNumber: number; url: string };
  pageCount: number;
  pageIndex: number;
  zoom: number;
  loading: boolean;
  onToggle: (path: string, checked: boolean) => void;
  onPageChange: (index: number) => void;
}

const SortablePreviewCard: React.FC<SortablePreviewCardProps> = ({
  file,
  selected,
  preview,
  pageCount,
  pageIndex,
  zoom,
  loading,
  onToggle,
  onPageChange
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: file.path });
  const width = 220 * zoom;
  const previewHeight = width * 0.65;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    cursor: "grab",
    width
  };

  const canPrev = pageCount > 1 && pageIndex > 0;
  const canNext = pageCount > 1 && pageIndex < pageCount - 1;

  return (
    <div ref={setNodeRef} className="gallery-card" style={style} {...attributes} {...listeners}>
      <div className="gallery-card__thumb" style={{ height: previewHeight }}>
        {preview ? (
          <img src={preview.url} alt={`${file.file_name} 第 ${preview.pageNumber} 页`} />
        ) : (
          <div className="gallery-card__placeholder">{loading ? "加载中…" : "无法生成预览"}</div>
        )}
      </div>
      <label className="gallery-card__meta">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(file.path, event.target.checked)}
          aria-label={`选择 ${file.file_name}`}
        />
        <span className="gallery-card__name" title={file.file_name}>
          {file.file_name}
        </span>
      </label>
      <div className="gallery-card__footer">
        <span className="gallery-card__page-hint">
          {pageCount ? `第 ${pageIndex + 1} / ${pageCount} 页` : file.ext.toUpperCase()}
        </span>
        {pageCount > 1 ? (
          <div className="gallery-card__pager">
            <button type="button" onClick={() => onPageChange(pageIndex - 1)} disabled={!canPrev} aria-label="上一页">
              ‹
            </button>
            <button type="button" onClick={() => onPageChange(pageIndex + 1)} disabled={!canNext} aria-label="下一页">
              ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const mapPreviews = (previews: FilePreview[]) => {
  const map: Record<string, FilePreview> = {};
  previews.forEach((item) => {
    map[item.file.path] = item;
  });
  return map;
};

export default FileList;
