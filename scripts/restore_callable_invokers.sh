#!/usr/bin/env bash
#
# Restore the `allUsers` Cloud Run invoker binding on Kada's callable and HTTPS
# functions, in asia-south1.
#
# WHY THIS IS NEEDED
# The 2026-10-03 region move left 104 of 152 callable/HTTPS functions with an
# EMPTY IAM policy. Google's front end then rejects every request with a bare
# 403 before it reaches the container, so the function's own auth never runs and
# nothing appears in its logs. Verified by reading each service's IAM policy:
# `advanceDeliveryStage` and `reassignDelivery` have no bindings at all, while
# `searchStays` still has `allUsers`.
#
# WHY IT IS NOT A SECURITY LOOSENING
# This is exactly what `firebase deploy` sets on a callable. A Firebase client
# calls with a Firebase ID token, which is NOT a Google IAM identity, so the
# invoker check can only be satisfied by `allUsers`; the real authorisation
# happens inside the function (`request.auth`, `assertAdmin`, `resolveVendorActor`).
# Without the binding, legitimate signed-in users are refused along with
# everyone else.
#
# SCOPE — deliberately only callables and HTTPS endpoints. Scheduled functions
# and Firestore triggers are invoked by Cloud Scheduler / Eventarc with
# service-account identities and MUST stay private; none are in the list.
#
# Usage:
#   bash scripts/restore_callable_invokers.sh             # apply
#   bash scripts/restore_callable_invokers.sh --dry-run   # list only
#
set -uo pipefail

PROJECT="${KADA_PROJECT:-kada-restaurant-os-v1}"
REGION="${KADA_REGION:-asia-south1}"
LIST="$(dirname "$0")/../docs/outage-2026-10-03-missing-invoker.txt"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -f "$LIST" ] || { echo "missing $LIST" >&2; exit 1; }
total=$(grep -c . "$LIST")
echo "Services to patch: $total  (project=$PROJECT region=$REGION)"
[ "$DRY" = "1" ] && { cat "$LIST"; exit 0; }

ok=0; fail=0
while read -r svc; do
  [ -z "$svc" ] && continue
  if gcloud run services add-iam-policy-binding "$svc" \
       --region="$REGION" --project="$PROJECT" \
       --member=allUsers --role=roles/run.invoker >/dev/null 2>&1; then
    ok=$((ok+1)); printf "."
  else
    fail=$((fail+1)); printf "\n  FAILED: %s\n" "$svc"
  fi
done < "$LIST"
echo
echo "bound: $ok   failed: $fail"

echo
echo "Verifying..."
missing=0
while read -r svc; do
  [ -z "$svc" ] && continue
  if ! gcloud run services get-iam-policy "$svc" --region="$REGION" --project="$PROJECT" \
        --format="value(bindings)" 2>/dev/null | grep -q allUsers; then
    echo "  STILL MISSING: $svc"; missing=$((missing+1))
  fi
done < "$LIST"
[ "$missing" = "0" ] && echo "All $total services now have the invoker binding." \
  || echo "$missing service(s) still missing — rerun or check IAM permissions."
