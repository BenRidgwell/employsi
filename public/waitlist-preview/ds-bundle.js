/* @ds-bundle: {"format":3,"namespace":"EmploysiDesignSystem_f67ccf","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"StatusPill","sourcePath":"components/display/StatusPill.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Card","sourcePath":"components/layout/Card.jsx"},{"name":"ProgressBar","sourcePath":"components/layout/ProgressBar.jsx"},{"name":"Tabs","sourcePath":"components/layout/Tabs.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"4a18a0fdf1b8","components/actions/IconButton.jsx":"c19cbfb953b9","components/display/Avatar.jsx":"7dfe9b9c9d2b","components/display/Badge.jsx":"ced62ef650b8","components/display/StatusPill.jsx":"9971ea942483","components/display/Tag.jsx":"146207a7b359","components/feedback/Dialog.jsx":"5cbf1ade01e2","components/feedback/Toast.jsx":"1e7642a97990","components/feedback/Tooltip.jsx":"5d5a9cb78897","components/forms/Checkbox.jsx":"7898e315e657","components/forms/Input.jsx":"357fbe7cba48","components/forms/Radio.jsx":"eb13f4bdb9f2","components/forms/Select.jsx":"edb12c46befb","components/forms/Switch.jsx":"4c9605807377","components/forms/Textarea.jsx":"c33a7c856045","components/layout/Card.jsx":"ce103339b8ae","components/layout/ProgressBar.jsx":"ed4355d439d0","components/layout/Tabs.jsx":"63ed7a51f4e3","ui_kits/app/AppShell.jsx":"9b4479b4da3f","ui_kits/app/CandidateProfile.jsx":"9008a457dc6b","ui_kits/app/JobsScreen.jsx":"61ea303186a2","ui_kits/app/PipelineScreen.jsx":"6d0535b72739","ui_kits/app/data.js":"1cc55bf75cd5","ui_kits/app/icons.jsx":"ca83f54e858c","ui_kits/marketing/Chrome.jsx":"f7dc5c25e4b4","ui_kits/marketing/Sections.jsx":"bfffc29cacd1"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.EmploysiDesignSystem_f67ccf = window.EmploysiDesignSystem_f67ccf || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * employsi Button — ink-first, greyscale brand.
 * Variants: primary (ink), secondary (outline), ghost, danger.
 */
function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  iconLeft = null,
  iconRight = null,
  children,
  style,
  ...rest
}) {
  const sizes = {
    sm: {
      height: 32,
      padding: '0 12px',
      font: 13,
      radius: 'var(--radius-sm)',
      gap: 6
    },
    md: {
      height: 38,
      padding: '0 16px',
      font: 14,
      radius: 'var(--radius-md)',
      gap: 8
    },
    lg: {
      height: 46,
      padding: '0 22px',
      font: 15,
      radius: 'var(--radius-md)',
      gap: 8
    }
  };
  const s = sizes[size] || sizes.md;
  const variants = {
    primary: {
      background: 'var(--action-primary)',
      color: 'var(--action-primary-text)',
      border: '1px solid var(--action-primary)'
    },
    secondary: {
      background: 'var(--surface-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-primary)',
      border: '1px solid transparent'
    },
    danger: {
      background: 'var(--red-500)',
      color: '#fff',
      border: '1px solid var(--red-500)'
    }
  };
  const isDisabled = disabled || loading;
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: isDisabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      width: fullWidth ? '100%' : undefined,
      fontFamily: 'var(--font-sans)',
      fontSize: s.font,
      fontWeight: 'var(--weight-medium)',
      letterSpacing: '-0.005em',
      lineHeight: 1,
      borderRadius: s.radius,
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.5 : 1,
      transition: 'background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)',
      whiteSpace: 'nowrap',
      ...variants[variant],
      ...style
    },
    onMouseDown: e => {
      if (!isDisabled) e.currentTarget.style.transform = 'scale(0.98)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
    }
  }, rest), loading && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 13,
      height: 13,
      borderRadius: '50%',
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      display: 'inline-block',
      animation: 'employsi-spin 0.7s linear infinite'
    }
  }), !loading && iconLeft, children && /*#__PURE__*/React.createElement("span", null, children), !loading && iconRight, /*#__PURE__*/React.createElement("style", null, `@keyframes employsi-spin{to{transform:rotate(360deg)}}`));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * employsi IconButton — square, icon-only control. Pass an icon as children
 * (e.g. a Lucide <i data-lucide> or SVG).
 */
function IconButton({
  variant = 'ghost',
  size = 'md',
  disabled = false,
  'aria-label': ariaLabel,
  children,
  style,
  ...rest
}) {
  const dims = {
    sm: 30,
    md: 36,
    lg: 42
  };
  const d = dims[size] || dims.md;
  const variants = {
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid transparent'
    },
    secondary: {
      background: 'var(--surface-card)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)'
    },
    primary: {
      background: 'var(--action-primary)',
      color: 'var(--action-primary-text)',
      border: '1px solid var(--action-primary)'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": ariaLabel,
    disabled: disabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: d,
      height: d,
      borderRadius: 'var(--radius-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)',
      ...variants[variant],
      ...style
    },
    onMouseEnter: e => {
      if (!disabled && variant === 'ghost') {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }
    },
    onMouseLeave: e => {
      if (variant === 'ghost') {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const PALETTE = ['#6c6c72', '#48484a', '#8e8e93', '#2f8f63', '#3b6fd4', '#b8842a'];
function hashIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return h % mod;
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

/** employsi Avatar — image or auto-colored initials fallback. */
function Avatar({
  name = '',
  src,
  size = 36,
  style,
  ...rest
}) {
  const bg = PALETTE[hashIndex(name, PALETTE.length)];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: '50%',
      overflow: 'hidden',
      background: src ? 'var(--surface-sunken)' : bg,
      color: '#fff',
      flexShrink: 0,
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--weight-semibold)',
      fontSize: Math.round(size * 0.38),
      letterSpacing: '0.01em',
      boxShadow: 'inset 0 0 0 1px rgba(28,28,30,.06)',
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Badge — small label. Neutral by default; tones map to status colors. */
function Badge({
  tone = 'neutral',
  size = 'md',
  children,
  style,
  ...rest
}) {
  const tones = {
    neutral: {
      bg: 'var(--surface-sunken)',
      fg: 'var(--text-secondary)'
    },
    solid: {
      bg: 'var(--action-primary)',
      fg: 'var(--action-primary-text)'
    },
    success: {
      bg: 'var(--status-success-bg)',
      fg: 'var(--status-success-fg)'
    },
    warning: {
      bg: 'var(--status-warning-bg)',
      fg: 'var(--status-warning-fg)'
    },
    danger: {
      bg: 'var(--status-danger-bg)',
      fg: 'var(--status-danger-fg)'
    },
    info: {
      bg: 'var(--status-info-bg)',
      fg: 'var(--status-info-fg)'
    }
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === 'sm' ? '2px 7px' : '3px 9px';
  const fs = size === 'sm' ? 11 : 12;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: pad,
      borderRadius: 'var(--radius-sm)',
      background: t.bg,
      color: t.fg,
      fontFamily: 'var(--font-sans)',
      fontSize: fs,
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1.3,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/StatusPill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * employsi StatusPill — candidate pipeline / job status with a leading dot.
 * The core status metaphor across the ATS.
 */
function StatusPill({
  status = 'applied',
  label,
  style,
  ...rest
}) {
  const map = {
    applied: {
      dot: 'var(--neutral-500)',
      fg: 'var(--text-secondary)',
      text: 'Applied'
    },
    screening: {
      dot: 'var(--status-info-dot)',
      fg: 'var(--status-info-fg)',
      text: 'Screening'
    },
    interview: {
      dot: 'var(--status-warning-dot)',
      fg: 'var(--status-warning-fg)',
      text: 'Interview'
    },
    offer: {
      dot: 'var(--status-info-dot)',
      fg: 'var(--status-info-fg)',
      text: 'Offer'
    },
    hired: {
      dot: 'var(--status-success-dot)',
      fg: 'var(--status-success-fg)',
      text: 'Hired'
    },
    rejected: {
      dot: 'var(--status-danger-dot)',
      fg: 'var(--status-danger-fg)',
      text: 'Rejected'
    }
  };
  const s = map[status] || map.applied;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 'var(--weight-medium)',
      color: s.fg,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: s.dot,
      flexShrink: 0
    }
  }), label || s.text);
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Tag — removable/selectable chip for skills, filters, labels. */
function Tag({
  children,
  onRemove,
  selected = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: onRemove ? '4px 6px 4px 10px' : '4px 10px',
      borderRadius: 'var(--radius-pill)',
      background: selected ? 'var(--action-primary)' : 'var(--surface-card)',
      color: selected ? 'var(--action-primary-text)' : 'var(--text-secondary)',
      border: `1px solid ${selected ? 'var(--action-primary)' : 'var(--border-default)'}`,
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1.3,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), children, onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 16,
      height: 16,
      borderRadius: '50%',
      border: 'none',
      cursor: 'pointer',
      background: 'transparent',
      color: 'inherit',
      opacity: 0.6,
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
/** employsi Dialog — modal with scrim, card panel, header/footer slots. */
function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  width = 480,
  children
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'rgba(28,28,30,.34)',
      backdropFilter: 'blur(2px)',
      animation: 'employsi-fade var(--duration-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    style: {
      width: '100%',
      maxWidth: width,
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-xl)',
      border: '1px solid var(--border-subtle)',
      overflow: 'hidden',
      animation: 'employsi-pop var(--duration-slow) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '22px 24px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 18,
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '-0.015em',
      color: 'var(--text-primary)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      lineHeight: 1.5,
      color: 'var(--text-secondary)'
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      padding: 4,
      marginRight: -4,
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '18px 24px',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 10,
      padding: '14px 24px',
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--surface-subtle)'
    }
  }, footer)), /*#__PURE__*/React.createElement("style", null, `@keyframes employsi-fade{from{opacity:0}to{opacity:1}}@keyframes employsi-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Toast — transient notification. Render one or map a stack. */
function Toast({
  tone = 'neutral',
  title,
  message,
  onDismiss,
  style,
  ...rest
}) {
  const tones = {
    neutral: {
      dot: 'var(--neutral-500)'
    },
    success: {
      dot: 'var(--green-500)'
    },
    warning: {
      dot: 'var(--amber-500)'
    },
    danger: {
      dot: 'var(--red-500)'
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      width: 340,
      padding: '13px 14px',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-sans)',
      animation: 'employsi-toast var(--duration-slow) var(--ease-out)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: t.dot,
      marginTop: 5,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-primary)'
    }
  }, title), message && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)',
      marginTop: title ? 2 : 0,
      lineHeight: 1.45
    }
  }, message)), onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      padding: 2,
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))), /*#__PURE__*/React.createElement("style", null, `@keyframes employsi-toast{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}`));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
const {
  useState
} = React;
/** employsi Tooltip — hover label. Wraps a single child. */
function Tooltip({
  label,
  side = 'top',
  children
}) {
  const [show, setShow] = useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 8
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: 8
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: 8
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: 8
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 1100,
      ...pos[side],
      background: 'var(--neutral-900)',
      color: 'var(--neutral-0)',
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      fontWeight: 'var(--weight-medium)',
      padding: '5px 9px',
      borderRadius: 'var(--radius-sm)',
      whiteSpace: 'nowrap',
      boxShadow: 'var(--shadow-md)',
      pointerEvents: 'none',
      animation: 'employsi-tip var(--duration-fast) var(--ease-standard)'
    }
  }, label, /*#__PURE__*/React.createElement("style", null, `@keyframes employsi-tip{from{opacity:0}to{opacity:1}}`)));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Checkbox with optional label. */
function Checkbox({
  label,
  checked,
  defaultChecked,
  disabled = false,
  id,
  onChange,
  ...rest
}) {
  const inputId = id || (label ? `cb-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      width: 18,
      height: 18
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 18,
      height: 18,
      margin: 0,
      cursor: 'inherit'
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "data-box": true,
    style: {
      width: 18,
      height: 18,
      borderRadius: 'var(--radius-xs)',
      border: '1.5px solid var(--border-strong)',
      background: 'var(--surface-card)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background var(--duration-fast), border-color var(--duration-fast)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#fff",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      opacity: checked ?? defaultChecked ? 1 : 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })))), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("style", null, `label:has(input:checked) [data-box]{background:var(--action-primary)!important;border-color:var(--action-primary)!important}label:has(input:checked) [data-box] svg{opacity:1!important}`));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** employsi text Input with optional label, hint, error, and leading/trailing adornments. */
function Input({
  label,
  hint,
  error,
  size = 'md',
  iconLeft = null,
  iconRight = null,
  disabled = false,
  id,
  style,
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const heights = {
    sm: 32,
    md: 38,
    lg: 44
  };
  const h = heights[size] || heights.md;
  const inputId = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const borderColor = error ? 'var(--red-500)' : focused ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontSize: 13,
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: h,
      padding: '0 12px',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focused ? 'var(--focus-ring)' : 'none',
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      opacity: disabled ? 0.6 : 1
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    disabled: disabled,
    onFocus: e => {
      setFocused(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocused(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'inherit',
      fontSize: size === 'sm' ? 13 : 14,
      color: 'var(--text-primary)',
      ...style
    }
  }, rest)), iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, iconRight)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: error ? 'var(--red-500)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Radio with optional label. Use several with the same `name`. */
function Radio({
  label,
  checked,
  defaultChecked,
  disabled = false,
  id,
  name,
  value,
  onChange,
  ...rest
}) {
  const inputId = id || (label ? `rd-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      width: 18,
      height: 18
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    defaultChecked: defaultChecked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 18,
      height: 18,
      margin: 0,
      cursor: 'inherit'
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "data-dot": true,
    style: {
      width: 18,
      height: 18,
      borderRadius: '50%',
      border: '1.5px solid var(--border-strong)',
      background: 'var(--surface-card)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'border-color var(--duration-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--action-primary)',
      opacity: checked ?? defaultChecked ? 1 : 0,
      transition: 'opacity var(--duration-fast)'
    }
  }))), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("style", null, `label:has(input:checked) [data-dot]{border-color:var(--action-primary)!important}label:has(input:checked) [data-dot] span{opacity:1!important}`));
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** employsi Select — native select styled to match Input, with chevron. */
function Select({
  label,
  hint,
  error,
  size = 'md',
  disabled = false,
  children,
  id,
  style,
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const heights = {
    sm: 32,
    md: 38,
    lg: 44
  };
  const h = heights[size] || heights.md;
  const inputId = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const borderColor = error ? 'var(--red-500)' : focused ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontSize: 13,
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: inputId,
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      height: h,
      padding: '0 34px 0 12px',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focused ? 'var(--focus-ring)' : 'none',
      outline: 'none',
      fontFamily: 'inherit',
      fontSize: size === 'sm' ? 13 : 14,
      color: 'var(--text-primary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      ...style
    }
  }, rest), children), /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--text-tertiary)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: 'absolute',
      right: 12,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: error ? 'var(--red-500)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Switch — toggle for settings. */
function Switch({
  label,
  checked,
  defaultChecked,
  disabled = false,
  id,
  onChange,
  ...rest
}) {
  const inputId = id || (label ? `sw-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      width: 40,
      height: 24
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    disabled: disabled,
    onChange: onChange,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 40,
      height: 24,
      margin: 0,
      cursor: 'inherit'
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    "data-track": true,
    style: {
      width: 40,
      height: 24,
      borderRadius: 999,
      background: 'var(--neutral-300)',
      transition: 'background var(--duration-base) var(--ease-standard)',
      display: 'inline-block',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "data-thumb": true,
    style: {
      position: 'absolute',
      top: 3,
      left: 3,
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: 'var(--shadow-sm)',
      transition: 'transform var(--duration-base) var(--ease-standard)'
    }
  }))), label && /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("style", null, `label:has(input:checked) [data-track]{background:var(--action-primary)!important}label:has(input:checked) [data-thumb]{transform:translateX(16px)!important}`));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState
} = React;
/** employsi multi-line Textarea with label, hint, error. */
function Textarea({
  label,
  hint,
  error,
  disabled = false,
  rows = 4,
  id,
  style,
  ...rest
}) {
  const [focused, setFocused] = useState(false);
  const inputId = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const borderColor = error ? 'var(--red-500)' : focused ? 'var(--border-focus)' : 'var(--border-default)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontSize: 13,
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    id: inputId,
    rows: rows,
    disabled: disabled,
    onFocus: e => {
      setFocused(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocused(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      resize: 'vertical',
      padding: '10px 12px',
      background: disabled ? 'var(--surface-sunken)' : 'var(--surface-card)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focused ? 'var(--focus-ring)' : 'none',
      outline: 'none',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.5,
      color: 'var(--text-primary)',
      transition: 'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
      ...style
    }
  }, rest)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: error ? 'var(--red-500)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/layout/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Card — surface container. Soft border + subtle shadow, 14px radius. */
function Card({
  padding = 20,
  interactive = false,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding,
      transition: 'box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)',
      cursor: interactive ? 'pointer' : undefined,
      ...style
    },
    onMouseEnter: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      e.currentTarget.style.borderColor = 'var(--border-default)';
    } : undefined,
    onMouseLeave: interactive ? e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      e.currentTarget.style.borderColor = 'var(--border-subtle)';
    } : undefined
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Card.jsx", error: String((e && e.message) || e) }); }

// components/layout/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi ProgressBar — thin track, ink fill. Value 0–100. */
function ProgressBar({
  value = 0,
  tone = 'ink',
  height = 6,
  showLabel = false,
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value));
  const fills = {
    ink: 'var(--action-primary)',
    success: 'var(--green-500)',
    warning: 'var(--amber-500)',
    danger: 'var(--red-500)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height,
      background: 'var(--surface-sunken)',
      borderRadius: 999,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct}%`,
      height: '100%',
      background: fills[tone] || fills.ink,
      borderRadius: 999,
      transition: 'width var(--duration-slow) var(--ease-out)'
    }
  })), showLabel && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-tertiary)',
      minWidth: 34,
      textAlign: 'right'
    }
  }, Math.round(pct), "%"));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/layout/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** employsi Tabs — underline style. `tabs` = [{id,label,count?}]. Controlled via value/onChange. */
function Tabs({
  tabs = [],
  value,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      gap: 4,
      borderBottom: '1px solid var(--border-subtle)',
      ...style
    }
  }, rest), tabs.map(t => {
    const active = t.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      onClick: () => onChange && onChange(t.id),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '10px 12px 12px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-medium)',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        boxShadow: active ? 'inset 0 -2px 0 var(--action-primary)' : 'none',
        transition: 'color var(--duration-fast) var(--ease-standard)'
      },
      onMouseEnter: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-secondary)';
      },
      onMouseLeave: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-tertiary)';
      }
    }, t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 'var(--weight-medium)',
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        background: active ? 'var(--surface-sunken)' : 'var(--surface-sunken)',
        color: active ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)'
      }
    }, t.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/AppShell.jsx
try { (() => {
// employsi app shell — sidebar + topbar
const DS = () => window.EmploysiDesignSystem_f67ccf;
function Sidebar({
  active,
  onNav
}) {
  const nav = [{
    id: 'jobs',
    label: 'Jobs',
    icon: 'briefcase'
  }, {
    id: 'candidates',
    label: 'Candidates',
    icon: 'users'
  }, {
    id: 'interviews',
    label: 'Interviews',
    icon: 'calendar'
  }, {
    id: 'reports',
    label: 'Reports',
    icon: 'bar-chart-3'
  }];
  const nav2 = [{
    id: 'settings',
    label: 'Settings',
    icon: 'settings'
  }, {
    id: 'help',
    label: 'Help',
    icon: 'life-buoy'
  }];
  const item = n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    onClick: () => onNav && onNav(n.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      width: '100%',
      padding: '8px 11px',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: active === n.id ? 600 : 500,
      color: active === n.id ? 'var(--text-primary)' : 'var(--text-secondary)',
      background: active === n.id ? 'var(--surface-sunken)' : 'transparent',
      transition: 'background var(--duration-fast)'
    },
    onMouseEnter: e => {
      if (active !== n.id) e.currentTarget.style.background = 'var(--surface-subtle)';
    },
    onMouseLeave: e => {
      if (active !== n.id) e.currentTarget.style.background = 'transparent';
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 17,
    color: active === n.id ? 'var(--text-primary)' : 'var(--text-tertiary)'
  }), n.label);
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 'var(--sidebar-width)',
      flexShrink: 0,
      borderRight: '1px solid var(--border-subtle)',
      background: 'var(--surface-page)',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px 12px',
      gap: 4,
      height: '100%',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 8px 16px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark.svg",
    width: "26",
    height: "26",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 19,
      fontWeight: 600,
      letterSpacing: '-0.025em'
    }
  }, "employsi")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, nav.map(item)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, nav2.map(item)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 8px 4px',
      marginTop: 8,
      borderTop: '1px solid var(--border-subtle)'
    }
  }, React.createElement(DS().Avatar, {
    name: 'Jordan Lee',
    size: 30
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, "Jordan Lee"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-tertiary)'
    }
  }, "Acme Inc"))));
}
function Topbar({
  title,
  crumb,
  actions,
  onBack
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 'var(--topbar-height)',
      flexShrink: 0,
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 var(--page-gutter)',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 0
    }
  }, onBack && React.createElement(DS().IconButton, {
    'aria-label': 'Back',
    variant: 'ghost',
    size: 'sm',
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 17
  })), crumb && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-tertiary)',
      fontFamily: 'var(--font-mono)'
    }
  }, crumb), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 18,
      fontWeight: 600,
      letterSpacing: '-0.015em',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, actions));
}
Object.assign(window, {
  Sidebar,
  Topbar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/CandidateProfile.jsx
try { (() => {
// employsi — Candidate profile screen
function ProfileField({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10.5,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      marginBottom: 5
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, children));
}
function CandidateProfile({
  candidate,
  onReject,
  onAdvance
}) {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const c = candidate;
  useLucide();
  const stageOrder = ['applied', 'screening', 'interview', 'offer', 'hired'];
  const curIdx = stageOrder.indexOf(c.stage);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      height: '100%',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: 'auto',
      padding: 'var(--page-gutter)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      alignItems: 'center'
    }
  }, React.createElement(DS.Avatar, {
    name: c.name,
    size: 60
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: '-0.02em'
    }
  }, c.name), /*#__PURE__*/React.createElement(DS.StatusPill, {
    status: c.stage
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--text-secondary)',
      marginTop: 3
    }
  }, c.role, " \xB7 ", c.loc))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      marginTop: 26
    }
  }, stageOrder.map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 26,
      height: 26,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: i <= curIdx ? 'var(--action-primary)' : 'var(--surface-sunken)',
      color: i <= curIdx ? '#fff' : 'var(--text-tertiary)',
      border: i <= curIdx ? 'none' : '1px solid var(--border-default)'
    }
  }, i < curIdx ? /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13,
    color: "#fff"
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontFamily: 'var(--font-mono)'
    }
  }, i + 1)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: i <= curIdx ? 'var(--text-primary)' : 'var(--text-tertiary)',
      textTransform: 'capitalize',
      fontWeight: i === curIdx ? 600 : 400
    }
  }, s)), i < stageOrder.length - 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1.5,
      background: i < curIdx ? 'var(--action-primary)' : 'var(--border-default)',
      margin: '0 4px',
      marginBottom: 20
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      margin: '0 0 12px'
    }
  }, "About"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      color: 'var(--text-secondary)',
      margin: 0,
      maxWidth: 560
    }
  }, c.name.split(' ')[0], " brings 7 years of product design across fintech and marketplaces, with deep work on design systems and cross-functional research. Applied for ", c.role, " and matched ", c.match, "% against the role requirements."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginTop: 16,
      flexWrap: 'wrap'
    }
  }, c.tags.concat(['Product thinking', 'Cross-functional']).map(t => /*#__PURE__*/React.createElement(DS.Tag, {
    key: t
  }, t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      margin: '0 0 12px'
    }
  }, "Interview notes"), /*#__PURE__*/React.createElement(DS.Card, {
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, React.createElement(DS.Avatar, {
    name: 'Jordan Lee',
    size: 28
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "Jordan Lee ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      color: 'var(--text-tertiary)',
      fontSize: 12
    }
  }, "\xB7 Screening call")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.55,
      color: 'var(--text-secondary)',
      margin: '5px 0 0'
    }
  }, "Strong systems thinker, communicates crisply. Wants scope over a design system rebuild \u2014 good fit for the role's mandate.")))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: '1px solid var(--border-subtle)',
      background: 'var(--surface-subtle)',
      padding: 'var(--page-gutter)',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, React.createElement(DS.Button, {
    variant: 'primary',
    fullWidth: true,
    onClick: onAdvance,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 15,
      color: "#fff"
    })
  }, 'Advance stage'), React.createElement(DS.Button, {
    variant: 'secondary',
    fullWidth: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "calendar",
      size: 15
    })
  }, 'Schedule interview'), React.createElement(DS.Button, {
    variant: 'ghost',
    fullWidth: true,
    onClick: onReject
  }, 'Reject')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(ProfileField, {
    label: "Match score"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement(DS.ProgressBar, {
    value: c.match,
    tone: c.match >= 85 ? 'success' : 'ink'
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 13
    }
  }, c.match, "%"))), /*#__PURE__*/React.createElement(ProfileField, {
    label: "Email"
  }, c.email), /*#__PURE__*/React.createElement(ProfileField, {
    label: "Location"
  }, c.loc), /*#__PURE__*/React.createElement(ProfileField, {
    label: "Applied"
  }, c.applied), /*#__PURE__*/React.createElement(ProfileField, {
    label: "Resume"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color: 'var(--text-link)',
      textDecoration: 'underline',
      textUnderlineOffset: 3,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 15
  }), " ", c.name.split(' ')[0].toLowerCase(), "-resume.pdf")))));
}
Object.assign(window, {
  CandidateProfile
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/CandidateProfile.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/JobsScreen.jsx
try { (() => {
// employsi — Jobs dashboard screen
function StatTile({
  label,
  value,
  delta,
  tone
}) {
  return React.createElement(window.EmploysiDesignSystem_f67ccf.Card, {
    padding: 18
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: '-0.02em'
    }
  }, value), delta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: tone === 'up' ? 'var(--green-500)' : 'var(--text-tertiary)'
    }
  }, delta))));
}
function JobsScreen({
  onOpenJob
}) {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const [tab, setTab] = React.useState('active');
  const jobs = window.EMP_DATA.jobs;
  useLucide();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Open roles",
    value: "5",
    delta: "+2",
    tone: "up"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Applicants",
    value: "148",
    delta: "+26 wk",
    tone: "up"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "In interview",
    value: "19"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Offers out",
    value: "3"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(DS.Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      id: 'active',
      label: 'Active',
      count: 5
    }, {
      id: 'draft',
      label: 'Drafts',
      count: 2
    }, {
      id: 'closed',
      label: 'Closed',
      count: 11
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      background: 'var(--surface-card)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '2.4fr 1fr 1fr 1.1fr 40px',
      gap: 16,
      padding: '11px 20px',
      background: 'var(--surface-subtle)',
      borderBottom: '1px solid var(--border-subtle)',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement("div", null, "Role"), /*#__PURE__*/React.createElement("div", null, "Applicants"), /*#__PURE__*/React.createElement("div", null, "Stage"), /*#__PURE__*/React.createElement("div", null, "Salary"), /*#__PURE__*/React.createElement("div", null)), jobs.map((j, i) => /*#__PURE__*/React.createElement("div", {
    key: j.id,
    onClick: () => onOpenJob(j),
    style: {
      display: 'grid',
      gridTemplateColumns: '2.4fr 1fr 1fr 1.1fr 40px',
      gap: 16,
      padding: '15px 20px',
      alignItems: 'center',
      cursor: 'pointer',
      borderBottom: i < jobs.length - 1 ? '1px solid var(--border-subtle)' : 'none',
      transition: 'background var(--duration-fast)'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--surface-subtle)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, j.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-tertiary)',
      marginTop: 2
    }
  }, j.dept, " \xB7 ", j.loc, " \xB7 ", j.type)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 14
    }
  }, j.applicants), j.new > 0 && /*#__PURE__*/React.createElement(DS.Badge, {
    tone: "solid",
    size: "sm"
  }, j.new, " new")), /*#__PURE__*/React.createElement(DS.StatusPill, {
    status: j.stage
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, j.salary), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      color: 'var(--text-tertiary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 17
  }))))));
}
Object.assign(window, {
  JobsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/JobsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/PipelineScreen.jsx
try { (() => {
// employsi — Candidate pipeline (kanban) screen
function RatingDots({
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 2
    }
  }, [1, 2, 3, 4, 5].map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      width: 5,
      height: 5,
      borderRadius: '50%',
      background: n <= value ? 'var(--action-primary)' : 'var(--neutral-300)'
    }
  })));
}
function CandidateCard({
  c,
  onOpen
}) {
  const DS = window.EmploysiDesignSystem_f67ccf;
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(c),
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: 12,
      cursor: 'pointer',
      boxShadow: 'var(--shadow-xs)',
      transition: 'box-shadow var(--duration-fast), border-color var(--duration-fast)'
    },
    onMouseEnter: e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      e.currentTarget.style.borderColor = 'var(--border-default)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
      e.currentTarget.style.borderColor = 'var(--border-subtle)';
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, React.createElement(DS.Avatar, {
    name: c.name,
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, c.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--text-tertiary)'
    }
  }, c.applied)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-tertiary)'
    }
  }, c.match, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      marginTop: 10,
      flexWrap: 'wrap'
    }
  }, c.tags.map(t => /*#__PURE__*/React.createElement(DS.Tag, {
    key: t
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 11
    }
  }, /*#__PURE__*/React.createElement(RatingDots, {
    value: c.rating
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "message-square",
    size: 13,
    color: "var(--text-tertiary)"
  })));
}
function PipelineScreen({
  job,
  onOpenCandidate
}) {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const stages = window.EMP_DATA.stages;
  const cands = window.EMP_DATA.candidates;
  useLucide();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      overflow: 'auto',
      height: '100%',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      alignItems: 'flex-start',
      minWidth: 'min-content'
    }
  }, stages.map(s => {
    const list = cands.filter(c => c.stage === s.id);
    return /*#__PURE__*/React.createElement("div", {
      key: s.id,
      style: {
        width: 268,
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 4px 12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(DS.StatusPill, {
      status: s.id,
      label: s.label
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--text-tertiary)'
      }
    }, list.length)), /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 15,
      color: "var(--text-tertiary)"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--surface-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 10,
        minHeight: 120
      }
    }, list.map(c => /*#__PURE__*/React.createElement(CandidateCard, {
      key: c.id,
      c: c,
      onOpen: onOpenCandidate
    }))));
  })));
}
Object.assign(window, {
  PipelineScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/PipelineScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/data.js
try { (() => {
// employsi web app — mock data
window.EMP_DATA = {
  jobs: [{
    id: 'j1',
    title: 'Senior Product Designer',
    dept: 'Design',
    loc: 'Remote · US',
    type: 'Full-time',
    applicants: 24,
    stage: 'interview',
    new: 3,
    salary: '$140–170k',
    posted: '5 days ago'
  }, {
    id: 'j2',
    title: 'Staff Backend Engineer',
    dept: 'Engineering',
    loc: 'New York, NY',
    type: 'Full-time',
    applicants: 61,
    stage: 'screening',
    new: 8,
    salary: '$190–230k',
    posted: '2 weeks ago'
  }, {
    id: 'j3',
    title: 'Customer Success Lead',
    dept: 'Success',
    loc: 'Remote · EU',
    type: 'Full-time',
    applicants: 18,
    stage: 'offer',
    new: 0,
    salary: '£70–85k',
    posted: '3 days ago'
  }, {
    id: 'j4',
    title: 'Growth Marketer',
    dept: 'Marketing',
    loc: 'Austin, TX',
    type: 'Contract',
    applicants: 12,
    stage: 'applied',
    new: 5,
    salary: '$90–110k',
    posted: '1 day ago'
  }, {
    id: 'j5',
    title: 'Data Analyst',
    dept: 'Data',
    loc: 'Remote · Global',
    type: 'Full-time',
    applicants: 33,
    stage: 'screening',
    new: 2,
    salary: '$110–130k',
    posted: '1 week ago'
  }],
  stages: [{
    id: 'applied',
    label: 'Applied'
  }, {
    id: 'screening',
    label: 'Screening'
  }, {
    id: 'interview',
    label: 'Interview'
  }, {
    id: 'offer',
    label: 'Offer'
  }],
  candidates: [{
    id: 'c1',
    name: 'Dana Ruiz',
    role: 'Product Designer',
    stage: 'interview',
    rating: 4,
    applied: '2 days ago',
    tags: ['Figma', 'Design systems'],
    email: 'dana@ruiz.co',
    loc: 'Denver, CO',
    match: 92
  }, {
    id: 'c2',
    name: 'Sam Okoye',
    role: 'Product Designer',
    stage: 'screening',
    rating: 5,
    applied: '3 days ago',
    tags: ['Prototyping', 'Research'],
    email: 'sam.okoye@mail.com',
    loc: 'Remote',
    match: 88
  }, {
    id: 'c3',
    name: 'Priya Nair',
    role: 'Product Designer',
    stage: 'applied',
    rating: 0,
    applied: '5 hours ago',
    tags: ['Motion', 'Brand'],
    email: 'priya@nair.design',
    loc: 'Toronto, CA',
    match: 74
  }, {
    id: 'c4',
    name: 'Marco Vidal',
    role: 'Product Designer',
    stage: 'interview',
    rating: 3,
    applied: '1 week ago',
    tags: ['Design systems', 'UX'],
    email: 'marco.v@mail.com',
    loc: 'Lisbon, PT',
    match: 81
  }, {
    id: 'c5',
    name: 'Lena Fox',
    role: 'Product Designer',
    stage: 'offer',
    rating: 5,
    applied: '2 weeks ago',
    tags: ['Leadership', 'Systems'],
    email: 'lena@fox.io',
    loc: 'Remote · US',
    match: 95
  }, {
    id: 'c6',
    name: 'Theo Bloom',
    role: 'Product Designer',
    stage: 'applied',
    rating: 0,
    applied: '1 day ago',
    tags: ['Visual', 'Web'],
    email: 'theo@bloom.co',
    loc: 'Berlin, DE',
    match: 69
  }, {
    id: 'c7',
    name: 'Aisha Bello',
    role: 'Product Designer',
    stage: 'screening',
    rating: 4,
    applied: '4 days ago',
    tags: ['Product', 'Data'],
    email: 'aisha@bello.me',
    loc: 'London, UK',
    match: 84
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/data.js", error: String((e && e.message) || e) }); }

// ui_kits/app/icons.jsx
try { (() => {
// Lucide icon helper for the employsi kits.
// Renders <i data-lucide="name"> and re-hydrates via the Lucide CDN global.
function Icon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 2,
  style
}) {
  return React.createElement('i', {
    'data-lucide': name,
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      ...style
    },
    'data-sw': strokeWidth
  });
}
// Call after each render so freshly-mounted <i data-lucide> get replaced by SVG.
function useLucide(dep) {
  React.useEffect(() => {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons({
        attrs: {
          'stroke-width': 2
        }
      });
    }
  });
}
Object.assign(window, {
  Icon,
  useLucide
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/icons.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Chrome.jsx
try { (() => {
// employsi marketing — header + footer chrome
function MktHeader() {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const links = ['Product', 'Customers', 'Pricing', 'Resources'];
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: 'rgba(255,255,255,.82)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      height: 64,
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 40
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark.svg",
    width: "26",
    height: "26",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: '-0.025em'
    }
  }, "employsi")), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 4
    }
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      padding: '7px 12px',
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-secondary)',
      textDecoration: 'none',
      borderRadius: 'var(--radius-sm)'
    },
    onMouseEnter: e => e.currentTarget.style.color = 'var(--text-primary)',
    onMouseLeave: e => e.currentTarget.style.color = 'var(--text-secondary)'
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-primary)',
      textDecoration: 'none'
    }
  }, "Sign in"), React.createElement(DS.Button, {
    size: 'md'
  }, 'Start free'))));
}
function MktFooter() {
  const cols = [{
    h: 'Product',
    items: ['Sourcing', 'Pipeline', 'Interviews', 'Analytics', 'Integrations']
  }, {
    h: 'Company',
    items: ['About', 'Customers', 'Careers', 'Blog']
  }, {
    h: 'Resources',
    items: ['Docs', 'Guides', 'Support', 'Changelog']
  }, {
    h: 'Legal',
    items: ['Privacy', 'Terms', 'Security', 'DPA']
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--surface-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '56px 32px 40px',
      display: 'grid',
      gridTemplateColumns: '1.6fr repeat(4, 1fr)',
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark.svg",
    width: "24",
    height: "24",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 600,
      letterSpacing: '-0.025em'
    }
  }, "employsi")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: 'var(--text-tertiary)',
      marginTop: 14,
      maxWidth: 240,
      lineHeight: 1.55
    }
  }, "Hiring software for teams who want the process to get out of the way.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.08em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      marginBottom: 14
    }
  }, c.h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, c.items.map(i => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: "#",
    style: {
      fontSize: 13.5,
      color: 'var(--text-secondary)',
      textDecoration: 'none'
    }
  }, i)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '18px 32px',
      borderTop: '1px solid var(--border-subtle)',
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 12.5,
      color: 'var(--text-tertiary)',
      fontFamily: 'var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 employsi, Inc."), /*#__PURE__*/React.createElement("span", null, "Made for people who hire.")));
}
Object.assign(window, {
  MktHeader,
  MktFooter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Sections.jsx
try { (() => {
// employsi marketing — page sections
function Hero() {
  const DS = window.EmploysiDesignSystem_f67ccf;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '88px 32px 56px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 12px 5px 8px',
      borderRadius: 999,
      border: '1px solid var(--border-default)',
      background: 'var(--surface-card)',
      boxShadow: 'var(--shadow-xs)',
      marginBottom: 26
    }
  }, /*#__PURE__*/React.createElement(DS.Badge, {
    tone: "solid",
    size: "sm"
  }, "New"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, "Match scoring is now live")), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 68,
      fontWeight: 600,
      letterSpacing: '-0.03em',
      lineHeight: 1.02,
      margin: 0,
      maxWidth: 820,
      marginInline: 'auto'
    }
  }, "Hiring, without the busywork."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 19,
      lineHeight: 1.55,
      color: 'var(--text-secondary)',
      margin: '22px auto 0',
      maxWidth: 560
    }
  }, "employsi keeps every candidate moving \u2014 one pipeline, clear stages, and the context your team needs to decide fast."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      justifyContent: 'center',
      marginTop: 30
    }
  }, React.createElement(DS.Button, {
    size: 'lg'
  }, 'Start free'), React.createElement(DS.Button, {
    variant: 'secondary',
    size: 'lg',
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "play",
      size: 15
    })
  }, 'Watch demo')), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-tertiary)',
      marginTop: 16
    }
  }, "Free for 14 days \xB7 No credit card"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 52,
      borderRadius: 'var(--radius-2xl)',
      border: '1px solid var(--border-default)',
      background: 'var(--surface-card)',
      boxShadow: 'var(--shadow-xl)',
      overflow: 'hidden',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 40,
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      padding: '0 16px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: 'var(--neutral-300)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: 'var(--neutral-300)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: 'var(--neutral-300)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 12,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-tertiary)'
    }
  }, "app.employsi.com/pipeline")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      padding: 20,
      background: 'var(--surface-subtle)'
    }
  }, [['Applied', 'applied', 2], ['Screening', 'screening', 3], ['Interview', 'interview', 2], ['Offer', 'offer', 1]].map(([label, st, n]) => /*#__PURE__*/React.createElement("div", {
    key: st
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(DS.StatusPill, {
    status: st,
    label: label
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, Array.from({
    length: n
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: 10,
      boxShadow: 'var(--shadow-xs)',
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, React.createElement(DS.Avatar, {
    name: ['Dana R', 'Sam O', 'Priya N', 'Marco V', 'Lena F', 'Theo B', 'Aisha B', 'Nils K'][i + n],
    size: 26
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 7,
      width: '62%',
      background: 'var(--neutral-200)',
      borderRadius: 4
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      width: '40%',
      background: 'var(--neutral-150)',
      borderRadius: 4,
      marginTop: 6
    }
  }))))))))));
}
function LogoStrip() {
  const names = ['Northwind', 'Lumen', 'Cedar', 'Fathom', 'Basecamp', 'Vela'];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '8px 32px 40px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      marginBottom: 22
    }
  }, "Trusted by hiring teams at"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      gap: 44,
      flexWrap: 'wrap',
      opacity: .55
    }
  }, names.map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: '-0.02em',
      color: 'var(--text-secondary)'
    }
  }, n))));
}
function FeatureGrid() {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const feats = [{
    icon: 'layout-grid',
    h: 'One pipeline',
    p: 'Every candidate, every role, in stages your team actually uses. Drag to move forward.'
  }, {
    icon: 'sparkles',
    h: 'Match scoring',
    p: 'See how each applicant lines up against the role before you open the resume.'
  }, {
    icon: 'calendar-clock',
    h: 'Scheduling built in',
    p: 'Send availability, book interviews, and sync calendars without leaving the profile.'
  }, {
    icon: 'message-square-text',
    h: 'Shared notes',
    p: 'Feedback lives on the candidate, not in a dozen threads. Decide together, faster.'
  }, {
    icon: 'shield-check',
    h: 'Structured & fair',
    p: 'Consistent scorecards keep every interview comparable and every decision defensible.'
  }, {
    icon: 'plug',
    h: 'Fits your stack',
    p: 'Connect your ATS, job boards, and HRIS. employsi sits in the middle, quietly.'
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-subtle)',
      borderTop: '1px solid var(--border-subtle)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '80px 32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 520
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      letterSpacing: '.14em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, "Everything in one place"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: '-0.025em',
      lineHeight: 1.1,
      margin: '14px 0 0'
    }
  }, "The parts of hiring that matter, and none that don't.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 20,
      marginTop: 44
    }
  }, feats.map(f => /*#__PURE__*/React.createElement(DS.Card, {
    key: f.h,
    padding: 22
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-inverse)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: f.icon,
    size: 18,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      margin: '16px 0 6px',
      letterSpacing: '-0.01em'
    }
  }, f.h), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.55,
      color: 'var(--text-secondary)',
      margin: 0
    }
  }, f.p))))));
}
function Pricing() {
  const DS = window.EmploysiDesignSystem_f67ccf;
  const plans = [{
    name: 'Starter',
    price: '$0',
    unit: '/ mo',
    desc: 'For a first hire or two.',
    feats: ['1 open role', 'Up to 50 candidates', 'Shared notes'],
    cta: 'Start free',
    variant: 'secondary',
    featured: false
  }, {
    name: 'Team',
    price: '$99',
    unit: '/ mo',
    desc: 'For growing teams hiring often.',
    feats: ['Unlimited roles', 'Match scoring', 'Scheduling', 'Integrations'],
    cta: 'Start free trial',
    variant: 'primary',
    featured: true
  }, {
    name: 'Scale',
    price: 'Custom',
    unit: '',
    desc: 'For high-volume orgs.',
    feats: ['SSO & SCIM', 'Advanced analytics', 'Dedicated support', 'DPA & security review'],
    cta: 'Talk to sales',
    variant: 'secondary',
    featured: false
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '80px 32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 44
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      letterSpacing: '.14em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, "Pricing"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: '-0.025em',
      margin: '14px 0 0'
    }
  }, "Simple, per-team pricing.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 20,
      alignItems: 'start'
    }
  }, plans.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-xl)',
      padding: 26,
      border: p.featured ? '1.5px solid var(--action-primary)' : '1px solid var(--border-subtle)',
      boxShadow: p.featured ? 'var(--shadow-lg)' : 'var(--shadow-sm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, p.name), p.featured && /*#__PURE__*/React.createElement(DS.Badge, {
    tone: "solid",
    size: "sm"
  }, "Popular")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 4,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: '-0.025em'
    }
  }, p.price), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-tertiary)'
    }
  }, p.unit)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: 'var(--text-secondary)',
      margin: '6px 0 20px'
    }
  }, p.desc), React.createElement(DS.Button, {
    variant: p.variant,
    fullWidth: true
  }, p.cta), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 11,
      marginTop: 22
    }
  }, p.feats.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 14,
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 15,
    color: "var(--green-500)"
  }), " ", f)))))));
}
function CTA() {
  const DS = window.EmploysiDesignSystem_f67ccf;
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 32px 80px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-inverse)',
      borderRadius: 'var(--radius-2xl)',
      padding: '64px 48px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/mark-reversed.svg",
    width: "48",
    height: "48",
    alt: "",
    style: {
      marginBottom: 18
    }
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 44,
      fontWeight: 600,
      letterSpacing: '-0.03em',
      color: '#f3f3f4',
      margin: 0
    }
  }, "Start hiring better today."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17,
      color: 'rgba(255,255,255,.6)',
      margin: '14px auto 0',
      maxWidth: 440
    }
  }, "Set up your first pipeline in minutes. Free for 14 days."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      justifyContent: 'center',
      marginTop: 28
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      height: 46,
      padding: '0 22px',
      borderRadius: 'var(--radius-md)',
      border: 'none',
      background: '#fff',
      color: 'var(--neutral-900)',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Start free"), /*#__PURE__*/React.createElement("button", {
    style: {
      height: 46,
      padding: '0 22px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(255,255,255,.24)',
      background: 'transparent',
      color: '#fff',
      fontFamily: 'var(--font-sans)',
      fontSize: 15,
      fontWeight: 500,
      cursor: 'pointer'
    }
  }, "Talk to sales"))));
}
Object.assign(window, {
  Hero,
  LogoStrip,
  FeatureGrid,
  Pricing,
  CTA
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Sections.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
