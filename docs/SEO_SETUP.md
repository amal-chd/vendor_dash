# SEO Operations Checklist — Kada Dine

This is the manual setup work that has to be done **outside the codebase**
to make the SEO infrastructure we've built actually produce results in
Google search. Everything in code (sitemap, robots.txt, JSON-LD schemas,
meta tags, breadcrumbs) is already shipped — these are the human-side
tasks that need to happen once and then maintained.

Treat this as a launch checklist. Work top to bottom.

---

## 1. Google Search Console (highest priority)

Without GSC, Google can crawl your site but you have no visibility into
what's being indexed, what's broken, or what queries you're ranking for.

### One-time setup

1. Open <https://search.google.com/search-console>.
2. Click **Add property** → **URL prefix** → enter
   `https://kadadine.thekada.in`.
3. Verify ownership. Two recommended methods (pick one):
   - **HTML file upload**: GSC gives you a file like `google1234abcd.html`.
     Drop it into `public/` in this repo, push to main, wait for Vercel
     to deploy, then click Verify.
   - **DNS TXT record**: paste the `google-site-verification=…` TXT
     record into your DNS provider (Cloudflare / GoDaddy / wherever
     `thekada.in` is managed).
4. Once verified, go to **Sitemaps** in the left nav and submit:
   ```
   https://kadadine.thekada.in/sitemap.xml
   ```
5. Submit again for the apex domain (if you serve it):
   `https://thekada.in/sitemap.xml`

### Ongoing (weekly, ~5 min)

- **Coverage report** → check for new "Excluded" pages with reasons like
  "Crawled but not indexed" or "Soft 404". Fix any flagged URLs.
- **Performance report** → which queries are bringing traffic? Which have
  high impressions but low CTR? Those are titles/descriptions to rewrite.
- **Enhancements** → confirm BreadcrumbList, SoftwareApplication,
  FAQPage, Organization schemas are showing as valid (we ship all four).

### Apply for the Knowledge Panel

Once you have ≥50 backlinks, ≥1,000 monthly organic clicks, and active
social profiles (see section 4), apply for the Knowledge Panel via the
**About** dropdown on a logged-in branded search for "Kada Dine".

---

## 2. Bing Webmaster Tools

Bing has ~3% of Indian search but disproportionately powers ChatGPT,
Copilot, and DuckDuckGo. Ten minutes of setup, evergreen value.

1. Open <https://www.bing.com/webmasters>.
2. Sign in → **Import from Google Search Console** (Bing offers this
   so you don't have to repeat the work).
3. Confirm sitemap is auto-detected.

---

## 3. Google Business Profile (local SEO)

This is what makes you appear in the **3-pack** (the map results)
when someone searches "restaurant POS software in Bangalore" etc.

1. Open <https://business.google.com> with the Kada Dine email.
2. Search for "Kada Dine" — if not found, click **Add your business**.
3. Fill out:
   - Category: **Software company** (primary), **Computer software
     store** (secondary)
   - Address: the registered business address (Kada Software
     Technologies — your registered office)
   - Phone: a real business number that someone will answer
   - Website: `https://kadadine.thekada.in`
   - Hours: business hours when a human can be reached
4. Verify (Google sends a postcard or calls a verified number).
5. Add **10+ photos** — office, product screenshots, team, customers.
6. Once verified, the GBP URL becomes a property you can link from
   `Organization.sameAs` in `index.html`. Add it.

---

## 4. Social profiles (`Organization.sameAs`)

The `sameAs` array in `index.html`'s Organization JSON-LD tells Google
which social accounts confirm your business identity. We've left it
empty with a `_note_sameAs` placeholder. Fill it in as accounts are
created.

Recommended order (highest signal to Google first):

1. **LinkedIn Company Page** — most important for B2B SaaS.
   Set up at <https://www.linkedin.com/company/setup/new>.
   Post 1-2x per week (product updates, customer wins, hiring).
2. **X / Twitter** — `@kadadine`.
   Auto-post product launches, blog articles, status updates.
   When live, also uncomment the `twitter:site` and `twitter:creator`
   meta tags in `index.html`.
3. **Instagram** — best for showcasing the customer-facing QR menu UI
   and restaurant operator stories. Reels work well in food/restaurant
   niche.
4. **YouTube** — even a single 90-second product demo video gets indexed.
   Embeds boost time-on-page on marketing pages too.
5. **Facebook Page** — lower-priority but Google still uses it for
   identity verification.

Once each profile is live, paste its URL into the `sameAs` array:

```html
<!-- index.html -->
"sameAs": [
  "https://kadadine.thekada.in",
  "https://www.linkedin.com/company/kadadine",
  "https://twitter.com/kadadine",
  "https://www.instagram.com/kadadine",
  "https://www.youtube.com/@kadadine",
  "https://www.facebook.com/kadadine"
]
```

---

## 5. Backlink strategy (the only SEO that compounds)

Domain Rating / Authority is the #1 ranking factor outside of content.
You build it by getting other reputable sites to link to you. Some
realistic targets for an Indian restaurant SaaS:

### Free / easy wins

- **YourStory** — Submit a startup story via <https://yourstory.com/contact>
- **Indian Retailer** — `editor@indianretailer.com`
- **Restaurant India** magazine — pitch a guest column
- **MarTech Series India** — product launch press release
- **Get listed on G2 / Capterra / SoftwareSuggest / SaaSworthy** — they
  rank in Google for "restaurant POS software India" and link to you
- **Submit to ProductHunt** at launch — typically gives 5-15 backlinks
- **HackerNews "Show HN"** — works for technical product launches
- **Reddit /r/IndianStartups, /r/restaurateur** — answer questions
  with helpful context that includes a link to a relevant blog post

### Paid / longer-game

- Sponsor a local restaurant operator meetup → press coverage
- Sponsor a podcast in the F&B niche → show-notes backlink
- Hire a PR retainer for 3 months around a funding announcement

### Track progress

Use <https://ahrefs.com/free-backlink-checker> monthly. Aim for **+5
referring domains per month** in year 1. By month 12 you'll be at
~60 unique domains — enough to compete with established players.

---

## 6. Content calendar (the only content marketing that works)

We've shipped 25 blog posts in `src/data/blogPosts.ts`. Three are now
full-length (GST Billing, Kitchen Display, Google Reviews); the other
22 are placeholders that need expanding.

### Cadence

- **2 new full-length posts per month** (1,500–2,500 words each)
- **1 post per month** updating an old post with fresh stats
- **1 long-form pillar article per quarter** (4,000+ words, becomes
  the canonical resource for a major keyword)

### Topic selection rule

For every post, ask: "Is someone in India typing this exact phrase
into Google?" Use <https://ads.google.com/keyword-planner> and
<https://answerthepublic.com> with seed keywords like "restaurant POS",
"GST billing", "kitchen display system".

Target keywords with:
- Monthly search volume ≥100 (small enough to rank for, big enough
  to matter)
- Commercial intent (someone searching "how to choose restaurant
  POS" is closer to buying than "what is a POS")
- Low-to-medium competition (KD < 30 in Ahrefs)

### Existing placeholders to expand next (in priority order)

1. `how-to-reduce-food-waste-in-your-restaurant` — high search volume,
   already wired into inventory product page
2. `swiggy-zomato-integration-for-restaurants` — commercial intent
3. `cloud-kitchen-business-in-india-how-to-start` — top-of-funnel,
   captures research-stage buyers
4. `menu-engineering-for-indian-restaurants` — connects to /features/menu

---

## 7. Technical SEO maintenance (quarterly)

Run a Lighthouse audit on each marketing page (`F12` → Lighthouse tab).
Targets:
- Performance ≥ 90 (mobile and desktop)
- Accessibility ≥ 95
- Best Practices ≥ 95
- SEO = 100

Common Lighthouse warnings + fixes:
- **Image sizing** → use `<OptimizedImage>` (already exists) instead
  of raw `<img>`
- **Render-blocking CSS** → already mitigated by Vite's CSS code-split
- **Properly size images** → re-export hero images at 1× and 2× and
  use `srcset`
- **No `crossorigin` on preconnect** → already correct in `index.html`

---

## 8. Monitoring & alerting

Set up:
- **GSC email alerts** for indexing issues (Settings → Notifications)
- **Google Alerts** for the brand name "Kada Dine" — catches mentions
  on press / forums
- **Uptime monitoring** for the marketing site (UptimeRobot is free
  for 5-minute checks) — if `/` returns non-200, Google demotes you fast

---

## Quick-reference: what's already shipped in code

| Item | Where | Notes |
|---|---|---|
| Organization, SoftwareApplication, WebSite, FAQPage, BreadcrumbList JSON-LD | `index.html` | Reviewed by Google as enterprise-tier |
| Sitemap (42 URLs) | `public/sitemap.xml` | Submit to GSC + Bing |
| robots.txt | `public/robots.txt` | Already allows all good crawlers |
| `<SEO>` component | `src/components/SEO.tsx` | Per-page meta + Helmet + breadcrumb prop |
| Per-page breadcrumbs | Top marketing pages | Pricing / Product / Workflows / Ecosystem / Enterprise / FeaturePos |
| OG + Twitter cards | `index.html` + `<SEO>` | Locale = en_IN |
| Hreflang | `index.html` | en-IN + x-default |

---

## Quick-reference: what you do manually

| Task | Where | Frequency |
|---|---|---|
| Verify in Google Search Console | search.google.com/search-console | One-time |
| Submit sitemap | GSC → Sitemaps | One-time + after each big route addition |
| Verify in Bing Webmaster | bing.com/webmasters | One-time |
| Create Google Business Profile | business.google.com | One-time + 5-min/week updates |
| Set up social profiles | LinkedIn, X, IG, YT, FB | One-time + ongoing posting |
| Add social URLs to `Organization.sameAs` | `index.html` | After each new account |
| Publish 2 blog posts / month | `src/data/blogPosts.ts` | Monthly |
| Backlink outreach | YourStory, G2, ProductHunt, etc. | Monthly |
| GSC performance review | GSC → Performance | Weekly (5 min) |
| Lighthouse audit | Browser DevTools | Quarterly per page |
| Update sitemap `lastmod` dates | `public/sitemap.xml` | When page content changes meaningfully |

---

That's it. The codebase has done what it can do. The rest is content
discipline + the manual ops above. Done well, this gets you from
~0 organic traffic to 10,000+ monthly organic visits within 12 months
in a tight commercial niche like Indian restaurant SaaS.
