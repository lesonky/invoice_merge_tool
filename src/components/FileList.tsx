import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, FileText, GripVertical, Image as ImageIcon } from "lucide-react";
import { formatBytes, formatDate } from "@lib/format";
import type { InvoiceFile } from "@shared-types/index";
import type { FilePreview, PreviewPage } from "@lib/useFilePreviews";
import type { ThemeStyles, ViewMode } from "@shared-types/ui";

interface FileListProps {
  files: InvoiceFile[];
  viewMode: ViewMode;
  selectedMap: Record<string, boolean>;
  previewMap: Record<string, FilePreview>;
  pageSelections: Record<string, number>;
  themeStyles: ThemeStyles;
  previewLoading: boolean;
  translations: {
    previewLoading: string;
    previewUnavailable: string;
    pageIndicator: string;
  };
  onToggle: (path: string, checked: boolean) => void;
  onChangePage: (path: string, delta: number) => void;
  onReorder: (newFiles: InvoiceFile[]) => void;
  accentPalette: Record<string, string>;
}

export default function FileList({
  files,
  viewMode,
  selectedMap,
  previewMap,
  pageSelections,
  themeStyles,
  previewLoading,
  translations: t,
  onToggle,
  onChangePage,
  onReorder,
  accentPalette,
}: FileListProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setActiveDragId(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const fromIndex = files.findIndex((file) => file.path === activeId);
    const toIndex = files.findIndex((file) => file.path === overId);
    
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(arrayMove(files, fromIndex, toIndex));
    }
    setActiveDragId(null);
  };

  const handleDragCancel = () => setActiveDragId(null);

  const activeDragMeta = useMemo(() => {
    if (!activeDragId) return null;
    const file = files.find((item) => item.path === activeDragId);
    if (!file) return null;
    const accent = accentPalette[file.path];
    const fileType = file.ext.toUpperCase();
    const previewInfo = previewMap[file.path];
    const pages = previewInfo?.pages ?? [];
    const pageIndex = pageSelections[file.path] ?? 0;
    const pageCount = pages.length;
    const previewPage = pages[pageIndex];
    const previewError = previewInfo?.error;
    const placeholderText = previewError ?? (previewLoading ? t.previewLoading : t.previewUnavailable);
    return { file, accent, fileType, previewPage, placeholderText, pageCount, pageIndex };
  }, [
    activeDragId,
    files,
    accentPalette,
    previewMap,
    pageSelections,
    previewLoading,
    t,
  ]);

  const formatPageIndicator = (current: number, total: number) =>
    t.pageIndicator.replace("{current}", String(current)).replace("{total}", String(total));

  const commonProps = {
    themeStyles,
    onToggle,
    onChangePage,
    formatPageIndicator,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={files.map((file) => file.path)}
        strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" : "flex flex-col gap-3"}>
          {files.map((file) => {
            const selected = selectedMap[file.path] ?? true;
            const accent = accentPalette[file.path];
            const fileType = file.ext.toUpperCase();
            const previewInfo = previewMap[file.path];
            const pages = previewInfo?.pages ?? [];
            const pageIndex = pageSelections[file.path] ?? 0;
            const pageCount = pages.length;
            const previewPage = pages[pageIndex];
            const previewError = previewInfo?.error;
            const placeholderText = previewError ?? (previewLoading ? t.previewLoading : t.previewUnavailable);

            const itemProps = {
              ...commonProps,
              file,
              selected,
              fileType,
              accent,
              previewPage,
              placeholderText,
              pageCount,
              pageIndex,
            };

            return viewMode === "grid" ? (
              <SortableGridCard key={file.path} {...itemProps} />
            ) : (
              <SortableListItem key={file.path} {...itemProps} />
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDragMeta ? (
          viewMode === "grid" ? (
            <DragPreviewCard
              {...activeDragMeta}
              themeStyles={themeStyles}
              formatPageIndicator={formatPageIndicator}
            />
          ) : (
            <DragPreviewListItem
              {...activeDragMeta}
              themeStyles={themeStyles}
              formatPageIndicator={formatPageIndicator}
            />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface ItemProps {
  file: InvoiceFile;
  selected: boolean;
  fileType: string;
  accent: string;
  previewPage?: PreviewPage;
  placeholderText: string;
  pageCount: number;
  pageIndex: number;
  themeStyles: ThemeStyles;
  onToggle: (path: string, checked: boolean) => void;
  onChangePage: (path: string, delta: number) => void;
  formatPageIndicator: (current: number, total: number) => string;
}

function SortableGridCard({
  file,
  selected,
  fileType,
  accent,
  previewPage,
  placeholderText,
  pageCount,
  pageIndex,
  themeStyles,
  onToggle,
  onChangePage,
  formatPageIndicator,
}: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: file.path,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 40 : undefined,
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(file.path, !selected);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative rounded-2xl border p-3 cursor-grab active:cursor-grabbing transition-all flex flex-col h-[320px] ${
        selected ? `${themeStyles.cardSelected} shadow-lg` : themeStyles.card
      }`}
    >
      {/* Top Row: Checkbox & Badge */}
      <div className="flex items-center justify-between mb-3 z-10">
        <div
          onClick={handleCheckboxClick}
          className={`w-6 h-6 rounded-full border flex items-center justify-center transition cursor-pointer ${
            selected ? "bg-indigo-500 border-indigo-500 text-white" : themeStyles.checkboxBase
          }`}
        >
          <Check size={14} strokeWidth={3} className={selected ? "opacity-100" : "opacity-0"} />
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${themeStyles.pill}`}>
          {fileType}
        </span>
      </div>

      {/* Middle: Preview */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden rounded-lg mb-3 bg-black/20">
        {previewPage ? (
          <img
            src={previewPage.url}
            alt={`${file.file_name} - page ${previewPage.pageNumber}`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
             <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white/20"
              style={{ background: accent ? `${accent}20` : undefined }}
            >
              {fileType === "PDF" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
            </div>
          </div>
        )}
        
        {/* Page Navigation (Overlay) */}
        {pageCount > 1 && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm border border-white/10"
               onPointerDown={(e) => e.stopPropagation()} // Prevent drag start
          >
            <button
              type="button"
              className="hover:text-indigo-400 disabled:opacity-30"
              onClick={(e) => {
                e.stopPropagation();
                onChangePage(file.path, -1);
              }}
              disabled={pageIndex === 0}
            >
              ‹
            </button>
            <span className="mx-1 font-mono">{pageIndex + 1}/{pageCount}</span>
            <button
              type="button"
              className="hover:text-indigo-400 disabled:opacity-30"
              onClick={(e) => {
                e.stopPropagation();
                onChangePage(file.path, 1);
              }}
              disabled={pageIndex === pageCount - 1}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {/* Bottom: File Info */}
      <div className="mt-auto">
        <p className={`text-sm font-medium truncate mb-1 ${selected ? "text-indigo-400" : themeStyles.textHead}`}>
          {file.file_name}
        </p>
        <div className="flex items-center justify-between text-[11px]">
          <span className={themeStyles.textSub}>{formatBytes(file.size)}</span>
          <span className={themeStyles.textSub}>Page {pageIndex + 1}/{pageCount || 1}</span>
        </div>
      </div>
    </div>
  );
}

function SortableListItem({
  file,
  selected,
  fileType,
  previewPage,
  placeholderText,
  pageCount,
  pageIndex,
  themeStyles,
  onToggle,
  onChangePage,
  formatPageIndicator,
}: ItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: file.path,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 30 : undefined,
  };
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(file.path, !selected);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`w-full flex items-center gap-4 rounded-2xl border px-4 py-3 text-left cursor-grab active:cursor-grabbing transition ${
        selected ? `${themeStyles.cardSelected} shadow-md` : themeStyles.card
      }`}
    >
      <div className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 bg-black/10 flex items-center justify-center shrink-0">
        {previewPage ? (
          <img src={previewPage.url} alt={file.file_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400 px-2 text-center leading-tight">{placeholderText}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${themeStyles.textHead}`}>{file.file_name}</p>
        <p className={`text-xs ${themeStyles.textSub}`}>
          {formatDate(file.modified_ts)} · {formatBytes(file.size)}
        </p>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2 mt-1 text-[11px] text-indigo-400">
            <button
              type="button"
              className="px-1 rounded border border-indigo-500/30"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onChangePage(file.path, -1);
              }}
              disabled={pageIndex === 0}
            >
              ‹
            </button>
            <span>{formatPageIndicator(pageIndex + 1, pageCount)}</span>
            <button
              type="button"
              className="px-1 rounded border border-indigo-500/30"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onChangePage(file.path, 1);
              }}
              disabled={pageIndex === pageCount - 1}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
      <span className={`text-[10px] font-bold px-3 py-1 rounded-full border ${themeStyles.pill}`}>{fileType}</span>
      <div
        onClick={handleCheckboxClick}
        onPointerDown={(e) => e.stopPropagation()}
        className={`w-6 h-6 rounded-full border flex items-center justify-center transition cursor-pointer ${
          selected ? "bg-indigo-500 border-indigo-500 text-white" : themeStyles.checkboxBase
        }`}
      >
        <Check size={14} strokeWidth={3} className={selected ? "opacity-100" : "opacity-0"} />
      </div>
    </div>
  );
}

interface DragPreviewProps {
  file: InvoiceFile;
  fileType: string;
  accent?: string;
  previewPage?: PreviewPage;
  placeholderText: string;
  pageCount: number;
  pageIndex: number;
  themeStyles: ThemeStyles;
  formatPageIndicator: (current: number, total: number) => string;
}

const DragPreviewCard = ({
  file,
  fileType,
  accent,
  previewPage,
  placeholderText,
  pageCount,
  pageIndex,
  themeStyles,
  formatPageIndicator,
}: DragPreviewProps) => (
  <div className={`rounded-2xl border p-3 w-[280px] h-[320px] flex flex-col ${themeStyles.cardSelected} shadow-2xl`}>
    {/* Top Row: Checkbox & Badge */}
    <div className="flex items-center justify-between mb-3">
      <div
        className={`w-6 h-6 rounded-full border flex items-center justify-center bg-indigo-500 border-indigo-500 text-white`}
      >
        <Check size={14} strokeWidth={3} />
      </div>
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${themeStyles.pill}`}>
        {fileType}
      </span>
    </div>

    {/* Middle: Preview */}
    <div className="flex-1 flex items-center justify-center relative overflow-hidden rounded-lg mb-3 bg-black/20">
      {previewPage ? (
        <img src={previewPage.url} alt={`${file.file_name} dragging`} className="w-full h-full object-contain" />
      ) : (
        <div className="flex flex-col items-center justify-center text-slate-500 gap-2">
             <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white/20"
              style={{ background: accent ? `${accent}20` : undefined }}
            >
              {fileType === "PDF" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
            </div>
          </div>
      )}
      {pageCount > 1 && (
        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full backdrop-blur-sm border border-white/10">
          <span className="font-mono">{pageIndex + 1}/{pageCount}</span>
        </div>
      )}
    </div>

    {/* Bottom: File Info */}
    <div className="mt-auto">
      <p className="text-sm font-medium truncate mb-1 text-indigo-400">
        {file.file_name}
      </p>
      <div className="flex items-center justify-between text-[11px]">
        <span className={themeStyles.textSub}>{formatBytes(file.size)}</span>
        <span className={themeStyles.textSub}>Page {pageIndex + 1}/{pageCount || 1}</span>
      </div>
    </div>
  </div>
);

const DragPreviewListItem = ({
  file,
  fileType,
  previewPage,
  placeholderText,
  pageCount,
  pageIndex,
  themeStyles,
  formatPageIndicator,
}: DragPreviewProps) => (
  <div
    className={`flex items-center gap-4 rounded-2xl border px-4 py-3 min-w-[600px] ${themeStyles.cardSelected} shadow-2xl`}
  >
    <div className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 bg-black/10 flex items-center justify-center shrink-0">
      {previewPage ? (
        <img src={previewPage.url} alt={`${file.file_name} dragging`} className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs text-slate-400 px-2 text-center leading-tight">{placeholderText}</span>
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className={`text-sm font-semibold truncate ${themeStyles.textHead}`}>{file.file_name}</p>
      <p className={`text-xs ${themeStyles.textSub}`}>
        {formatDate(file.modified_ts)} · {formatBytes(file.size)}
      </p>
      {pageCount > 1 ? (
        <p className="text-[11px] text-indigo-300 mt-1">{formatPageIndicator(pageIndex + 1, pageCount)}</p>
      ) : null}
    </div>
    <span className={`text-[10px] font-bold px-3 py-1 rounded-full border ${themeStyles.pill}`}>{fileType}</span>
  </div>
);