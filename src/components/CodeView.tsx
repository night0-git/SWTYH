import { useMemo, type RefObject } from 'react';
import { extractAlgorithmCode } from '../engine/codeExtract';
import type { TracePlayer } from '../engine/trace';

interface CodeViewProps {
  readonly filePath: string;
  readonly source: string;
  readonly tbodyRef: RefObject<HTMLTableSectionElement | null>;
  readonly expanded: boolean;
  readonly collapsed: boolean;
  readonly onToggleExpand: () => void;
}

/**
 * Updates active-line highlights imperatively inside the RAF/playback path
 * so code tracing stays synchronized at 60+ fps with zero React re-renders.
 */
export function syncCodeHighlightDom(
  tbody: HTMLTableSectionElement | null,
  player: TracePlayer | null,
): void {
  if (!tbody) return;
  const activeLines = player?.lastStep?.lines;
  const hasActive = Boolean(activeLines && activeLines.length > 0);
  const activeRows: HTMLTableRowElement[] = [];

  for (let i = 0; i < tbody.rows.length; i += 1) {
    const row = tbody.rows[i]!;
    const rawLine = Number(row.dataset.rawLine);
    const active = Boolean(hasActive && activeLines!.includes(rawLine));
    row.classList.toggle('is-active-line', active);
    if (active) {
      activeRows.push(row);
    }
  }

  const scroller = tbody.parentElement?.parentElement;
  if (activeRows.length === 0 || !scroller || scroller.clientHeight <= 0) {
    return;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const table = tbody.parentElement;
  const tableOffset = table && table.offsetParent === scroller ? table.offsetTop : 0;

  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (let i = 0; i < activeRows.length; i += 1) {
    const row = activeRows[i]!;
    const rect = row.getBoundingClientRect();
    const top =
      rect.height > 0 ? rect.top - scrollerRect.top + scroller.scrollTop : row.offsetTop + tableOffset;
    const bottom = rect.height > 0 ? top + rect.height : top + row.offsetHeight;
    if (top < minTop) minTop = top;
    if (bottom > maxBottom) maxBottom = bottom;
  }

  if (!Number.isFinite(minTop) || maxBottom <= minTop) {
    return;
  }

  const viewHeight = scroller.clientHeight;
  const viewTop = scroller.scrollTop;
  const viewBottom = viewTop + viewHeight;

  // Preserve current scroll offset when every highlighted line is already fully visible.
  if (minTop >= viewTop && maxBottom <= viewBottom) {
    return;
  }

  const pad = Math.min(8, Math.floor(viewHeight * 0.1));
  if (minTop < viewTop) {
    const topAligned = Math.max(0, minTop - pad);
    scroller.scrollTop = Math.min(minTop, Math.max(topAligned, maxBottom - viewHeight));
    return;
  }

  // Jumping downward: place the highlighted block near the bottom edge while keeping minTop visible.
  const bottomAligned = Math.min(maxBottom + pad - viewHeight, minTop);
  scroller.scrollTop = Math.max(0, bottomAligned);
}

export function CodeView({
  filePath,
  source,
  tbodyRef,
  expanded,
  collapsed,
  onToggleExpand,
}: CodeViewProps) {
  const lines = useMemo(() => extractAlgorithmCode(source), [source]);
  const displayPath = filePath.replace(/^\/src\//, 'src/');

  return (
    <div className={collapsed ? 'code-panel is-collapsed' : 'code-panel'}>
      <div className="code-header">
        <span className="code-header-title">{displayPath}</span>
        <div className="panel-header-actions">
          {!collapsed && <span>{lines.length} lines</span>}
          <button
            type="button"
            className="panel-toggle-btn"
            aria-label={
              expanded
                ? 'Restore split view from code'
                : collapsed
                  ? 'Restore code section'
                  : 'Maximize code section'
            }
            aria-pressed={expanded}
            onClick={onToggleExpand}
          >
            {expanded || collapsed ? 'Split' : 'Full'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="code-scroll">
          <table className="code-table" cellSpacing={0} cellPadding={0}>
            <tbody ref={tbodyRef}>
              {lines.map((row) => (
                <tr key={row.displayLine} data-raw-line={row.rawLine}>
                  <td className="code-ln">{row.displayLine}</td>
                  <td className="code-src">{row.text || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
