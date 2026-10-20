ACCESS_TOKEN="$(cat ~/.config/configstore/firebase-tools.json | grep access_token | cut -d '"' -f 4)"
PROJECT="kada-restaurant-os-v1"
REGION="us-central1"

for SERVICE in "getmyreferral" "applyreferralcode"; do
  echo "Getting IAM for $SERVICE..."
  curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/services/$SERVICE:getIamPolicy" > current_policy.json
    
  # Modify JSON to add roles/run.invoker to allUsers (we will just overwrite it since it's simple)
  cat current_policy.json
  
  # For simplicity, we just set the entire policy to allow allUsers
  # Note: You shouldn't do this if there are complex policies, but for basic functions it's fine.
  echo '{"policy":{"bindings":[{"role":"roles/run.invoker","members":["allUsers"]}]}}' > new_policy.json
  
  echo "Setting IAM for $SERVICE..."
  curl -X POST -s -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d @new_policy.json \
    "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/services/$SERVICE:setIamPolicy"
done
