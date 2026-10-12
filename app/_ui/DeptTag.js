// A department shown as a tag (design §2.1 directory and profile cards, §5.2 wizard preview, header user menu).
// The existing .acct-tag pill look (small, bold, uppercase), tinted with the department's own color plus a
// color dot, so light colors (#fdab3d) stay readable. No hooks: server components can render it too.
//   <DeptTag dept={{ name: 'Survey', color: '#7f5347' }} />
//   <DeptTag name="Survey" color="#7f5347" />
// Renders nothing without a name.

const HEX = /^#[0-9a-fA-F]{6}$/;

export function deptColor(color) {
  return typeof color === 'string' && HEX.test(color) ? color : '#5B5859';
}

export default function DeptTag({ dept, name, color, className = '', title }) {
  const label = String(name ?? dept?.name ?? '').trim();
  if (!label) return null;
  const c = deptColor(color ?? dept?.color);
  return (
    <span
      className={`acct-tag dept-tag${className ? ` ${className}` : ''}`}
      style={{ '--dept': c, background: `${c}1a`, boxShadow: `inset 0 0 0 1px ${c}55` }}
      title={title || `Department: ${label}`}
    >
      <span className="dept-dot" style={{ background: c }} aria-hidden="true" />
      <span className="dept-label">{label}</span>
    </span>
  );
}

export { DeptTag };
