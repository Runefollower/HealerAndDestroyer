export type ResourceMap = Record<string, number>;

export function addResourceMaps(base: ResourceMap, delta: ResourceMap): ResourceMap {
  const result: ResourceMap = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

export function subtractResourceMaps(base: ResourceMap, delta: ResourceMap): ResourceMap {
  const result: ResourceMap = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] ?? 0) - value;
  }
  return result;
}

export function hasEnoughResources(base: ResourceMap, cost: ResourceMap): boolean {
  return Object.entries(cost).every(([key, value]) => (base[key] ?? 0) >= value);
}

