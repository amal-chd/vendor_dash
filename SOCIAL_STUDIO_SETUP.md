# KadaVerse Social Studio setup

Social Studio is in Admin → Marketing → Social Studio. The app prepares and stores campaign drafts, keeps platform-specific captions, accepts final poster artwork, schedules static image posts and records delivery results per network. The image-generation prompt is copied for use in the image tool of your choice; generated artwork is then uploaded to the post.

## Before deployment

1. Register a Meta developer app and a LinkedIn developer app owned by KadaVerse. Put both in the provider mode required for the real accounts that will publish.
2. Add this exact OAuth redirect URL to both provider apps:

   `https://asia-south1-kada-restaurant-os-v1.cloudfunctions.net/socialOAuthCallback`

3. Set these Firebase Functions secrets in the `kada-restaurant-os-v1` project:

   - `META_APP_ID`
   - `META_APP_SECRET`
   - `LINKEDIN_CLIENT_ID`
   - `LINKEDIN_CLIENT_SECRET`
   - `SOCIAL_TOKEN_ENCRYPTION_KEY`

   Generate the last value as a base64-encoded 32-byte key (for example, `openssl rand -base64 32`) and enter it directly into the Firebase secret prompt. Do not paste it into source files, chat, or the browser. Back it up in the organization's approved secret manager; losing it means stored provider tokens must be reconnected.

4. The Functions runtime service account needs read access to the `kada-restaurant-os-v1.firebasestorage.app` bucket and permission to sign short-lived URLs (`iam.serviceAccounts.signBlob`, usually granted with `roles/iam.serviceAccountTokenCreator` on the runtime service account). These URLs let Instagram and Facebook fetch the image without making the studio's Storage folder public.
5. Deploy the Social Studio Functions, Firestore rules, Storage rules, and Firestore indexes. Functions cannot publish until all five secrets are set.

## Meta (Facebook and Instagram)

- The current implementation uses Facebook Login so one Meta authorization can discover Facebook Pages and their linked Instagram professional accounts.
- Authorize the scopes `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. Meta may require Advanced Access and app review before accounts outside the app's roles can authorize.
- The Facebook Page must grant the authorizing user a publishing role/task. Instagram publishing requires an eligible Business or Creator account; with this connection path, link that professional account to the Facebook Page.
- The studio publishes one static image and its caption to the selected Page or Instagram professional account. Reels, Stories, video, and carousel publishing are not included in this first version.

## LinkedIn

- Request Community Management API access for the LinkedIn developer app, then enable `w_organization_social` for company Page publishing. LinkedIn reviews the organization, business domain, website/privacy policy and app use case. Development access is restricted; Standard access is a separate review for production use.
- Add `openid` and `profile` for the account authorization display, as well as `w_organization_social` for posting. The member authorizing must have a company Page role that can create organic posts (Administrator, Content Admin, or Direct Sponsored Content Poster, subject to LinkedIn's current policy).
- After connecting, enter the LinkedIn Company Page URN in the form `urn:li:organization:123456`. LinkedIn validates the member's actual access when publishing.
- The LinkedIn Marketing API version header is isolated in the publishing module and should be reviewed monthly against LinkedIn's active version and migration notices.

## Using the studio

1. Open Social Studio and connect Meta and/or LinkedIn. Approve the requested provider permissions in the provider's consent screen.
2. In Marketing → Brand Kit, review the KadaVerse and product profiles. Update each profile's audience, voice, claim rules, logo, website, hashtags, font and five brand colours, then save it. The Kada profile also keeps the existing communication-brand record in sync.
3. In Social Studio, use **Download prompt book JSON** for the importable 30-day file, or **Import prompt book JSON** to load a compatible file. The file must use `schemaVersion: 1`, contain 1–100 posts, and give every post a unique ID and day with the required campaign copy and visual prompt. The importer validates the entire file before writing and creates drafts only. Re-imports skip the same prompt-book ID/day pair; use a new book ID when you intentionally want another campaign using those days.
4. Open a brief and choose its Brand profile. The full image prompt reads that profile's palette, typography, positioning, voice, logo, hashtags and claim/offer rules. Refine the copy, then add any approved logo, product screenshot or visual reference to the brief.
5. Generate the finished poster with your preferred image tool. Upload a JPG or PNG no larger than 8 MB, select the connected target account(s), and edit each platform caption.
6. Save a draft, schedule it in your local time zone, or publish it now. Scheduled posts are picked up once per minute. Check each platform's result before retrying any delivery marked unclear; a manual retry can otherwise create a duplicate if a provider accepted the first request but its response was lost.

The editable profile defaults are starting values. Confirm product features, service availability, brand assets, URLs and campaign-specific offer terms before publishing. Never treat a generated prompt as proof of a marketing claim.

## Current supported scope

- Image posts only: JPG or PNG, under 8 MB.
- One destination per network per post, with independent caption text and delivery status for Instagram, Facebook and LinkedIn.
- Instagram and Facebook are connected together through Meta; LinkedIn is connected separately.
- No provider analytics, comment moderation, reels, stories, video, carousels, ads or automatic image generation in this first version.
- The platform APIs and provider access tiers can change. Review Meta's Instagram publishing requirements and LinkedIn's Community Management access and version notices before promoting this workflow beyond the connected organization.
