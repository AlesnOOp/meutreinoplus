export function retainedLocalIds(
  local: { id: string; pending: boolean }[],
  remoteIds: readonly string[],
): string[] {
  const remote = new Set(remoteIds);
  return local.filter((row) => row.pending || remote.has(row.id)).map((row) => row.id);
}

export function syncBaseVersion(serverVersion: number | null): number | null {
  return serverVersion;
}
