import type {
  AlgorithmEntry,
  AlgorithmMeta,
  AlgorithmModule,
} from './types';

const modules = import.meta.glob<AlgorithmModule>('/src/algorithms/**/*.ts', {
  eager: true,
});

const rawSources = import.meta.glob<string>('/src/algorithms/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function inferMeta(filePath: string, partial?: Partial<AlgorithmMeta>): AlgorithmMeta {
  // Expected shape: /src/algorithms/<category>/<id>.ts or /src/algorithms/<id>.ts
  const relative = filePath.replace(/^\/src\/algorithms\//, '').replace(/\.ts$/, '');
  const parts = relative.split('/');
  const fileSlug = parts[parts.length - 1] ?? 'unknown';
  const folderSlug = parts.length > 1 ? parts[0]! : 'Custom';

  return {
    id: partial?.id ?? relative.replace(/\//g, '-'),
    name: partial?.name ?? titleFromSlug(fileSlug),
    category: partial?.category ?? titleFromSlug(folderSlug),
    weighted: partial?.weighted ?? false,
    usesHeuristic: partial?.usesHeuristic ?? false,
    supportsNegativeWeights: partial?.supportsNegativeWeights ?? false,
    requiresAdmissibleHeuristic:
      partial?.requiresAdmissibleHeuristic ?? (partial?.usesHeuristic ?? false),
    guaranteesOptimalUnweighted: partial?.guaranteesOptimalUnweighted ?? true,
    checkCompatibility: partial?.checkCompatibility,
    description: partial?.description ?? '',
  };
}

function loadAlgorithms(): AlgorithmEntry[] {
  const entries: AlgorithmEntry[] = [];

  for (const [filePath, mod] of Object.entries(modules)) {
    const fileName = filePath.split('/').pop() ?? '';
    if (fileName.startsWith('_') || fileName.endsWith('.test.ts')) {
      continue;
    }
    if (typeof mod.search !== 'function') {
      continue;
    }

    entries.push({
      meta: inferMeta(filePath, mod.meta),
      search: mod.search,
      source: rawSources[filePath] ?? '',
      filePath,
    });
  }

  entries.sort((a, b) => {
    const catCmp = a.meta.category.localeCompare(b.meta.category);
    return catCmp !== 0 ? catCmp : a.meta.name.localeCompare(b.meta.name);
  });

  return entries;
}

export const algorithms: readonly AlgorithmEntry[] = loadAlgorithms();

export function getAlgorithm(id: string): AlgorithmEntry | undefined {
  return algorithms.find((entry) => entry.meta.id === id);
}

export function groupAlgorithmsByCategory(): ReadonlyMap<string, readonly AlgorithmEntry[]> {
  const groups = new Map<string, AlgorithmEntry[]>();
  for (const entry of algorithms) {
    const list = groups.get(entry.meta.category) ?? [];
    list.push(entry);
    groups.set(entry.meta.category, list);
  }
  return groups;
}
