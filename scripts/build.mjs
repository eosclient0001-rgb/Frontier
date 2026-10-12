// Frontier Road Editor — esbuild bundler
import { context } from 'esbuild';

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'public/assets/app.bundle.js',
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('watching src/ …');
} else {
  const ctx = await context(opts);
  await ctx.rebuild();
  await ctx.dispose();
}
