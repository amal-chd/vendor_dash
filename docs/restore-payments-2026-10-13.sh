#!/bin/bash
# RETIRED 2026-10-13 — do not run.
#
# The swapped Razorpay pair was fixed: RAZORPAY_KEY_ID@6 / RAZORPAY_KEY_SECRET@6
# hold the correct values (verified with Razorpay, HTTP 200). Functions pick
# them up on their next normal deploy from the canonical checkout
# (/Users/amalchand/Documents/The Kada/resturantos), e.g.
#   firebase deploy --only functions:createRazorpayOrder --project kada-restaurant-os-v1
# Direct `gcloud run services update --update-secrets` is rejected for these
# Firebase-managed services, so this script's step 3 can't work anyway.
echo "This script is retired — see the comment at the top." >&2
exit 1
