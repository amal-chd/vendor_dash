#!/bin/bash
set -e
echo "Deploying razorpayWebhook..."
npx -y firebase-tools deploy --only functions:razorpayWebhook

echo "Deploying processRazorpayWebhook..."
npx -y firebase-tools deploy --only functions:processRazorpayWebhook

echo "Deploying createRazorpayOrder..."
npx -y firebase-tools deploy --only functions:createRazorpayOrder

echo "Deploying createWalletTopupOrder..."
npx -y firebase-tools deploy --only functions:createWalletTopupOrder

echo "All functions deployed successfully!"
