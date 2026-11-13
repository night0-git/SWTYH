import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { instrumentAlgorithmSource } from './src/engine/algorithmInstrument';

const ALG_PREFIX = '/src/algorithms/';

export function algorithmLinePlugin(): Plugin {
  return {
    name: 'swtyh-algorithm-line-tracker',
    enforce: 'pre',
    transform(code, id) {
      if (/[?&](raw|url|worker|inline)(?:&|$)/.test(id)) return null;
      const cleanId = id.split('?')[0]!.replace(/\\/g, '/');
      const markerIdx = cleanId.indexOf(ALG_PREFIX);
      if (markerIdx === -1 || !cleanId.endsWith('.ts') || cleanId.endsWith('.test.ts')) {
        return null;
      }
      const fileName = cleanId.split('/').pop() ?? '';
      if (fileName.startsWith('_')) return null;

      const relSubpath = cleanId.slice(markerIdx + ALG_PREFIX.length);
      const nestedDirs = relSubpath.split('/').length - 1;
      const traceLineImport = `${'../'.repeat(nestedDirs + 1)}engine/traceLine`;

      return {
        code: instrumentAlgorithmSource(code, cleanId, traceLineImport),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [algorithmLinePlugin(), react()],
});
