const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', 'utf8');

const targetStr = `                  enabled: !isArrivedStage || (verificationDone && (!order.isCod || _codCollected)),
                  onConfirm: () => _advance(order),
                  cardColor: cardColor,
                  borderColor: borderColor,
                ),
              ),
            ],
          );
        },
      ),
    );
  }`;

const replacementStr = `                  enabled: !isArrivedStage || (verificationDone && (!order.isCod || _codCollected)),
                  onConfirm: () => _advance(order),
                  cardColor: cardColor,
                  borderColor: borderColor,
                ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }`;

code = code.replace(targetStr, replacementStr);
fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', code);
console.log('Fixed brackets!');
