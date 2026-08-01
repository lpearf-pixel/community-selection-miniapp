function objectCode(value: unknown) {
  return value && typeof value === 'object' && 'code' in value
    ? String(value.code)
    : null;
}

export function isPrismaUniqueConflict(error: unknown) {
  return objectCode(error) === 'P2002';
}

export function isPrismaSerializationConflict(error: unknown) {
  if (objectCode(error) === 'P2034') return true;
  if (objectCode(error) !== 'P2010' || !error || typeof error !== 'object' || !('meta' in error)) {
    return false;
  }
  const meta = error.meta;
  return !!meta && typeof meta === 'object' && 'code' in meta && String(meta.code) === '40001';
}

export function isPrismaRetryableConflict(error: unknown) {
  return isPrismaUniqueConflict(error) || isPrismaSerializationConflict(error);
}
