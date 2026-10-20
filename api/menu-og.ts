import { IncomingMessage, ServerResponse } from 'http';

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function replaceMetaTag(html: string, nameOrProperty: string, value: string, isProperty = false): string {
  const attrName = isProperty ? 'property' : 'name';
  // Matches any meta tag containing the specific name or property attribute
  const regex = new RegExp(
    `<meta\\s+[^>]*?${attrName}=["']${nameOrProperty}["'][^>]*?>`,
    'gi'
  );
  const newTag = `<meta ${attrName}="${nameOrProperty}" content="${escapeHtml(value)}" />`;
  
  if (regex.test(html)) {
    return html.replace(regex, newTag);
  } else {
    // If not found, inject it before the closing </head> tag
    return html.replace('</head>', `    ${newTag}\n  </head>`);
  }
}

export default async function handler(req: any, res: any) {
  const urlParams = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const restaurantId = urlParams.searchParams.get('restaurantId');

  // Get the protocol and host to request the static index.html from Vercel's CDN
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'] || 'localhost';
  const indexUrl = `${protocol}://${host}/index.html`;

  let html = '';
  try {
    const htmlRes = await fetch(indexUrl);
    if (htmlRes.ok) {
      html = await htmlRes.text();
    } else {
      throw new Error(`Failed to fetch index.html: ${htmlRes.statusText}`);
    }
  } catch (error) {
    console.error('Error fetching base index.html:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('Error loading menu page');
  }

  // If there's no restaurantId, we just serve the base index.html unmodified
  if (!restaurantId) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  try {
    // Fetch restaurant document via Firestore REST API (read-only, public document)
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/kada-restaurant-os-v1/databases/(default)/documents/restaurants/${restaurantId}`;
    const restRes = await fetch(firestoreUrl);

    if (restRes.ok) {
      const restDoc = await restRes.json();
      const fields = restDoc.fields || {};

      // Extract values from Firestore REST response format
      const name = fields.name?.stringValue || 'Restaurant';
      const description = fields.description?.stringValue || 'Browse our digital menu, place orders, and pay online directly from your table.';
      
      let logoUrl = fields.logoUrl?.stringValue || fields.logo?.stringValue || '';
      if (!logoUrl || !logoUrl.startsWith('http')) {
        // Fallback to default Kada Dine logo if restaurant logo is not configured or invalid
        logoUrl = 'https://kadadine.thekada.in/logo.png';
      }

      const pageTitle = `${name} - Digital Menu | Kada Dine`;
      const shareUrl = `${protocol}://${host}/menu?restaurantId=${restaurantId}`;

      // Update the page title
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(pageTitle)}</title>`);

      // Update general metadata
      html = replaceMetaTag(html, 'description', description);

      // Update Open Graph tags
      html = replaceMetaTag(html, 'og:title', `${name} - Digital Menu`, true);
      html = replaceMetaTag(html, 'og:description', description, true);
      html = replaceMetaTag(html, 'og:url', shareUrl, true);
      html = replaceMetaTag(html, 'og:image', logoUrl, true);

      // Update Twitter tags
      html = replaceMetaTag(html, 'twitter:title', `${name} - Digital Menu`);
      html = replaceMetaTag(html, 'twitter:description', description);
      html = replaceMetaTag(html, 'twitter:image', logoUrl);
    }
  } catch (error) {
    console.error('Error fetching restaurant details for dynamic meta tags:', error);
    // Fall back to serving standard index.html on error
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  return res.end(html);
}
