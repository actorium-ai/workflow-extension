import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/src/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  allowOverwrite: true,
});

// resources/technical_skills (read by ../src/workspace/technicalSkills.ts) is
// committed directly in this package — no build-time staging needed, unlike
// vscode-webview's vite build outputting into ./webview/dist.
