import { addDoc, collection, doc, serverTimestamp, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { writeAudit } from '@/lib/audit';
import { Role } from '@/lib/rbac';

export interface ApprovalInput {
  action: string;
  entity: string;
  entityId: string;
  description: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalConfig {
  required: boolean;
  minRole: Role;
  label: string;
}

export interface ApprovalRecord {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  description: string;
  requesterUid: string;
  requesterEmail: string;
  approverUid?: string;
  approverEmail?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  reason?: string;
  approverComment?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  createdAt: any;
  resolvedAt?: any;
}

// Configurable thresholds
const REFUND_THRESHOLD = 5000;
const PAYOUT_ADJUSTMENT_THRESHOLD = 10000;
const CREDIT_ISSUANCE_THRESHOLD = 2000;

export function getApprovalConfig(action: string): ApprovalConfig {
  switch (action) {
    case 'refund':
      return { required: true, minRole: 'finance_manager', label: 'High Value Refund' };
    case 'commission_change':
      return { required: true, minRole: 'platform_admin', label: 'Commission Change' };
    case 'vendor_suspension':
      return { required: true, minRole: 'vendor_manager', label: 'Vendor Suspension' };
    case 'payout_adjustment':
      return { required: true, minRole: 'finance_manager', label: 'Large Payout Adjustment' };
    case 'credit_issuance':
      return { required: true, minRole: 'finance_manager', label: 'Credit Issuance' };
    case 'kyc_rejection':
      return { required: true, minRole: 'ops_manager', label: 'KYC Rejection' };
    case 'rider_suspension':
      return { required: true, minRole: 'delivery_manager', label: 'Rider Suspension' };
    default:
      return { required: false, minRole: 'super_admin', label: 'Default Approval' };
  }
}

export function needsApproval(action: string, context?: Record<string, unknown>): boolean {
  if (action === 'refund' && typeof context?.amount === 'number') {
    return context.amount > REFUND_THRESHOLD;
  }
  if (action === 'payout_adjustment' && typeof context?.amount === 'number') {
    return context.amount > PAYOUT_ADJUSTMENT_THRESHOLD;
  }
  if (action === 'credit_issuance' && typeof context?.amount === 'number') {
    return context.amount > CREDIT_ISSUANCE_THRESHOLD;
  }
  
  const config = getApprovalConfig(action);
  return config.required;
}

export async function requestApproval(input: ApprovalInput): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be authenticated to request approval');

  const record: Omit<ApprovalRecord, 'id'> = {
    ...input,
    requesterUid: user.uid,
    requesterEmail: user.email || 'unknown@example.com',
    status: 'pending',
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, 'approval_requests'), record);
  
  await writeAudit({
    action: 'approval_requested',
    entity: input.entity,
    entityId: input.entityId,
    details: `Approval requested for ${input.action}: ${input.description}`,
    metadata: { requestId: docRef.id, ...input.metadata },
  });

  return docRef.id;
}

export async function approveRequest(requestId: string, approverComment?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be authenticated to approve');

  const docRef = doc(db, 'approval_requests', requestId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Approval request not found');

  const data = snap.data() as ApprovalRecord;

  await updateDoc(docRef, {
    status: 'approved',
    approverUid: user.uid,
    approverEmail: user.email || 'unknown@example.com',
    approverComment: approverComment || null,
    resolvedAt: serverTimestamp(),
  });

  await writeAudit({
    action: 'approval_granted',
    entity: data.entity,
    entityId: data.entityId,
    details: `Approval granted for ${data.action} by ${user.email}`,
    metadata: { requestId, approverComment },
  });
}

export async function rejectRequest(requestId: string, reason: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be authenticated to reject');

  const docRef = doc(db, 'approval_requests', requestId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Approval request not found');

  const data = snap.data() as ApprovalRecord;

  await updateDoc(docRef, {
    status: 'rejected',
    approverUid: user.uid,
    approverEmail: user.email || 'unknown@example.com',
    approverComment: reason,
    resolvedAt: serverTimestamp(),
  });

  await writeAudit({
    action: 'approval_rejected',
    entity: data.entity,
    entityId: data.entityId,
    details: `Approval rejected for ${data.action} by ${user.email}`,
    metadata: { requestId, reason },
  });
}
