import type { RefObject } from 'react';
import type { Grid2DProblem } from '../engine/gridProblem';
import type { TracePlayer } from '../engine/trace';
import type { ContainerKind, ContainerOp, SearchProblem } from '../engine/types';

const KIND_BADGE: Record<ContainerKind, string> = {
  queue: 'FIFO',
  stack: 'LIFO',
  'priority-queue': 'MIN-HEAP',
  set: 'SET',
  map: 'MAP',
};

function formatScalar(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

function formatValue(
  problem: SearchProblem,
  value: unknown,
  rawValues = false,
): string {
  if (rawValues) {
    return formatScalar(value);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return String(value);
  }
  if (value === problem.start) return 'S';
  if (value === problem.goal) return 'G';
  if (problem.kind === 'grid') {
    const grid = problem as Grid2DProblem;
    const x = value % grid.cols;
    const y = (value - x) / grid.cols;
    return `(${x},${y})`;
  }
  return `#${value}`;
}

function formatOpBadge(
  problem: SearchProblem,
  op: ContainerOp,
  rawValues = false,
): { readonly text: string; readonly tone: 'push' | 'pop' } {
  switch (op.type) {
    case 'push':
      return {
        text: `PUSH ${formatValue(problem, op.entry.value, rawValues)}`,
        tone: 'push',
      };
    case 'pop':
      return {
        text: `POP ${formatValue(problem, op.entry.value, rawValues)}`,
        tone: 'pop',
      };
    case 'set-add':
      return {
        text: `ADD ${formatValue(problem, op.value, rawValues)}`,
        tone: 'push',
      };
    case 'set-delete':
      return {
        text: `DEL ${formatValue(problem, op.value, rawValues)}`,
        tone: 'pop',
      };
    case 'set-clear':
      return { text: 'CLEAR', tone: 'pop' };
    case 'map-set':
      return {
        text: `SET ${formatValue(problem, op.key, rawValues)}:${formatScalar(op.value)}`,
        tone: 'push',
      };
    case 'map-delete':
      return {
        text: `DEL ${formatValue(problem, op.key, rawValues)}`,
        tone: 'pop',
      };
    case 'map-clear':
      return { text: 'CLEAR', tone: 'pop' };
  }
}

/**
 * Imperatively updates the live container panel DOM so RAF playback stays at
 * 60+ fps with zero per-frame React re-renders.
 */
export function syncContainersDom(
  host: HTMLElement | null,
  player: TracePlayer | null,
  problem: SearchProblem,
): void {
  if (!host) return;

  if (!player) {
    const empty = document.createElement('div');
    empty.className = 'containers-empty';
    empty.textContent = 'Containers · step or play to inspect live Queue / Stack / Open Set';
    host.replaceChildren(empty);
    return;
  }

  const snapshots = player.getContainers(24);
  const flags = player.getFlags();
  if (snapshots.length === 0 && flags.length === 0) {
    const none = document.createElement('div');
    none.className = 'containers-empty';
    none.textContent = 'No instrumented containers used by this algorithm.';
    host.replaceChildren(none);
    return;
  }

  const lastOps = player.lastStep?.containerOps ?? [];
  const changedFlags = new Set(
    player.lastStep?.flagDeltas.map((delta) => delta.name) ?? [],
  );
  const fragment = document.createDocumentFragment();

  if (flags.length > 0) {
    const flagsRow = document.createElement('div');
    flagsRow.className = 'flags-row';

    for (let i = 0; i < flags.length; i += 1) {
      const flag = flags[i]!;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'flag-sep';
        sep.textContent = ', ';
        flagsRow.appendChild(sep);
      }

      const chip = document.createElement('code');
      chip.className = changedFlags.has(flag.name)
        ? 'flag-item is-changed'
        : 'flag-item';
      chip.textContent = `${flag.name}: ${formatScalar(flag.value)}`;
      flagsRow.appendChild(chip);
    }

    fragment.appendChild(flagsRow);
  }

  for (const snap of snapshots) {
    const raw = snap.info.rawValues === true;
    const box = document.createElement('div');
    box.className = 'container-block';

    const header = document.createElement('div');
    header.className = 'container-header';

    const titleGroup = document.createElement('span');
    titleGroup.className = 'container-title-group';

    const title = document.createElement('span');
    title.className = 'container-title';
    title.textContent = `${snap.info.label} `;
    const kindSpan = document.createElement('span');
    kindSpan.className = 'container-kind';
    kindSpan.textContent = `[${KIND_BADGE[snap.info.kind]}]`;
    title.appendChild(kindSpan);
    titleGroup.appendChild(title);

    let lastOpForContainer: ContainerOp | null = null;
    for (let i = lastOps.length - 1; i >= 0; i -= 1) {
      if (lastOps[i]!.containerId === snap.info.id) {
        lastOpForContainer = lastOps[i]!;
        break;
      }
    }

    if (lastOpForContainer) {
      const badgeInfo = formatOpBadge(problem, lastOpForContainer, raw);
      const badge = document.createElement('span');
      badge.className = `container-op-badge is-${badgeInfo.tone}`;
      badge.textContent = badgeInfo.text;
      titleGroup.appendChild(badge);
    }

    const count = document.createElement('span');
    count.className = 'container-size';
    count.textContent = `size: ${snap.size}`;

    header.append(titleGroup, count);
    box.appendChild(header);

    const list = document.createElement('div');
    list.className = 'container-items';

    if (snap.size === 0) {
      const empty = document.createElement('span');
      empty.className = 'container-none';
      empty.textContent = 'empty';
      list.appendChild(empty);
    } else {
      const ordered = snap.info.kind !== 'set' && snap.info.kind !== 'map';
      for (let i = 0; i < snap.entries.length; i += 1) {
        const entry = snap.entries[i]!;
        const item = document.createElement('span');
        item.className =
          ordered && i === 0 ? 'container-item is-next' : 'container-item';

        const text = formatValue(problem, entry.value, raw);
        if (snap.info.kind === 'map') {
          item.textContent = `${text}:${formatScalar(entry.mapValue)}`;
        } else if (entry.priority !== undefined) {
          item.textContent = `${text}:${formatScalar(entry.priority)}`;
        } else {
          item.textContent = text;
        }
        list.appendChild(item);
      }
      if (snap.size > snap.entries.length) {
        const more = document.createElement('span');
        more.className = 'container-more';
        more.textContent = `+${snap.size - snap.entries.length}`;
        list.appendChild(more);
      }
    }

    box.appendChild(list);
    fragment.appendChild(box);
  }

  host.replaceChildren(fragment);
}

interface ContainerViewProps {
  readonly hostRef: RefObject<HTMLDivElement | null>;
}

export function ContainerView({ hostRef }: ContainerViewProps) {
  return <div ref={hostRef} className="containers-panel" />;
}
