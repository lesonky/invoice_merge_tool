import React from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

interface MergeSummaryDialogProps {
  open: boolean;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  variant?: "success" | "error";
  theme?: "dark" | "light";
}

const MergeSummaryDialog: React.FC<MergeSummaryDialogProps> = ({
  open,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  variant = "success",
  theme = "light"
}) => {
  if (!open) return null;

  const isSuccess = variant === "success";
  const cardBase =
    theme === "dark"
      ? "bg-[#1a1d24]/95 text-slate-100 border-white/10"
      : "bg-white text-slate-700 border-slate-200";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div
        className={`relative w-full max-w-md rounded-3xl border shadow-2xl shadow-black/40 p-8 flex flex-col gap-5 ${cardBase}`}
      >
        <button
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 text-slate-400 hover:bg-white/10 flex items-center justify-center"
          onClick={onPrimary}
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>

        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
            isSuccess ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
          }`}
        >
          {isSuccess ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">{title}</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-80">{description}</p>
        </div>

        <div className="flex gap-3 mt-4">
          {secondaryLabel && onSecondary ? (
            <button
              onClick={onSecondary}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            onClick={onPrimary}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg shadow-indigo-500/30 ${
              isSuccess ? "bg-gradient-to-r from-emerald-500 to-teal-500" : "bg-gradient-to-r from-rose-500 to-red-500"
            }`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeSummaryDialog;
