import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const MergeSummaryDialog = ({ open, title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary }) => {
    if (!open)
        return null;
    return (_jsx("div", { className: "dialog-backdrop", children: _jsxs("div", { className: "dialog-card", children: [_jsx("h2", { children: title }), _jsx("p", { style: { color: "#374151", marginBottom: 24 }, children: description }), _jsxs("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end" }, children: [secondaryLabel && onSecondary ? (_jsx("button", { className: "button secondary", onClick: onSecondary, children: secondaryLabel })) : null, _jsx("button", { className: "button primary", onClick: onPrimary, children: primaryLabel })] })] }) }));
};
export default MergeSummaryDialog;
