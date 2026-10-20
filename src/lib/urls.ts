/**
 * Helper to resolve dynamic URLs between localhost in development and
 * custom subdomains in production.
 */

export function isLocalEnvironment(): boolean {
  if (typeof window !== 'undefined') {
    return (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }
  return false;
}

export function getVendorAdminUrl(path: string = '/admin'): string {
  const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  if (isLocalEnvironment()) {
    return `http://localhost:5177${cleanPath}`;
  }
  return `https://vendor.thekada.in${cleanPath}`;
}

export function getHostAdminUrl(path: string = '/admin'): string {
  const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  if (isLocalEnvironment()) {
    return `http://localhost:5178${cleanPath}`;
  }
  return `https://host.thekada.in${cleanPath}`;
}

export function getCompanyAdminUrl(path: string = '/'): string {
  const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  if (isLocalEnvironment()) {
    return `http://localhost:5179${cleanPath}`;
  }
  return `https://admin.thekada.in${cleanPath}`;
}
