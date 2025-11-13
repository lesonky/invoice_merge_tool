import React from "react";

interface MergeSummaryDialogProps {
  open: boolean;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

const MergeSummaryDialog: React.FC<MergeSummaryDialogProps> = ({
  open,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary
}) => {
  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <div className="dialog-card">
        <h2>{title}</h2>
        <p style={{ color: "#374151", marginBottom: 24 }}>{description}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          {secondaryLabel && onSecondary ? (
            <button className="button secondary" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
          <button className="button primary" onClick={onPrimary}>
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeSummaryDialog;
