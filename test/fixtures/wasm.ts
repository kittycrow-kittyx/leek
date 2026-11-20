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

let asyncValue = 0;
let asyncReady = false;
let asyncCompletion: Promise<void> | null = null;

class ClosureCounter {
  private base = 3;

  async run(input: number): Promise<number> {
    const factor = input + this.base;
    let count = 0;
    const one = async (depth: number): Promise<number> => {
      count++;
      if (depth > 0) return await one(depth - 1) + factor;
      return this.base + count;
    };
    const first = await one(2);
    count += 1;
    return first + await one(0);
  }
}

async function completeClosure(input: number): Promise<void> {
  asyncValue = await new ClosureCounter().run(input);
  asyncReady = true;
}

export function beginClosure(input: number): number {
  asyncReady = false;
  asyncCompletion = completeClosure(input);
  return 0;
}

export function closureReady(): number { return asyncCompletion !== null && asyncReady ? 1 : 0; }
export function closureValue(): number { return asyncValue; }

export function mapDefault(present: number, value: number): number {
  const map: Map<string, number> = new Map<string, number>();
  if (present !== 0) map.set("key", value);
  return map.get("key") ?? -7;
}

class MapValue { constructor(readonly value: number) {} }
export function mapReferenceDefault(present: number, value: number): number {
  const map: Map<string, MapValue> = new Map<string, MapValue>();
  if (present !== 0) map.set("key", new MapValue(value));
  const item = map.get("key") ?? null;
  return item === null ? -7 : item.value;
}

export function indexedByte(index: number): number {
  const values: Uint8Array = new Uint8Array(3);
  values[0] = 0; values[1] = 128; values[2] = 255;
  return values[index] ?? -7;
}

export function indexedString(index: number): number {
  const value = "A😀Z"[index] ?? "?";
  return value.charCodeAt(0);
}

export function indexedReference(index: number): number {
  const values: string[] = new Array<string>(3);
  values[0] = ""; values[2] = "last";
  const value = values[index] ?? "missing";
  return value.length;
}

export function indexedObject(index: number): number {
  const values: MapValue[] = new Array<MapValue>(3);
  values[0] = new MapValue(0); values[2] = new MapValue(42);
  const value = values[index] ?? null;
  return value === null ? -7 : value.value;
}

export function indexedReadonly(index: number): number {
  const values: readonly string[] = ["zero", "one"];
  const value = values[index] ?? "?";
  return value.length;
}

export function removedReference(which: number): number {
  const values: string[] = new Array<string>(3);
  values[0] = ""; values[2] = "last";
  let result = 0;
  for (let step = 0; step < 4; step++) {
    const value = which === 0 ? values.pop() ?? "missing" : values.shift() ?? "missing";
    result = result * 10 + value.length;
  }
  return result + values.length;
}

export function relativeReference(index: number): number {
  const values: string[] = new Array<string>(3);
  values[0] = ""; values[2] = "last";
  return (values.at(index) ?? "missing").length;
}

export function relativeString(index: number): number {
  return ("A😀Z".at(index) ?? "?").charCodeAt(0);
}

function requiredOr<T>(value: T | null, fallback: T): T {
  if (value === null) return fallback;
  return value;
}

export function requiredNumber(index: number, value: number): number {
  const values: Float64Array = new Float64Array(1);
  values[0] = value;
  return requiredOr(values[index] ?? null, -7);
}

export function requiredMap(present: number, value: number): number {
  const values: Map<string, number> = new Map<string, number>();
  if (present !== 0) values.set("key", value);
  return requiredOr(values.get("key") ?? null, -7);
}

export function nativeEnvironment(): number {
  if (typeof navigator === "undefined") return 1;
  return navigator.hardwareConcurrency;
}

export function requiredBigInt(index: number, variant: number): number {
  const signed: BigInt64Array = new BigInt64Array(1);
  const unsigned: BigUint64Array = new BigUint64Array(1);
  const expected = variant === 0 ? 0n : variant === 1 ? -1n : variant === 2 ? 9223372036854775807n : -9223372036854775808n;
  signed[0] = expected;
  unsigned[0] = variant === 0 ? 0n : 18446744073709551615n;
  const a = requiredOr(signed[index] ?? null, 7n);
  const b = requiredOr(unsigned[index] ?? null, 7n);
  return (a === expected ? 1 : a === 7n ? 2 : 0) + (b === (variant === 0 ? 0n : 18446744073709551615n) ? 4 : b === 7n ? 8 : 0);
}

export function indexedBigInt(index: number): number {
  const values: BigInt64Array = new BigInt64Array(1);
  values[0] = -9223372036854775808n;
  return (values[index] ?? 13n) === 13n ? 1 : 2;
}

export function bigintLoop(): number {
  const values: BigInt64Array = new BigInt64Array(2);
  values[0] = 9223372036854775807n;
  values[1] = -9223372036854775808n;
  let result: bigint = 0n;
  for (const value of values) result ^= value;
  return result === -1n ? 1 : 0;
}


export function indexedCodePoint(index: number): number {
  return "A😀\ud800Z".codePointAt(index) ?? -7;
}

export function requiredCodePoint(index: number): number {
  return requiredOr("\0😀\ud800Z".codePointAt(index) ?? null, -7);
}
