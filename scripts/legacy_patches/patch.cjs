const fs = require('fs');
const file = '/Users/amalchand/Documents/The Kada/src/pages/admin/PlatformDashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Extract the Recent Activity block from the top (lines 902-948 roughly)
const recentActivityMatch = content.match(/\{\/\* ── Recent Activity ──.*?<\/div>\n\n      \{\/\* ── Marketplace Pulse/s);
if (!recentActivityMatch) {
    console.error("Could not find Recent Activity block");
    process.exit(1);
}
const recentActivityCode = recentActivityMatch[0].replace(/\n\n      \{\/\* ── Marketplace Pulse$/, '');
content = content.replace(recentActivityCode + '\n\n', '');

// 2. Remove the Activity Feed (1/4) block from the bottom
const activityFeedMatch = content.match(/\{\/\* ── Activity Feed \(1\/4\).*?(?=<\/div>\n    <\/div>\n  \);\n\})/s);
if (!activityFeedMatch) {
    console.error("Could not find Activity Feed block");
    process.exit(1);
}
content = content.replace(activityFeedMatch[0], '');

// 3. Make the charts span full width
content = content.replace(/xl:col-span-3 space-y-6/g, 'col-span-full space-y-6');
content = content.replace(/<div className="grid grid-cols-1 xl:grid-cols-4 gap-6">\n        \{\/\* ── Charts column \(3\/4\)/g, '<div className="grid grid-cols-1 gap-6">\n        {/* ── Charts column (Full Width)');

// 4. Append the Recent Activity code at the very end
content = content.replace(/(?=<\/div>\n  \);\n\})/, `      ${recentActivityCode}\n    `);

fs.writeFileSync(file, content);
console.log("Patched successfully");
