/** TypeORM's PostgreSQL runner returns [rows, rowCount] for UPDATE/DELETE. */
export function mutationRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  throw new Error('Unexpected PostgreSQL mutation result');
}
