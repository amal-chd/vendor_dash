const fs = require('fs');

const path = '/Users/amalchand/Documents/The Kada/vendor_mobile_app/lib/screens/earnings_screen.dart';
let code = fs.readFileSync(path, 'utf8');

// Replace tds/tcs hardcoding
const regex1 = /final tds = gross \* 0\.01;\n    final tcs = gross \* 0\.01;\n    final refund = n\('refunds'\);/m;
const replacement1 = `final tds = data['tdsAmount'] != null ? n('tdsAmount') : (gross * 0.01);
    final tcs = data['tcsAmount'] != null ? n('tcsAmount') : (gross * 0.01);
    final refund = n('refunds');
    final adjustments = n('adjustmentsTotal');`;
code = code.replace(regex1, replacement1);

// Add adjustments to the UI breakdown
const regex2 = /_row\('TCS \(1%\)', '- \$\{CurrencyUtils.format\(tcs\)\}', color: VendorColors.slate\);/m;
const replacement2 = `_row(data['tcsRate'] != null ? 'TCS (\${data['tcsRate']}%)' : 'TCS (1%)', '- \${CurrencyUtils.format(tcs)}', color: VendorColors.slate);
              if (adjustments != 0) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Divider(height: 1, color: VendorColors.border),
                ),
                _row('Manual Adjustments', adjustments > 0 ? '+ \${CurrencyUtils.format(adjustments)}' : '- \${CurrencyUtils.format(adjustments.abs())}', color: adjustments > 0 ? VendorColors.green : VendorColors.red),
              ]`;
code = code.replace(regex2, replacement2);

// Fix the TDS row label
const regex3 = /_row\('TDS \(1%\)', '- \$\{CurrencyUtils.format\(tds\)\}', color: VendorColors.slate\);/m;
const replacement3 = `_row(data['tdsRate'] != null ? 'TDS (\${data['tdsRate']}%)' : 'TDS (1%)', '- \${CurrencyUtils.format(tds)}', color: VendorColors.slate);`;
code = code.replace(regex3, replacement3);

fs.writeFileSync(path, code);
