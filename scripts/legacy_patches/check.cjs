const fs = require('fs');
const path = require('path');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const importMatches = content.match(/import\s+{[^}]*}\s+from\s+['"]lucide-react['"]/g);
      if (importMatches) {
        for (const match of importMatches) {
          const checks = match.match(/CheckCircle2/g);
          if (checks && checks.length > 1) {
            console.log(`Duplicate in import in ${fullPath}`);
          }
        }
      }
      
      const allChecks = content.match(/CheckCircle2/g);
      if (allChecks && allChecks.length > 0) {
        // check for global duplicate declarations (const CheckCircle2 = ...)
        const decs = content.match(/(const|let|var)\s+CheckCircle2\b/g);
        if (decs && decs.length > 0) {
          console.log(`Declared as variable in ${fullPath}`);
        }
      }
    }
  }
}

walk('/Users/amalchand/Documents/The Kada/src');
