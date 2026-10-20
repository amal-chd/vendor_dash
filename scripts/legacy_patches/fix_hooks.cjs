const fs = require('fs');

const path = 'thekada_web/src/components/services/ServiceLayout.tsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /function ServiceSandbox\(\{ slug, accent \}: \{ slug: string; accent: string \}\) \{([\s\S]*?)\n\}\n*$/;
const match = content.match(regex);
if (!match) {
  console.log('Failed to match ServiceSandbox');
  process.exit(1);
}

const body = match[1];

let newComponents = '';
let newSandboxBody = `  // Common UI styles
  const terminalStyle: React.CSSProperties = {
    background: '#0B0F19',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '1.25rem',
    fontFamily: 'monospace',
    fontSize: '0.74rem',
    color: '#34D399',
    minHeight: '220px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between'
  }

  const explainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '1rem'
  }

  switch(slug) {
`;

const sandboxTypes = [
  { id: 1, name: 'WebDevelopment', str: 'web-development' },
  { id: 2, name: 'MobileDevelopment', str: 'mobile-development' },
  { id: 3, name: 'SaasDevelopment', str: 'saas-development' },
  { id: 4, name: 'BusinessAutomation', str: 'business-automation' },
  { id: 5, name: 'EnterpriseSoftware', str: 'enterprise-software' },
  { id: 6, name: 'UiUxDesign', str: 'ui-ux-design' },
  { id: 7, name: 'ApiIntegrations', str: 'api-integrations' },
  { id: 8, name: 'CloudDevops', str: 'cloud-devops' },
  { id: 9, name: 'DigitalTransformation', str: 'digital-transformation' }
];

for (const type of sandboxTypes) {
  const blockRegex = new RegExp(`// ${type.id}\\. .*?\\n\\s*if \\(slug === '${type.str}'\\) \\{([\\s\\S]*?)return \\(([\\s\\S]*?)\\n\\s*\\)\\n\\s*\\}`);
  const m = body.match(blockRegex);
  if (m) {
    newComponents += `\nfunction ${type.name}Sandbox({ terminalStyle, explainerStyle, accent }: { terminalStyle: any, explainerStyle: any, accent: string }) {\n${m[1]}return (${m[2]}\n  )\n}\n`;
    newSandboxBody += `    case '${type.str}': return <${type.name}Sandbox terminalStyle={terminalStyle} explainerStyle={explainerStyle} accent={accent} />;\n`;
  }
}
newSandboxBody += `    default: return <div style={explainerStyle}><p>Select a service to view its interactive sandbox.</p></div>;\n  }\n`;

const replacement = `function ServiceSandbox({ slug, accent }: { slug: string; accent: string }) {\n${newSandboxBody}}\n${newComponents}\n`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content);
console.log('Fixed ServiceLayout.tsx');

