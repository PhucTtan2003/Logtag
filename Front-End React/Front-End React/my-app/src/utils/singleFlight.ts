const inflightMap = new Map<string, Promise<any>>();

export function singleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflightMap.get(key);
  if (existing) return existing;
  const p = factory().finally(() => inflightMap.delete(key));
  inflightMap.set(key, p);
  return p;
}