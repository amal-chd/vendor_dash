import { useEffect, useState } from "react";
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  limit as fsLimit,
  orderBy,
  where,
  QueryConstraint,
  DocumentData,
  Timestamp,
  WhereFilterOp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

function sortClient<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  dir: "asc" | "desc",
): T[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = toMillis(a[field]);
    const bv = toMillis(b[field]);
    if (av === bv) return 0;
    return av < bv ? -mul : mul;
  });
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "object" && v && "toDate" in v && typeof (v as Timestamp).toDate === "function") {
    try {
      return (v as Timestamp).toDate().getTime();
    } catch {
      return 0;
    }
  }
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}

export type ListenOpts = {
  orderByField?: string;
  orderDir?: "asc" | "desc";
  /** Alias for `orderDir`. */
  orderByDirection?: "asc" | "desc";
  limit?: number;
  wheres?: Array<[string, WhereFilterOp, unknown]>;
  group?: boolean;
};

/**
 * Live listener that degrades: ordered query → unordered + client sort →
 * drop compound where (if needed) so missing indexes never blank a page.
 */
export function listenCollection<T extends { id: string }>(
  path: string,
  opts: ListenOpts,
  onData: (rows: T[]) => void,
  onError?: (err: Error) => void,
): () => void {
  let unsub: (() => void) | undefined;
  let cancelled = false;
  const orderDir = opts.orderDir ?? opts.orderByDirection ?? "desc";
  const cap = opts.limit ?? 500;

  const attach = (mode: "full" | "noOrder" | "bare") => {
    const constraints: QueryConstraint[] = [];
    if (mode !== "bare" && opts.wheres?.length) {
      for (const [f, op, v] of opts.wheres) constraints.push(where(f, op, v));
    }
    if (mode === "full" && opts.orderByField) {
      constraints.push(orderBy(opts.orderByField, orderDir));
    }
    constraints.push(fsLimit(cap));
    const parts = path.split("/").filter(Boolean);
    if (!parts[0]) {
      onError?.(new Error("empty collection path"));
      return () => {};
    }
    const ref = opts.group
      ? collectionGroup(db, path)
      : collection(db, parts[0], ...parts.slice(1));
    const q = query(ref, ...constraints);
    return onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        let next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) })) as T[];
        if (mode !== "full" && opts.orderByField) {
          next = sortClient(next as unknown as Record<string, unknown>[], opts.orderByField, orderDir) as unknown as T[];
        }
        onData(next);
      },
      (err) => {
        if (cancelled) return;
        if (mode === "full") {
          console.warn(`live ${path} full query failed, retry without orderBy`, err.message);
          unsub?.();
          unsub = attach("noOrder");
          return;
        }
        if (mode === "noOrder" && opts.wheres?.length) {
          console.warn(`live ${path} filtered query failed, loading recent docs`, err.message);
          unsub?.();
          unsub = attach("bare");
          return;
        }
        console.error(`live ${path}`, err);
        onError?.(err);
      },
    );
  };

  const start: "full" | "noOrder" = opts.orderByField ? "full" : opts.wheres?.length ? "full" : "noOrder";
  unsub = attach(start);
  return () => {
    cancelled = true;
    unsub?.();
  };
}

export function useLiveCollection<T extends { id: string }>(
  path: string,
  opts?: { orderByField?: string; orderDir?: "asc" | "desc"; limit?: number; disabled?: boolean },
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const orderByField = opts?.orderByField;
  const orderDir = opts?.orderDir ?? "desc";
  const cap = opts?.limit ?? 500;
  const disabled = opts?.disabled;

  useEffect(() => {
    if (disabled) {
      setLoading(false);
      return;
    }
    return listenCollection<T>(
      path,
      { orderByField, orderDir, limit: cap },
      (next) => {
        setRows(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
  }, [path, orderByField, orderDir, cap, disabled]);

  return { rows, loading, error };
}
