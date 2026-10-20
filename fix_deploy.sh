#!/bin/bash
while true; do
  echo "Running firebase deploy..."
  output=$(firebase deploy --only functions --force --non-interactive 2>&1)
  status=$?
  if [ $status -eq 0 ]; then
    echo "Deployment succeeded!"
    break
  fi
  
  # Check if there's the specific error
  func=$(echo "$output" | grep -o "\[.*\] Changing from an HTTPS function to a background triggered function is not allowed" | sed 's/\[\(.*\)\] .*/\1/' | head -n 1)
  
  if [ -n "$func" ]; then
    func_name=$(echo "$func" | cut -d'(' -f1)
    echo "Found corrupted function $func_name, deleting it..."
    gcloud functions delete "$func_name" --region=asia-south1 --gen2 --quiet
    sleep 5
  elif echo "$output" | grep -q "Failed to validate secret versions"; then
    echo "Hit Secret Manager rate limit. Retrying in 10s..."
    sleep 10
  elif echo "$output" | grep -q "cloudbuild.googleapis.com"; then
    echo "Hit Cloud Build rate limit. Retrying in 10s..."
    sleep 10
  elif echo "$output" | grep -q "Quota exceeded"; then
    echo "Hit some other Quota limit. Retrying in 10s..."
    sleep 10
  else
    echo "Failed for another reason!"
    echo "$output"
    break
  fi
done
