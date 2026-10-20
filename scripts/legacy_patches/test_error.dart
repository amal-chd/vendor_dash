import 'dart:io';
void main() {
  final lines = File('delivery_mobile_app/lib/screens/home/home_screen.dart').readAsLinesSync();
  print('Line 1011: "${lines[1010]}"');
  print('Line 1011 length: ${lines[1010].length}');
}
