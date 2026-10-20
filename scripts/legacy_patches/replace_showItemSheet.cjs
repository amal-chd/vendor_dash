const fs = require('fs');

function replaceFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (file.includes('under_250_screen')) {
    content = content.replace(/showItemSheet\(\s*ctx,\s*restaurant,\s*item,?\s*\);/g, 
      "Navigator.push(ctx, MaterialPageRoute(builder: (_) => ProductDetailScreen(restaurant: restaurant, item: item)));");
  } else {
    content = content.replace(/showItemSheet\(\s*context,\s*restaurant,\s*item\s*\);/g, 
      "Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(restaurant: restaurant, item: item)));");
  }
  
  fs.writeFileSync(file, content);
}

replaceFile('/Users/amalchand/Documents/The Kada/customer_mobile_app/lib/screens/home/discover_screen.dart');
replaceFile('/Users/amalchand/Documents/The Kada/customer_mobile_app/lib/screens/home/under_250_screen.dart');
replaceFile('/Users/amalchand/Documents/The Kada/customer_mobile_app/lib/screens/restaurant/restaurant_screen.dart');
console.log('done');
