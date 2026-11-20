import * as admin from "firebase-admin";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { assertAdmin } from "./adminAuthz";

const META_APP_ID = defineSecret("META_APP_ID");
const META_APP_SECRET = defineSecret("META_APP_SECRET");
const LINKEDIN_CLIENT_ID = defineSecret("LINKEDIN_CLIENT_ID");
const LINKEDIN_CLIENT_SECRET = defineSecret("LINKEDIN_CLIENT_SECRET");
const SOCIAL_TOKEN_ENCRYPTION_KEY = defineSecret("SOCIAL_TOKEN_ENCRYPTION_KEY");

const COLLECTION_POSTS = "marketing_social_posts";
const COLLECTION_CONNECTIONS = "marketing_social_connections";
const COLLECTION_TOKENS = "marketing_social_tokens";
const COLLECTION_OAUTH_STATES = "marketing_social_oauth_states";
const OAUTH_CALLBACK_URL = "https://asia-south1-kada-restaurant-os-v1.cloudfunctions.net/socialOAuthCallback";
const META_GRAPH_VERSION = "v27.0";
const LINKEDIN_API_VERSION = "202611";
const SOCIAL_ROLE_ALLOWLIST = ["super_admin", "platform_admin", "marketing_manager"];
const SOCIAL_PLATFORMS = ["instagram", "facebook", "linkedin"] as const;
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
type ProviderName = "meta" | "linkedin";
type DestinationMap = Partial<Record<SocialPlatform, string>>;
type ApiObject = Record<string, any>;

const firestore = () => admin.firestore();

function requireMarketingAdmin(request: CallableRequest): { uid: string; email: string; role: string } {
  assertAdmin(request);
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const email = String(token.email ?? "").toLowerCase();
  const role = String(token.adminRole ?? "super_admin");
  if (!SOCIAL_ROLE_ALLOWLIST.includes(role) && token.platformAdmin !== true && !["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email)) {
    throw new HttpsError("permission-denied", "Marketing manager access is required for Social Studio.");
  }
  return { uid: request.auth!.uid, email, role };
}

function isAuthorizedAdminUser(user: admin.auth.UserRecord) {
  const claims = user.customClaims ?? {};
  const email = (user.email ?? "").toLowerCase();
  return (user.emailVerified && ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email))
    || claims.platformAdmin === true
    || SOCIAL_ROLE_ALLOWLIST.includes(String(claims.adminRole ?? ""));
}

function encryptionKey(): Buffer {
  const raw = SOCIAL_TOKEN_ENCRYPTION_KEY.value().trim();
  const decoded = Buffer.from(raw, "base64");
  const key = decoded.length === 32 ? decoded : Buffer.from(raw, "utf8");
  if (key.length !== 32) throw new Error("SOCIAL_TOKEN_ENCRYPTION_KEY must be 32 bytes, or a base64-encoded 32-byte key.");
  return key;
}

function encrypt(value: ApiObject) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}

function decrypt(value: ApiObject): ApiObject {
  if (value.version !== 1 || !value.iv || !value.tag || !value.data) throw new Error("Stored social connection is not a supported encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(String(value.iv), "base64"));
  decipher.setAuthTag(Buffer.from(String(value.tag), "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(String(value.data), "base64")), decipher.final(),
  ]).toString("utf8")) as ApiObject;
}

function cleanProviderMessage(value: unknown) {
  const text = typeof value === "string" ? value : "The social network returned an error.";
  return text.replace(/access[_ -]?token[^\s]*/gi, "credential").slice(0, 240);
}

class ProviderRequestError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly providerStatus?: number) { super(message); }
}

async function providerJson(url: string, init: RequestInit, postingMayHaveSucceeded = false): Promise<ApiObject> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) {
    throw new ProviderRequestError(`Could not reach the social network: ${cleanProviderMessage((error as Error).message)}`, postingMayHaveSucceeded);
  }
  const raw = await response.text();
  let parsed: ApiObject = {};
  try { parsed = raw ? JSON.parse(raw) as ApiObject : {}; }
  catch { parsed = { message: raw.slice(0, 200) }; }
  if (!response.ok) {
    const message = parsed.error?.error_user_msg || parsed.error?.message || parsed.message || `Social network returned HTTP ${response.status}.`;
    throw new ProviderRequestError(cleanProviderMessage(String(message)), postingMayHaveSucceeded && response.status >= 500, response.status);
  }
  parsed._restliId = response.headers.get("x-restli-id") ?? parsed._restliId;
  return parsed;
}

function callbackPage(message: string, ok: boolean) {
  const escaped = message.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>KadaVerse Social Studio</title></head><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#0b1b33"><h1>${ok ? "Account connected" : "Connection could not be completed"}</h1><p>${escaped}</p><p>You can close this tab and return to Social Studio.</p></body></html>`;
}

export const socialStartOAuth = onCall(
  { secrets: [META_APP_ID, LINKEDIN_CLIENT_ID], maxInstances: 1 },
  async (request) => {
    const caller = requireMarketingAdmin(request);
    const provider = String(request.data?.provider ?? "") as ProviderName;
    if (provider !== "meta" && provider !== "linkedin") throw new HttpsError("invalid-argument", "Choose Meta or LinkedIn.");
    const state = randomBytes(32).toString("hex");
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60_000);
    await firestore().collection(COLLECTION_OAUTH_STATES).doc(state).create({
      provider, uid: caller.uid, email: caller.email, createdAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt, consumed: false,
    });
    const params = new URLSearchParams({ response_type: "code", redirect_uri: OAUTH_CALLBACK_URL, state });
    let authorizationUrl: string;
    if (provider === "meta") {
      params.set("client_id", META_APP_ID.value());
      params.set("scope", ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"].join(","));
      params.set("auth_type", "rerequest");
      authorizationUrl = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
    } else {
      params.set("client_id", LINKEDIN_CLIENT_ID.value());
      params.set("scope", "openid profile w_organization_social");
      authorizationUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    }
    return { authorizationUrl };
  },
);

export const socialOAuthCallback = onRequest(
  { secrets: [META_APP_ID, META_APP_SECRET, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, SOCIAL_TOKEN_ENCRYPTION_KEY], maxInstances: 1 },
  async (request, response) => {
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    response.set("X-Content-Type-Options", "nosniff");
    if (request.method !== "GET") { response.status(405).send(callbackPage("Use the account connection button in Social Studio.", false)); return; }
    const state = String(request.query.state ?? "");
    const code = String(request.query.code ?? "");
    if (!/^[a-f0-9]{64}$/.test(state) || !code || request.query.error) {
      response.status(400).send(callbackPage("Authorization was cancelled or missing the required response. Return to the studio and try again.", false)); return;
    }
    try {
      const stateRef = firestore().collection(COLLECTION_OAUTH_STATES).doc(state);
      const stateData = await firestore().runTransaction(async (transaction) => {
        const snap = await transaction.get(stateRef);
        const value = snap.data();
        if (!value || value.consumed || !(value.expiresAt instanceof admin.firestore.Timestamp) || value.expiresAt.toMillis() <= Date.now()) {
          throw new Error("This connection request expired. Return to Social Studio and start again.");
        }
        transaction.update(stateRef, { consumed: true, consumedAt: admin.firestore.FieldValue.serverTimestamp() });
        return value as ApiObject;
      });
      const user = await admin.auth().getUser(String(stateData.uid));
      if (!isAuthorizedAdminUser(user)) throw new Error("The administrator permission changed during authorization. Sign in again and reconnect.");
      if (stateData.provider === "meta") await finishMetaAuthorization(code);
      else if (stateData.provider === "linkedin") await finishLinkedInAuthorization(code);
      else throw new Error("The requested provider is not supported.");
      response.status(200).type("html").send(callbackPage("The account was connected to KadaVerse Social Studio. Refresh account status when you return.", true));
    } catch (error) {
      logger.warn("Social Studio OAuth callback failed", { message: cleanProviderMessage((error as Error).message) });
      response.status(400).type("html").send(callbackPage(cleanProviderMessage((error as Error).message), false));
    }
  },
);

async function finishMetaAuthorization(code: string) {
  const shortParams = new URLSearchParams({
    client_id: META_APP_ID.value(), client_secret: META_APP_SECRET.value(), redirect_uri: OAUTH_CALLBACK_URL, code,
  });
  const shortToken = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${shortParams}`, { method: "GET" });
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token", client_id: META_APP_ID.value(), client_secret: META_APP_SECRET.value(),
    fb_exchange_token: String(shortToken.access_token),
  });
  const longToken = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${longParams}`, { method: "GET" });
  const userToken = String(longToken.access_token ?? shortToken.access_token ?? "");
  if (!userToken) throw new Error("Meta did not return an account token.");
  const pagesParams = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}", access_token: userToken,
  });
  const pages = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts?${pagesParams}`, { method: "GET" });
  const pageTokens: Record<string, string> = {};
  const facebook: { id: string; label: string }[] = [];
  const instagram: { id: string; label: string; pageId: string }[] = [];
  for (const page of (pages.data ?? []) as ApiObject[]) {
    if (!page.id || !page.access_token) continue;
    const pageId = String(page.id);
    pageTokens[pageId] = String(page.access_token);
    facebook.push({ id: pageId, label: String(page.name ?? "Facebook Page") });
    const ig = page.instagram_business_account;
    if (ig?.id) instagram.push({ id: String(ig.id), label: ig.username ? `@${ig.username}` : String(page.name ?? "Instagram professional account"), pageId });
  }
  const tokenExpiresAt = Number(longToken.expires_in) > 0
    ? admin.firestore.Timestamp.fromMillis(Date.now() + Number(longToken.expires_in) * 1000)
    : null;
  await firestore().collection(COLLECTION_TOKENS).doc("meta").set({
    encrypted: encrypt({ userToken, pageTokens }), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await firestore().collection(COLLECTION_CONNECTIONS).doc("meta").set({
    connected: true, provider: "meta", facebook, instagram, connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    tokenExpiresAt, lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function finishLinkedInAuthorization(code: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code", code, client_id: LINKEDIN_CLIENT_ID.value(),
    client_secret: LINKEDIN_CLIENT_SECRET.value(), redirect_uri: OAUTH_CALLBACK_URL,
  });
  const token = await providerJson("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  const accessToken = String(token.access_token ?? "");
  if (!accessToken) throw new Error("LinkedIn did not return an account token.");
  let memberName = "LinkedIn member";
  try {
    const profile = await providerJson("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
    memberName = [profile.given_name, profile.family_name].filter(Boolean).join(" ") || memberName;
  } catch { /* The profile label is optional; posting access is the useful permission. */ }
  await firestore().collection(COLLECTION_TOKENS).doc("linkedin").set({
    encrypted: encrypt({ accessToken, expiresAt: Date.now() + Number(token.expires_in ?? 0) * 1000 }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await firestore().collection(COLLECTION_CONNECTIONS).doc("linkedin").set({
    connected: true, provider: "linkedin", memberName,
    tokenExpiresAt: Number(token.expires_in) > 0 ? admin.firestore.Timestamp.fromMillis(Date.now() + Number(token.expires_in) * 1000) : null,
    connectedAt: admin.firestore.FieldValue.serverTimestamp(), lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

export const socialSetLinkedInOrganization = onCall(
  { maxInstances: 1 },
  async (request) => {
    requireMarketingAdmin(request);
    const organizationUrn = String(request.data?.organizationUrn ?? "").trim();
    if (!/^urn:li:organization:\d+$/.test(organizationUrn)) throw new HttpsError("invalid-argument", "Enter a LinkedIn Company Page URN in the form urn:li:organization:123456.");
    const connection = firestore().collection(COLLECTION_CONNECTIONS).doc("linkedin");
    const snap = await connection.get();
    if (!snap.exists || snap.data()?.connected !== true) throw new HttpsError("failed-precondition", "Connect LinkedIn before choosing its Company Page.");
    await connection.set({ organizationUrn, organizationName: organizationUrn.split(":").pop(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true };
  },
);

export const socialDisconnect = onCall(
  { maxInstances: 1 },
  async (request) => {
    requireMarketingAdmin(request);
    const provider = String(request.data?.provider ?? "") as ProviderName;
    if (provider !== "meta" && provider !== "linkedin") throw new HttpsError("invalid-argument", "Choose Meta or LinkedIn.");
    await Promise.all([
      firestore().collection(COLLECTION_TOKENS).doc(provider).delete(),
      firestore().collection(COLLECTION_CONNECTIONS).doc(provider).delete(),
    ]);
    return { ok: true };
  },
);

export const socialPublishNow = onCall(
  { secrets: [SOCIAL_TOKEN_ENCRYPTION_KEY], timeoutSeconds: 300, maxInstances: 1 },
  async (request) => {
    requireMarketingAdmin(request);
    const postId = String(request.data?.postId ?? "").trim();
    if (!postId || postId.length > 128) throw new HttpsError("invalid-argument", "Choose a social post first.");
    return publishSocialPost(postId, {
      manual: true,
      confirmAmbiguousRetry: request.data?.confirmAmbiguousRetry === true,
    });
  },
);

export const publishDueSocialPosts = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Asia/Kolkata", secrets: [SOCIAL_TOKEN_ENCRYPTION_KEY], maxInstances: 1 },
  async () => {
    const due = await firestore().collection(COLLECTION_POSTS)
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", admin.firestore.Timestamp.now())
      .orderBy("scheduledAt", "asc")
      .limit(10).get();
    for (const post of due.docs) {
      try { await publishSocialPost(post.id, { manual: false, confirmAmbiguousRetry: false }); }
      catch (error) { logger.error("Scheduled social post failed to start", { postId: post.id, message: cleanProviderMessage((error as Error).message) }); }
    }
  },
);

async function publishSocialPost(postId: string, options: { manual: boolean; confirmAmbiguousRetry: boolean }) {
  const postRef = firestore().collection(COLLECTION_POSTS).doc(postId);
  let postData: ApiObject | undefined;
  let ambiguousReviewRequired = false;
  await firestore().runTransaction(async (transaction) => {
    const snap = await transaction.get(postRef);
    if (!snap.exists) throw new HttpsError("not-found", "That social post no longer exists.");
    const data = snap.data() as ApiObject;
    if (data.status === "published") throw new HttpsError("failed-precondition", "This post is already published to every selected network.");
    if (!options.manual && (data.status !== "scheduled" || !(data.scheduledAt instanceof admin.firestore.Timestamp) || data.scheduledAt.toMillis() > Date.now())) {
      throw new HttpsError("failed-precondition", "The post is not due for publishing.");
    }
    if (options.manual && data.status === "publishing" && !options.confirmAmbiguousRetry) {
      throw new HttpsError("failed-precondition", "A previous publishing attempt may still be running. Check its status first.");
    }
    if (options.manual && !["draft", "scheduled", "failed", "partial", "publishing"].includes(String(data.status))) {
      throw new HttpsError("failed-precondition", `A post in ${String(data.status)} status cannot be published.`);
    }
    const destinations = (data.destinations ?? {}) as DestinationMap;
    const selected = SOCIAL_PLATFORMS.filter((platform) => typeof destinations[platform] === "string" && destinations[platform]);
    if (!selected.length) throw new HttpsError("failed-precondition", "Choose at least one connected account before publishing.");
    if (!data.assetPath || !String(data.assetPath).startsWith("social_assets/")) throw new HttpsError("failed-precondition", "Upload poster artwork before publishing.");
    const results = { ...(data.platformResults ?? {}) } as Record<string, ApiObject>;
    const ambiguous = selected.filter((platform) => ["unknown", "publishing"].includes(String(results[platform]?.status))
      && (!results[platform]?.accountId || results[platform]?.accountId === destinations[platform]));
    if (ambiguous.length && !options.confirmAmbiguousRetry && !options.manual) {
      ambiguousReviewRequired = true;
      transaction.update(postRef, {
        status: "partial",
        error: `Check ${ambiguous.join(", ")} on the social network before retrying; the previous result is unclear.`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      postData = { id: snap.id, ...data, platformResults: results };
      return;
    }
    if (ambiguous.length && !options.confirmAmbiguousRetry) throw new HttpsError("failed-precondition", `Check ${ambiguous.join(", ")} on the social network before retrying; the previous result is unclear.`);
    for (const platform of ambiguous) results[platform] = { status: "queued", message: "Manually retried after checking the social account." };
    transaction.update(postRef, {
      status: "publishing", error: "", platformResults: results,
      publishStartedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    postData = { id: snap.id, ...data, platformResults: results };
  });
  if (!postData) throw new HttpsError("internal", "Could not load the post for publishing.");
  if (ambiguousReviewRequired) return { ok: false, status: "partial", results: postData.platformResults };
  const currentResults = { ...(postData.platformResults ?? {}) } as Record<string, ApiObject>;
  const destinations = (postData.destinations ?? {}) as DestinationMap;
  const selected = SOCIAL_PLATFORMS.filter((platform) => typeof destinations[platform] === "string" && destinations[platform]);
  const pending = selected.filter((platform) => currentResults[platform]?.status !== "published"
    || currentResults[platform]?.accountId !== destinations[platform]);
  let signedImageUrl = "";
  try { signedImageUrl = await getSignedPosterUrl(String(postData.assetPath)); }
  catch (error) {
    const message = cleanProviderMessage((error as Error).message);
    await postRef.update({ status: "failed", error: message, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    throw error;
  }
  const captions = (postData.captions ?? {}) as Record<string, string>;
  for (const platform of pending) {
    const caption = String(captions[platform] ?? postData.caption ?? "").trim();
    if (!caption) {
      currentResults[platform] = { status: "failed", accountId: destinations[platform], message: "Add a caption before publishing." };
      await postRef.update({ [`platformResults.${platform}`]: currentResults[platform], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      continue;
    }
    currentResults[platform] = { status: "publishing", accountId: destinations[platform], startedAt: admin.firestore.FieldValue.serverTimestamp() };
    await postRef.update({ [`platformResults.${platform}`]: currentResults[platform], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    try {
      const published = await publishToPlatform(platform, String(destinations[platform]), postData, caption, signedImageUrl);
      currentResults[platform] = { status: "published", accountId: destinations[platform], message: "Published", postId: published.postId, publishedAt: admin.firestore.FieldValue.serverTimestamp() };
    } catch (error) {
      const uncertain = error instanceof ProviderRequestError && error.uncertain;
      currentResults[platform] = {
        status: uncertain ? "unknown" : "failed",
        accountId: destinations[platform],
        message: uncertain ? "The request may have reached the network. Check the account before retrying." : cleanProviderMessage((error as Error).message),
      };
      logger.warn("Social provider publishing call failed", { postId, platform, status: error instanceof ProviderRequestError ? error.providerStatus : undefined, message: currentResults[platform].message });
    }
    await postRef.update({ [`platformResults.${platform}`]: currentResults[platform], updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  const succeeded = selected.filter((platform) => currentResults[platform]?.status === "published"
    && currentResults[platform]?.accountId === destinations[platform]).length;
  const unknown = selected.some((platform) => ["unknown", "publishing"].includes(String(currentResults[platform]?.status)));
  const finalStatus = unknown ? "partial" : succeeded === selected.length ? "published" : succeeded > 0 ? "partial" : "failed";
  const messages = selected.filter((platform) => currentResults[platform]?.status !== "published")
    .map((platform) => `${platformNames[platform]}: ${String(currentResults[platform]?.message ?? "Not published")}`);
  await postRef.update({
    status: finalStatus, error: messages.join(" ").slice(0, 1000), publishedAt: succeeded ? admin.firestore.FieldValue.serverTimestamp() : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: succeeded > 0, status: finalStatus, results: currentResults };
}

const platformNames: Record<SocialPlatform, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

async function getSignedPosterUrl(assetPath: string) {
  if (!/^social_assets\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/poster_\d+\.(png|jpg)$/.test(assetPath)) {
    throw new HttpsError("invalid-argument", "Poster asset path is invalid.");
  }
  const file = admin.storage().bucket("kada-restaurant-os-v1.firebasestorage.app").file(assetPath);
  const [metadata] = await file.getMetadata();
  const mime = String(metadata.contentType ?? "");
  const size = Number(metadata.size ?? 0);
  if (!/^image\/(jpeg|png)$/.test(mime) || size <= 0 || size > 8 * 1024 * 1024) {
    throw new HttpsError("failed-precondition", "Poster must be a JPG or PNG smaller than 8 MB.");
  }
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 45 * 60_000 });
  return url;
}

async function readEncryptedToken(provider: ProviderName) {
  const snapshot = await firestore().collection(COLLECTION_TOKENS).doc(provider).get();
  if (!snapshot.exists) throw new HttpsError("failed-precondition", `Connect ${provider === "meta" ? "Meta" : "LinkedIn"} before publishing.`);
  return decrypt(snapshot.data()?.encrypted as ApiObject);
}

async function publishToPlatform(platform: SocialPlatform, targetId: string, post: ApiObject, caption: string, imageUrl: string) {
  if (platform === "facebook") return publishFacebookPage(targetId, post, caption, imageUrl);
  if (platform === "instagram") return publishInstagram(targetId, post, caption, imageUrl);
  return publishLinkedIn(targetId, post, caption);
}

async function publishFacebookPage(pageId: string, post: ApiObject, caption: string, imageUrl: string) {
  const connection = await firestore().collection(COLLECTION_CONNECTIONS).doc("meta").get();
  const accounts = (connection.data()?.facebook ?? []) as { id: string }[];
  if (!accounts.some((account) => String(account.id) === pageId)) throw new HttpsError("failed-precondition", "This Facebook Page is no longer connected. Reconnect Meta.");
  const tokens = await readEncryptedToken("meta");
  const pageToken = String(tokens.pageTokens?.[pageId] ?? "");
  if (!pageToken) throw new HttpsError("failed-precondition", "Facebook Page access is missing. Reconnect Meta.");
  const params = new URLSearchParams({ url: imageUrl, message: caption, published: "true", access_token: pageToken });
  const result = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}/photos`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  }, true);
  return { postId: String(result.post_id ?? result.id ?? "") };
}

async function publishInstagram(igUserId: string, post: ApiObject, caption: string, imageUrl: string) {
  const connection = await firestore().collection(COLLECTION_CONNECTIONS).doc("meta").get();
  const accounts = (connection.data()?.instagram ?? []) as { id: string }[];
  if (!accounts.some((account) => String(account.id) === igUserId)) throw new HttpsError("failed-precondition", "This Instagram professional account is no longer connected. Reconnect Meta.");
  const tokens = await readEncryptedToken("meta");
  const [account] = accounts.filter((item: any) => String(item.id) === igUserId) as any[];
  const pageToken = String(tokens.pageTokens?.[String(account?.pageId)] ?? "");
  if (!pageToken) throw new HttpsError("failed-precondition", "The linked Facebook Page token is missing. Reconnect Meta.");
  const createParams = new URLSearchParams({ image_url: imageUrl, caption, access_token: pageToken });
  const container = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: createParams.toString(),
  }, true);
  if (!container.id) throw new ProviderRequestError("Instagram did not return a media container ID.", true);
  const publishParams = new URLSearchParams({ creation_id: String(container.id), access_token: pageToken });
  const published = await providerJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: publishParams.toString(),
  }, true);
  return { postId: String(published.id ?? "") };
}

async function publishLinkedIn(organizationUrn: string, post: ApiObject, caption: string) {
  const connection = await firestore().collection(COLLECTION_CONNECTIONS).doc("linkedin").get();
  if (connection.data()?.organizationUrn !== organizationUrn) throw new HttpsError("failed-precondition", "This LinkedIn company page is not the connected target.");
  const tokenData = await readEncryptedToken("linkedin");
  const accessToken = String(tokenData.accessToken ?? "");
  if (Number(tokenData.expiresAt ?? 0) && Number(tokenData.expiresAt) <= Date.now()) throw new HttpsError("failed-precondition", "The LinkedIn access token expired. Reconnect LinkedIn.");
  const assetPath = String(post.assetPath);
  const file = admin.storage().bucket("kada-restaurant-os-v1.firebasestorage.app").file(assetPath);
  const [bytes] = await file.download();
  const [metadata] = await file.getMetadata();
  const mime = String(metadata.contentType ?? "image/jpeg");
  const initialized = await providerJson("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: linkedinHeaders(accessToken, true),
    body: JSON.stringify({ initializeUploadRequest: { owner: organizationUrn } }),
  });
  const uploadUrl = initialized.value?.uploadUrl;
  const imageUrn = initialized.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("LinkedIn did not return its image upload details.");
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(String(uploadUrl), { method: "PUT", headers: { "Content-Type": mime }, body: bytes });
  } catch (error) {
    throw new ProviderRequestError(`LinkedIn image upload failed: ${cleanProviderMessage((error as Error).message)}`, false);
  }
  if (!uploadResponse.ok) throw new Error(`LinkedIn image upload failed with HTTP ${uploadResponse.status}.`);
  const payload = {
    author: organizationUrn,
    commentary: caption,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title: String(post.headline ?? post.title ?? "KadaVerse post").slice(0, 200), id: String(imageUrn) } },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const published = await providerJson("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: linkedinHeaders(accessToken, true), body: JSON.stringify(payload),
  }, true);
  return { postId: String(published.id ?? published._restliId ?? "") };
}

function linkedinHeaders(accessToken: string, json: boolean) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Linkedin-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}
