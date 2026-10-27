import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Catalog } from './fixtures.js';

/** Written by global setup, read by specs (workers are separate processes). Git-ignored. */
export const CATALOG_FILE = resolve(import.meta.dirname, '../.state/catalog.json');

export function getCatalog(): Catalog {
  return JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) as Catalog;
}
