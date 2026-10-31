import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// The config uses absolute paths, so this works from any directory (npm prepack, CI).
await build({ configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)) });
