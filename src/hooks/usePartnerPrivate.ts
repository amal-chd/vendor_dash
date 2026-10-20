import { useEffect, useState } from "react";
import {
  collection,
  doc,
  limit as fsLimit,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  PARTNER_CONTACT_COLLECTION,
  PARTNER_PRIVATE_COLLECTION,
  partnerDocKey,
  type PartnerContact,
  type PartnerPrivate,
  type PartnerRole,
} from "@/lib/onboarding";

/**
 * Admin readers for the partner private store (functions/src/onboarding/
 * partnerPrivate.ts). Rules: partner_private is finance-grade admins only;
 * partner_contact is any admin. A permission error degrades to "nothing on
 * file" so the page still renders from the public doc's masked fields.
 */
function useKeyedCollection<T>(name: string, role: PartnerRole | undefined, enabled: boolean): Record<string, T> {
  const [rows, setRows] = useState<Record<string, T>>({});

  useEffect(() => {
    if (!enabled) return;
    const constraints: QueryConstraint[] = [];
    if (role) constraints.push(where("role", "==", role));
    constraints.push(fsLimit(5000));
    return onSnapshot(
      query(collection(db, name), ...constraints),
      (snap) => {
        const next: Record<string, T> = {};
        snap.docs.forEach((d) => {
          next[d.id] = d.data() as T;
        });
        setRows(next);
      },
      (err) => {
        console.warn(`[${name}] not readable with this admin role`, err);
        setRows({});
      },
    );
  }, [name, role, enabled]);

  return rows;
}

function useKeyedDoc<T>(name: string, role: PartnerRole, partnerId: string | undefined): T | null {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (!partnerId) {
      setValue(null);
      return;
    }
    return onSnapshot(
      doc(db, name, partnerDocKey(role, partnerId)),
      (snap) => setValue(snap.exists() ? (snap.data() as T) : null),
      (err) => {
        console.warn(`[${name}] not readable with this admin role`, err);
        setValue(null);
      },
    );
  }, [name, role, partnerId]);

  return value;
}

/** Owner contact for every partner (optionally one role), keyed `${role}_${partnerId}`. */
export function usePartnerContacts(role?: PartnerRole, enabled = true) {
  return useKeyedCollection<PartnerContact>(PARTNER_CONTACT_COLLECTION, role, enabled);
}

/** Full bank records, keyed `${role}_${partnerId}`. Finance-grade admins only. */
export function usePartnerPrivates(role?: PartnerRole, enabled = true) {
  return useKeyedCollection<PartnerPrivate>(PARTNER_PRIVATE_COLLECTION, role, enabled);
}

export function usePartnerContact(role: PartnerRole, partnerId: string | undefined) {
  return useKeyedDoc<PartnerContact>(PARTNER_CONTACT_COLLECTION, role, partnerId);
}

export function usePartnerPrivate(role: PartnerRole, partnerId: string | undefined) {
  return useKeyedDoc<PartnerPrivate>(PARTNER_PRIVATE_COLLECTION, role, partnerId);
}
