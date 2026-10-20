const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/safety/sos_sheet.dart', 'utf8');

// Add geocoding import
if (!code.includes('geocoding.dart')) {
  code = code.replace(
    "import 'package:geolocator/geolocator.dart';",
    "import 'package:geolocator/geolocator.dart';\nimport 'package:geocoding/geocoding.dart';"
  );
}

// Add state for placemark
code = code.replace(
  "Position? _currentPosition;",
  "Position? _currentPosition;\n  Placemark? _placemark;"
);

// Update _fetchLoc
code = code.replace(
  /Future<void> _fetchLoc\(\) async \{\n\s*try \{\n\s*final pos = await Geolocator\.getCurrentPosition\(\);\n\s*if \(mounted\) setState\(\(\) => _currentPosition = pos\);\n\s*\} catch \(_\) \{\}\n\s*\}/g,
  `Future<void> _fetchLoc() async {
    try {
      final pos = await Geolocator.getCurrentPosition();
      if (mounted) setState(() => _currentPosition = pos);
      final placemarks = await placemarkFromCoordinates(pos.latitude, pos.longitude);
      if (placemarks.isNotEmpty && mounted) {
        setState(() => _placemark = placemarks.first);
      }
    } catch (_) {}
  }`
);

// Replace GPS UI
const oldGPSUI = `              if (_currentPosition != null) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: RiderColors.primary.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.my_location_rounded,
                          size: 18, color: RiderColors.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Your GPS: \${_currentPosition!.latitude.toStringAsFixed(5)}, \${_currentPosition!.longitude.toStringAsFixed(5)}',
                          style: const TextStyle(
                              fontSize: 12.5, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],`;

const newGPSUI = `              if (_currentPosition != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: RiderColors.primary.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Icon(Icons.my_location_rounded, size: 18, color: RiderColors.primary),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_placemark != null) ...[
                              Text(
                                [\n                                  _placemark!.subLocality,\n                                  _placemark!.locality,\n                                  _placemark!.administrativeArea\n                                ].where((s) => s != null && s.isNotEmpty).join(', '),
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RiderColors.ink),
                              ),
                              const SizedBox(height: 2),
                            ],
                            Text(
                              '\${_currentPosition!.latitude.toStringAsFixed(5)}, \${_currentPosition!.longitude.toStringAsFixed(5)}',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: RiderColors.muted),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.copy_rounded, size: 18, color: RiderColors.primary),
                        onPressed: () {
                          HapticFeedback.lightImpact();
                          final pName = _placemark != null ? [
                                _placemark!.subLocality,
                                _placemark!.locality,
                                _placemark!.administrativeArea
                              ].where((s) => s != null && s.isNotEmpty).join(', ') : '';
                          final coords = '\${_currentPosition!.latitude.toStringAsFixed(5)}, \${_currentPosition!.longitude.toStringAsFixed(5)}';
                          Clipboard.setData(ClipboardData(text: 'Location: $pName\\nCoordinates: $coords'));
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Location details copied')));
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],`;

code = code.replace(oldGPSUI, newGPSUI);

// Remove Control Room card
const oldControlRoom = `              const SizedBox(height: 12),
              _callCard(
                'Kada Delivery 24/7 Rider Control Room',
                '+919876543210',
                Icons.support_agent_rounded,
                RiderColors.primaryDark,
                fullWidth: true,
              ),`;
code = code.replace(oldControlRoom, '');

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/safety/sos_sheet.dart', code);
