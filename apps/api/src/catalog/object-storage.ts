import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { safeJoin } from '../identity/storage';

export abstract class ObjectStorage {
  abstract put(key: string, body: Buffer): Promise<void>;
  abstract read(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer): Promise<void> {
    const path = safeJoin(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
  }

  read(key: string): Promise<Buffer> {
    return readFile(safeJoin(this.root, key));
  }

  async remove(key: string): Promise<void> {
    await rm(safeJoin(this.root, key), { force: true });
  }
}
