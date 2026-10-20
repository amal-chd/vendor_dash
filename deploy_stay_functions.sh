#!/bin/bash
set -e
echo "Deploying checkAvailability..."
npx -y firebase-tools deploy --only functions:checkAvailability

echo "Deploying calculatePricing..."
npx -y firebase-tools deploy --only functions:calculatePricing

echo "Deploying getSimilarStays..."
npx -y firebase-tools deploy --only functions:getSimilarStays

echo "Deploying getPopularStays..."
npx -y firebase-tools deploy --only functions:getPopularStays

echo "Deploying indexHotelGeohash..."
npx -y firebase-tools deploy --only functions:indexHotelGeohash

echo "All Stay functions deployed successfully!"
