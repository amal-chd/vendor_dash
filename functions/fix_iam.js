const { GoogleAuth } = require('google-auth-library');
async function fixIam() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const projectId = 'kada-restaurant-os-v1';
  const region = 'us-central1';
  for (const service of ['getmyreferral', 'applyreferralcode']) {
    const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${service}:getIamPolicy`;
    let res = await client.request({ url, method: 'GET' });
    let policy = res.data;
    let found = false;
    if (!policy.bindings) policy.bindings = [];
    for (const b of policy.bindings) {
      if (b.role === 'roles/run.invoker') {
        if (!b.members.includes('allUsers')) {
          b.members.push('allUsers');
        }
        found = true;
        break;
      }
    }
    if (!found) {
      policy.bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] });
    }
    const setUrl = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${service}:setIamPolicy`;
    res = await client.request({ url: setUrl, method: 'POST', data: { policy } });
    console.log(`Updated IAM for ${service}`);
  }
}
fixIam().catch(console.error);
