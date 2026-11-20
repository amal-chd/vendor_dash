import type { BrandProfile } from "./brandProfiles";

export type PosterPromptFields = {
  audience?: string;
  goal?: string;
  category?: string;
  visualDirection?: string;
  dailyPrompt?: string;
  referenceAssetNames?: string[];
  headline?: string;
  support?: string;
  cta?: string;
};

export function createPosterPrompt(form: PosterPromptFields, brand: BrandProfile) {
  const { primary, secondary, accent, background, text } = brand.palette;
  return [
    `Create one polished social advertising poster for ${brand.name}.`,
    `Brand positioning: ${brand.positioning} Voice: ${brand.voice}`,
    `Preferred vocabulary: ${brand.wordsUse || "Use clear brand-approved language."} Avoid these words or habits: ${brand.wordsAvoid || "Avoid unsupported claims and hype."}`,
    `Approved destination for campaign context: ${brand.website || "none configured"}. Social handles: ${brand.handles || "none configured"}. Treat these as reference information only; do not add them to the poster unless they appear in the exact poster wording below.`,
    `Use this brand palette: primary ${primary}, secondary ${secondary}, accent ${accent}, background ${background}, text ${text}. Typography: ${brand.font}. Use an intentional hierarchy, readable contrast and generous negative space.`,
    `Use the supplied ${brand.name} logo exactly as provided${brand.logoUrl ? ` (${brand.logoUrl})` : "; no approved logo is configured, so do not invent one"}. Keep the identity of this product distinct from other KadaVerse products.`,
    `Canvas: 1080 × 1350 px, portrait 4:5, with social-feed safe margins. Create a fresh composition. References guide composition only; do not copy another brand's text, logo, statistics, watermark or complete layout.`,
    form.referenceAssetNames?.length ? `Attach and use these approved campaign reference files: ${form.referenceAssetNames.join(", ")}. Keep real logos and product screens unchanged.` : "Attach any approved logo or product screenshot when using this prompt; do not fabricate brand assets.",
    `Audience: ${form.audience || brand.audience}. Campaign goal: ${form.goal || "explain the offer clearly"}. Category: ${form.category || brand.section}.`,
    `Visual direction: ${form.visualDirection || "Create a strong single-idea layout with one clear visual hero."}`,
    form.dailyPrompt ? `Campaign-specific visual prompt: ${form.dailyPrompt}` : "",
    `Claim rules: ${brand.claims} Offer rules: ${brand.offerRules}`,
    "Do not invent product features, metrics, testimonials, customers, app screens, prices, URLs, availability, or results. Use supplied product screens unchanged. Use only the exact poster copy below; add no other readable copy. If accurate lettering is not possible, leave clear blank areas for final typesetting.",
    "Exact poster wording:",
    `Headline: “${form.headline || "[Add headline]"}”`,
    form.support ? `Support: “${form.support}”` : "",
    form.cta ? `Call to action: “${form.cta}”` : "",
    brand.hashtags ? `Approved caption hashtags (do not put these on the poster unless included in its exact wording): ${brand.hashtags}` : "",
    "Keep text correctly spelled, short, legible on a phone, high contrast and inside the safe area. Do not place copy over busy imagery.",
  ].filter(Boolean).join("\n\n");
}
