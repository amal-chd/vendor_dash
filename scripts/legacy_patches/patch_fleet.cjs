const fs = require('fs');
const path = '/Users/amalchand/Documents/The Kada/src/pages/admin/FleetPage.tsx';
let code = fs.readFileSync(path, 'utf8');

const regexDropdown = /<DropdownMenuItem onClick=\{\(\) => settle\(r\)\} className="text-\[11px\] font-bold uppercase tracking-wider cursor-pointer text-amber-600">Settle cash<\/DropdownMenuItem>/;
const replaceDropdown = `<DropdownMenuItem onClick={() => settle(r)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-amber-600">Settle cash</DropdownMenuItem>
              {r.payoutPending && <DropdownMenuItem onClick={() => settlePayout(r)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-blue-600">Settle Payout</DropdownMenuItem>}`;
code = code.replace(regexDropdown, replaceDropdown);

fs.writeFileSync(path, code);
