/** The canonical mikuOS FNV-1a algorithm, without target-specific source changes. */
export function checksum(bytes: Uint8Array): number {
  let value = 0x811c9dc5;
  for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193);
  return value >>> 0;
}

export function multiply(a: number, b: number): number { return Math.imul(a, b); }
export function xor(a: number, b: number): number { return a ^ b; }
export function and(a: number, b: number): number { return a & b; }
export function or(a: number, b: number): number { return a | b; }
export function shl(a: number, b: number): number { return a << b; }
export function shr(a: number, b: number): number { return a >> b; }
export function ushr(a: number, b: number): number { return a >>> b; }

export function predicates(value: number): number {
  return (Number.isNaN(value) ? 1 : 0) + (Number.isFinite(value) ? 2 : 0) +
    (Number.isInteger(value) ? 4 : 0) + (Number.isSafeInteger(value) ? 8 : 0);
}

export function signedRead(): number {
  let value = 4294967295;
  value = Math.imul(value, 1);
  return value;
}

export function widerWrite(): number {
  let value = 1;
  value += 4294967296;
  return value ^ 0;
}

export function assignmentResult(): number {
  let value = 0;
  return (value = Math.imul(-1, 1)) > 0 ? 1 : 0;
}

type F64 = number;
function mulU32(left: F64, right: F64): F64 { return Math.imul(left, right) >>> 0; }

export function canonicalBindings(value: number): number {
  const NativeMath = value + 1;
  return mulU32(value, 3) + (Number.isFinite(NativeMath) ? 1 : 0);
}

let nullableCalls = 0;
function maybe(present: boolean): string | null { nullableCalls++; return present ? "value" : null; }
function fallback(): string { nullableCalls++; return "other"; }
export function nullableEffect(flag: number): number {
  nullableCalls = 0;
  const value = maybe(flag !== 0) ?? fallback();
  return nullableCalls * 10 + value.length;
}
