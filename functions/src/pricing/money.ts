/**
 * Money for the central pricing engine.
 *
 * Every authoritative amount is an integer number of PAISE, every rate is in
 * BASIS POINTS (1 bp = 0.01%, so 5% = 500 bps), and every division says how it
 * rounds. Floating-point rupees are only accepted at the boundary
 * (rupeesToPaise) and produced for display (formatInr). Multiplication goes
 * through BigInt so large carts can never lose precision.
 */

export type Paise = number;
export type Bps = number;

export type RoundingMode = "half_up" | "half_even" | "down" | "up";

export const ROUNDING_MODES: readonly RoundingMode[] = ["half_up", "half_even", "down", "up"];

export function isPaise(n: unknown): n is Paise {
  return typeof n === "number" && Number.isSafeInteger(n);
}

export function assertPaise(n: number, label = "amount"): Paise {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${label} must be a whole number of paise (got ${n}).`);
  }
  return n;
}

/**
 * Converts a rupee value from an external or legacy source. Boundary use only.
 * The fixed-point step avoids float drift (1.005 * 100 = 100.4999…).
 */
export function rupeesToPaise(rupees: unknown): Paise {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number((n * 100).toFixed(4)));
}

/** For display and legacy rupee fields only — never for further arithmetic. */
export function paiseToRupees(p: Paise): number {
  return p / 100;
}

function divideBig(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new Error("Division by zero in money arithmetic.");
  const negative = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  let out = q;
  switch (mode) {
    case "down":
      break;
    case "up":
      if (r > 0n) out = q + 1n;
      break;
    case "half_up":
      if (r * 2n >= ad && r > 0n) out = q + 1n;
      break;
    case "half_even":
      if (r * 2n > ad || (r * 2n === ad && q % 2n === 1n)) out = q + 1n;
      break;
  }
  return negative ? -out : out;
}

function toSafe(b: bigint, label: string): number {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new Error(`${label} overflowed safe integer range.`);
  return n;
}

/** (a × b) ÷ c with explicit rounding, exact for any safe-integer inputs. */
export function mulDiv(a: number, b: number, c: number, mode: RoundingMode = "half_up"): number {
  if (![a, b, c].every(Number.isSafeInteger)) {
    throw new Error(`mulDiv needs integers (got ${a}, ${b}, ${c}).`);
  }
  return toSafe(divideBig(BigInt(a) * BigInt(b), BigInt(c), mode), "mulDiv");
}

/** Integer division with explicit rounding. */
export function divide(numerator: number, denominator: number, mode: RoundingMode = "half_up"): number {
  return mulDiv(numerator, 1, denominator, mode);
}

/** amount × bps / 10 000. */
export function applyBps(amount: Paise, bps: Bps, mode: RoundingMode = "half_up"): Paise {
  return mulDiv(amount, bps, 10_000, mode);
}

/** Rounds to a multiple of [step] paise (100 = whole rupee). */
export function roundToStep(amount: Paise, step: number, mode: RoundingMode = "half_up"): Paise {
  if (!Number.isSafeInteger(step) || step <= 1) return amount;
  return divide(amount, step, mode) * step;
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) total += assertPaise(v);
  return assertPaise(total, "sum");
}

export function clampPaise(v: Paise, min: Paise | null | undefined, max: Paise | null | undefined): Paise {
  let out = v;
  if (min != null && out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

/**
 * Splits [total] across [weights] so the parts sum to EXACTLY [total]
 * (largest-remainder method; ties go to the earlier weight). Used to spread a
 * cart discount over lines, or a tax amount over its components.
 */
export function allocate(total: Paise, weights: readonly number[]): Paise[] {
  assertPaise(total, "allocation total");
  if (weights.length === 0) return [];
  const w = weights.map((x) => BigInt(Math.max(0, Math.trunc(x))));
  let sum = w.reduce((s, x) => s + x, 0n);
  const units = w.map((x) => (sum === 0n ? 1n : x));
  if (sum === 0n) sum = BigInt(units.length);

  const sign = total < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(total));
  const floors = units.map((x) => (x * abs) / sum);
  const remainders = units.map((x, i) => ({ i, r: (x * abs) % sum }));
  let left = abs - floors.reduce((s, x) => s + x, 0n);
  remainders.sort((p, q) => (p.r === q.r ? p.i - q.i : p.r > q.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    floors[i] += 1n;
    left -= 1n;
  }
  return floors.map((x) => toSafe(x * sign, "allocation"));
}

/** "₹1,234.50" — display only. */
export function formatInr(p: Paise): string {
  const negative = p < 0;
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = rupees.toLocaleString("en-IN");
  return `${negative ? "−" : ""}₹${grouped}.${paise.toString().padStart(2, "0")}`;
}
