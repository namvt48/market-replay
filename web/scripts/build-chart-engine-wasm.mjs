import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webRoot, '..');
const manifestPath = resolve(repoRoot, 'rust/chart-engine/Cargo.toml');
const metadata = spawnSync(
  'cargo',
  ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifestPath],
  { cwd: repoRoot, encoding: 'utf8' },
);

if (metadata.error) throw metadata.error;
if (metadata.status !== 0) {
  process.stderr.write(metadata.stderr);
  process.exit(metadata.status ?? 1);
}

const { target_directory: targetDirectory } = JSON.parse(metadata.stdout);
const build = spawnSync(
  'cargo',
  ['build', '--manifest-path', manifestPath, '--target', 'wasm32-unknown-unknown', '--release'],
  { cwd: repoRoot, stdio: 'inherit' },
);

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const wasmPath = resolve(targetDirectory, 'wasm32-unknown-unknown/release/chart_engine.wasm');
const assetPath = resolve(webRoot, 'src/replay/chart-engine.wasm');
await mkdir(dirname(assetPath), { recursive: true });
await copyFile(wasmPath, assetPath);
