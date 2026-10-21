export function canonicalJsonString(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
        throw new Error('Canonical JSON numbers must be safe integers. Send decimals as strings.');
      }
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new Error('Unsupported canonical JSON value.');
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringify(item)).join(',')}]`;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Canonical JSON objects must be plain objects.');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const properties = keys.map((key) => {
    if (record[key] === undefined) {
      throw new Error(`Canonical JSON key "${key}" cannot be undefined.`);
    }
    return `${JSON.stringify(key)}:${stringify(record[key])}`;
  });
  return `{${properties.join(',')}}`;
}
