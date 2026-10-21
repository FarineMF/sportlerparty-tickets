// Bündelt src/tickets.js (pdf-lib, QR-Code, ZIP) für den Browser.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/tickets.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'SPTicket',
  target: ['es2020'],
  outfile: 'public/vendor/tickets.bundle.js',
  legalComments: 'none',
});
console.log('public/vendor/tickets.bundle.js gebaut');
