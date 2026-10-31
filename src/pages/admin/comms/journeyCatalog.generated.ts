// Generated from functions/src/comms — do not edit. See functions/test/commsCatalogSync.test.ts.
/* eslint-disable */
export const BUNDLED_JOURNEY_CATALOG = {
 "events": [
  {
   "key": "user.signup",
   "label": "Customer signed up",
   "app": "customer"
  },
  {
   "key": "order.placed",
   "label": "Order placed",
   "app": "customer",
   "hasValue": true
  },
  {
   "key": "order.delivered",
   "label": "Order delivered",
   "app": "customer",
   "hasValue": true
  },
  {
   "key": "order.first_delivered",
   "label": "First order delivered",
   "app": "customer",
   "hasValue": true
  },
  {
   "key": "order.cancelled",
   "label": "Order cancelled",
   "app": "customer"
  },
  {
   "key": "refund.completed",
   "label": "Refund completed",
   "app": "customer"
  },
  {
   "key": "stay.booked",
   "label": "Stay booked",
   "app": "customer",
   "hasValue": true
  },
  {
   "key": "reservation.booked",
   "label": "Table booked (dine-in)",
   "app": "customer"
  },
  {
   "key": "partner.activated",
   "label": "Partner went live",
   "app": "all"
  },
  {
   "key": "support.ticket_created",
   "label": "Support ticket opened",
   "app": "all"
  },
  {
   "key": "email.opened",
   "label": "Opened any email",
   "app": "all"
  },
  {
   "key": "email.clicked",
   "label": "Clicked any email",
   "app": "all"
  }
 ],
 "library": [
  {
   "key": "welcome_series",
   "title": "Welcome series",
   "stage": "Onboarding",
   "why": "New customers decide in their first days whether the app is for them. Welcome them, then nudge toward a first order only if they haven't placed one.",
   "templates": [
    "welcome",
    "first_order_nudge",
    "first_order_last_nudge"
   ],
   "def": {
    "name": "Welcome series",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "user.signup"
    },
    "startStepId": "welcome",
    "steps": [
     {
      "id": "welcome",
      "type": "email",
      "label": "Welcome",
      "templateKey": "welcome",
      "next": "wait1"
     },
     {
      "id": "wait1",
      "type": "wait_event",
      "label": "Wait up to 2 days for a first order",
      "event": "order.placed",
      "timeoutMinutes": 2880,
      "next": "done",
      "timeoutNext": "nudge1"
     },
     {
      "id": "nudge1",
      "type": "email",
      "label": "First-order nudge",
      "templateKey": "first_order_nudge",
      "next": "wait2"
     },
     {
      "id": "wait2",
      "type": "wait_event",
      "label": "Wait up to 5 days",
      "event": "order.placed",
      "timeoutMinutes": 7200,
      "next": "done",
      "timeoutNext": "nudge2"
     },
     {
      "id": "nudge2",
      "type": "email",
      "label": "Last nudge",
      "templateKey": "first_order_last_nudge",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": {
     "event": "order.placed",
     "withinDays": 14
    },
    "exitOnGoal": true,
    "exitEvents": [],
    "reentry": {
     "mode": "once"
    },
    "holdoutPercent": 10,
    "onlyOptedIn": false,
    "description": "Signup → welcome → first-order nudges until they order (14-day goal). Nudges are marketing mail, so only opted-in customers get them."
   }
  },
  {
   "key": "second_order",
   "title": "First order → second order",
   "stage": "Engagement",
   "why": "The jump from one order to two is where habits form. Thank them after the first delivery and invite them back a few days later.",
   "templates": [
    "reorder_nudge"
   ],
   "def": {
    "name": "Second order",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "order.first_delivered"
    },
    "startStepId": "wait",
    "steps": [
     {
      "id": "wait",
      "type": "wait_event",
      "label": "Give them 3 days",
      "event": "order.placed",
      "timeoutMinutes": 4320,
      "next": "done",
      "timeoutNext": "nudge"
     },
     {
      "id": "nudge",
      "type": "email",
      "label": "Come back for round two",
      "templateKey": "reorder_nudge",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": {
     "event": "order.placed",
     "withinDays": 14
    },
    "exitOnGoal": true,
    "exitEvents": [],
    "reentry": {
     "mode": "once"
    },
    "holdoutPercent": 10,
    "onlyOptedIn": true,
    "description": "After the first delivered order, wait 3 days; if no second order, send one reminder."
   }
  },
  {
   "key": "review_request",
   "title": "Post-delivery review",
   "stage": "Engagement",
   "why": "Reviews are freshest just after the meal. One ask, two hours after delivery, at most once a month per person.",
   "templates": [
    "review_request"
   ],
   "def": {
    "name": "Review request",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "order.delivered"
    },
    "startStepId": "wait",
    "steps": [
     {
      "id": "wait",
      "type": "wait",
      "label": "2 hours after delivery",
      "minutes": 120,
      "next": "ask"
     },
     {
      "id": "ask",
      "type": "email",
      "label": "How was it?",
      "templateKey": "review_request",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 30
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Order delivered → wait 2h → review request. Re-enters at most every 30 days."
   }
  },
  {
   "key": "winback",
   "title": "Win-back lapsed customers",
   "stage": "Win-back",
   "why": "Someone who ordered before and has gone quiet for a month is worth a reminder; a second, warmer one a week later if they still haven't come back.",
   "templates": [
    "promo_reengagement",
    "winback_last"
   ],
   "def": {
    "name": "Win-back (30 days)",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "segment",
     "conditions": [
      {
       "field": "userType",
       "op": "eq",
       "value": "CUSTOMER"
      },
      {
       "field": "inactiveDays",
       "op": "eq",
       "value": 30
      }
     ]
    },
    "startStepId": "first",
    "steps": [
     {
      "id": "first",
      "type": "email",
      "label": "We miss you",
      "templateKey": "promo_reengagement",
      "next": "wait"
     },
     {
      "id": "wait",
      "type": "wait_event",
      "label": "Wait up to 7 days for an order",
      "event": "order.placed",
      "timeoutMinutes": 10080,
      "next": "done",
      "timeoutNext": "push"
     },
     {
      "id": "push",
      "type": "push",
      "label": "Push reminder",
      "title": "Your favourites are still here",
      "body": "{{lastVendorName}} and new kitchens in {{zoneName}} are a tap away.",
      "next": "last"
     },
     {
      "id": "last",
      "type": "email",
      "label": "Last reminder",
      "templateKey": "winback_last",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": {
     "event": "order.placed",
     "withinDays": 21
    },
    "exitOnGoal": true,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 90
    },
    "holdoutPercent": 10,
    "onlyOptedIn": true,
    "description": "No order for 30+ days → email → wait 7 days → push + last email. At most once every 90 days."
   }
  },
  {
   "key": "sunset",
   "title": "Sunset unengaged subscribers",
   "stage": "Hygiene",
   "why": "Mailing people who never open hurts inbox placement for everyone. Ask once; if they still don't engage, stop sending marketing to them.",
   "templates": [
    "sunset_check"
   ],
   "def": {
    "name": "Sunset policy",
    "app": "all",
    "userType": null,
    "entry": {
     "type": "segment",
     "conditions": [
      {
       "field": "unengagedDays",
       "op": "eq",
       "value": 120
      }
     ]
    },
    "startStepId": "ask",
    "steps": [
     {
      "id": "ask",
      "type": "email",
      "label": "Still want our emails?",
      "templateKey": "sunset_check",
      "next": "wait"
     },
     {
      "id": "wait",
      "type": "wait_event",
      "label": "Wait 14 days for any click",
      "event": "email.clicked",
      "timeoutMinutes": 20160,
      "next": "keep",
      "timeoutNext": "stop"
     },
     {
      "id": "keep",
      "type": "tag",
      "label": "Mark re-engaged",
      "tag": "re-engaged",
      "next": "done"
     },
     {
      "id": "stop",
      "type": "sunset",
      "label": "Stop marketing email",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": {
     "event": "email.clicked",
     "withinDays": 14
    },
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 180
    },
    "holdoutPercent": 0,
    "onlyOptedIn": true,
    "description": "Opted in but no open or click for 120 days → one check-in → no click in 14 days → marketing turned off (they can opt back in any time)."
   }
  },
  {
   "key": "stay_pre_arrival",
   "title": "Stay pre-arrival",
   "stage": "Stays",
   "why": "A day before check-in, guests want the address, timings and who to call. It cuts support load and no-shows.",
   "templates": [
    "stay_pre_arrival"
   ],
   "def": {
    "name": "Stay pre-arrival",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "stay.booked"
    },
    "startStepId": "wait",
    "steps": [
     {
      "id": "wait",
      "type": "wait_until",
      "label": "1 day before check-in",
      "field": "checkInAt",
      "offsetMinutes": -1440,
      "next": "remind"
     },
     {
      "id": "remind",
      "type": "email",
      "label": "See you tomorrow",
      "templateKey": "stay_pre_arrival",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "always"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Booking confirmed → wait until the day before check-in → reminder with stay details."
   }
  },
  {
   "key": "partner_onboarding",
   "title": "Restaurant first week",
   "stage": "Partners",
   "why": "Restaurants and mess kitchens that get through their first week with help stay. A day-1 checklist and a day-7 check-in, sent as service mail.",
   "templates": [
    "partner_day1",
    "partner_week1"
   ],
   "def": {
    "name": "Restaurant first week",
    "app": "vendor",
    "userType": "VENDOR",
    "entry": {
     "type": "event",
     "event": "partner.activated"
    },
    "startStepId": "wait1",
    "steps": [
     {
      "id": "wait1",
      "type": "wait",
      "label": "Next morning",
      "minutes": 1080,
      "next": "day1"
     },
     {
      "id": "day1",
      "type": "email",
      "label": "Day 1 checklist",
      "templateKey": "partner_day1",
      "next": "wait7"
     },
     {
      "id": "wait7",
      "type": "wait",
      "label": "6 days",
      "minutes": 8640,
      "next": "day7"
     },
     {
      "id": "day7",
      "type": "email",
      "label": "Week 1 check-in",
      "templateKey": "partner_week1",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "once"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Restaurant or mess kitchen goes live → day-1 checklist → day-7 check-in."
   }
  },
  {
   "key": "rider_first_week",
   "title": "Rider first week",
   "stage": "Partners",
   "why": "New riders decide in their first shifts whether to stay. Tell them how to get orders, how payouts work, and where help is.",
   "templates": [
    "rider_day1",
    "rider_week1"
   ],
   "def": {
    "name": "Rider first week",
    "app": "delivery",
    "userType": "DELIVERY_PARTNER",
    "entry": {
     "type": "event",
     "event": "partner.activated"
    },
    "startStepId": "wait1",
    "steps": [
     {
      "id": "wait1",
      "type": "wait",
      "label": "Next morning",
      "minutes": 1080,
      "next": "day1"
     },
     {
      "id": "day1",
      "type": "email",
      "label": "Your first shifts",
      "templateKey": "rider_day1",
      "next": "wait7"
     },
     {
      "id": "wait7",
      "type": "wait",
      "label": "6 days",
      "minutes": 8640,
      "next": "day7"
     },
     {
      "id": "day7",
      "type": "email",
      "label": "Week 1 check-in",
      "templateKey": "rider_week1",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "once"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Rider approved → first-shift tips → day-7 check-in."
   }
  },
  {
   "key": "host_first_week",
   "title": "Stay host first week",
   "stage": "Partners",
   "why": "A complete listing with good photos and a fast first reply is what wins a host's first booking.",
   "templates": [
    "host_day1",
    "host_week1"
   ],
   "def": {
    "name": "Host first week",
    "app": "host",
    "userType": "HOST",
    "entry": {
     "type": "event",
     "event": "partner.activated"
    },
    "startStepId": "wait1",
    "steps": [
     {
      "id": "wait1",
      "type": "wait",
      "label": "Next morning",
      "minutes": 1080,
      "next": "day1"
     },
     {
      "id": "day1",
      "type": "email",
      "label": "Make the listing shine",
      "templateKey": "host_day1",
      "next": "wait7"
     },
     {
      "id": "wait7",
      "type": "wait",
      "label": "6 days",
      "minutes": 8640,
      "next": "day7"
     },
     {
      "id": "day7",
      "type": "email",
      "label": "Week 1 check-in",
      "templateKey": "host_week1",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "once"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Host approved → listing checklist → day-7 check-in."
   }
  },
  {
   "key": "post_stay_review",
   "title": "Post-stay review",
   "stage": "Stays",
   "why": "Reviews are what new guests trust most, and the day after check-out is when guests remember the stay best.",
   "templates": [
    "stay_post_review"
   ],
   "def": {
    "name": "Post-stay review",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "stay.booked"
    },
    "startStepId": "wait",
    "steps": [
     {
      "id": "wait",
      "type": "wait_until",
      "label": "Day after check-out",
      "field": "checkOutAt",
      "offsetMinutes": 1440,
      "next": "ask"
     },
     {
      "id": "ask",
      "type": "email",
      "label": "How was your stay?",
      "templateKey": "stay_post_review",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "always"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Booking confirmed → wait until the day after check-out → review request."
   }
  },
  {
   "key": "dining_reservation",
   "title": "Table booking reminder & review",
   "stage": "Dining",
   "why": "A reminder a few hours before cuts no-shows for the restaurant; a review ask after the meal builds trust for the next diner.",
   "templates": [
    "reservation_reminder",
    "dining_review"
   ],
   "def": {
    "name": "Table booking reminder & review",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "reservation.booked"
    },
    "startStepId": "before",
    "steps": [
     {
      "id": "before",
      "type": "wait_until",
      "label": "3 hours before",
      "field": "reservationAt",
      "offsetMinutes": -180,
      "next": "remind"
     },
     {
      "id": "remind",
      "type": "email",
      "label": "See you soon",
      "templateKey": "reservation_reminder",
      "next": "after"
     },
     {
      "id": "after",
      "type": "wait_until",
      "label": "3 hours after",
      "field": "reservationAt",
      "offsetMinutes": 180,
      "next": "review"
     },
     {
      "id": "review",
      "type": "email",
      "label": "How was the meal?",
      "templateKey": "dining_review",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "always"
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Table booked → reminder 3h before → review 3h after."
   }
  },
  {
   "key": "order_cancel_followup",
   "title": "Cancelled-order follow-up",
   "stage": "Retention",
   "why": "A cancelled order is the moment most likely to lose a customer. If they don't order again within a day, say sorry and point them to what's open.",
   "templates": [
    "order_cancel_followup"
   ],
   "def": {
    "name": "Cancelled-order follow-up",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "event",
     "event": "order.cancelled"
    },
    "startStepId": "wait",
    "steps": [
     {
      "id": "wait",
      "type": "wait_event",
      "label": "Give them a day to reorder",
      "event": "order.placed",
      "timeoutMinutes": 1440,
      "next": "done",
      "timeoutNext": "sorry"
     },
     {
      "id": "sorry",
      "type": "email",
      "label": "Sorry about that",
      "templateKey": "order_cancel_followup",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": {
     "event": "order.placed",
     "withinDays": 7
    },
    "exitOnGoal": true,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 30
    },
    "holdoutPercent": 10,
    "onlyOptedIn": true,
    "description": "Order cancelled → no new order in 24h → apology + what's open now."
   }
  },
  {
   "key": "gold_renewal",
   "title": "Kada Gold renewal reminder",
   "stage": "Memberships",
   "why": "Members who lapse by accident rarely come back. Three days' notice lets them renew before the benefits stop.",
   "templates": [
    "gold_expiring"
   ],
   "def": {
    "name": "Kada Gold renewal",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "segment",
     "conditions": [
      {
       "field": "userType",
       "op": "eq",
       "value": "CUSTOMER"
      },
      {
       "field": "goldEndsInDays",
       "op": "eq",
       "value": 3
      }
     ]
    },
    "startStepId": "remind",
    "steps": [
     {
      "id": "remind",
      "type": "email",
      "label": "Gold ends soon",
      "templateKey": "gold_expiring",
      "next": "push"
     },
     {
      "id": "push",
      "type": "push",
      "label": "Push reminder",
      "title": "Kada Gold ends {{goldEndsOn}}",
      "body": "Renew from Profile → Kada Gold to keep your benefits.",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 20
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Gold ends within 3 days → email + push. Dates synced daily by the autopilot."
   }
  },
  {
   "key": "mess_renewal",
   "title": "Mess plan renewal reminder",
   "stage": "Memberships",
   "why": "Mess subscribers eat every day; a gap in the plan means a day without lunch. Remind them three days before it ends.",
   "templates": [
    "mess_renewal"
   ],
   "def": {
    "name": "Mess plan renewal",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "segment",
     "conditions": [
      {
       "field": "userType",
       "op": "eq",
       "value": "CUSTOMER"
      },
      {
       "field": "messEndsInDays",
       "op": "eq",
       "value": 3
      }
     ]
    },
    "startStepId": "remind",
    "steps": [
     {
      "id": "remind",
      "type": "email",
      "label": "Plan ends soon",
      "templateKey": "mess_renewal",
      "next": "push"
     },
     {
      "id": "push",
      "type": "push",
      "label": "Push reminder",
      "title": "Your mess plan ends {{messEndsOn}}",
      "body": "Renew with {{messKitchen}} so meals keep coming.",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 20
    },
    "holdoutPercent": 0,
    "onlyOptedIn": false,
    "description": "Mess plan ends within 3 days → email + push. Dates synced daily by the autopilot."
   }
  },
  {
   "key": "champion_referral",
   "title": "Ask champions to refer",
   "stage": "Advocacy",
   "why": "Your most frequent customers are your best salespeople. Ask them, at most every four months, to invite friends from Refer & Earn.",
   "templates": [
    "referral_invite"
   ],
   "def": {
    "name": "Champion referral ask",
    "app": "customer",
    "userType": "CUSTOMER",
    "entry": {
     "type": "segment",
     "conditions": [
      {
       "field": "userType",
       "op": "eq",
       "value": "CUSTOMER"
      },
      {
       "field": "lifecycle",
       "op": "eq",
       "value": "champion"
      }
     ]
    },
    "startStepId": "ask",
    "steps": [
     {
      "id": "ask",
      "type": "email",
      "label": "Invite your friends",
      "templateKey": "referral_invite",
      "next": "done"
     },
     {
      "id": "done",
      "type": "exit",
      "label": "End"
     }
    ],
    "goal": null,
    "exitOnGoal": false,
    "exitEvents": [],
    "reentry": {
     "mode": "cooldown",
     "days": 120
    },
    "holdoutPercent": 10,
    "onlyOptedIn": true,
    "description": "10+ orders and ordered in the last 14 days → one referral invite every 4 months."
   }
  }
 ],
 "segmentFields": [
  {
   "key": "userType",
   "label": "User type",
   "kind": "userType"
  },
  {
   "key": "market",
   "label": "City (service market)",
   "kind": "market"
  },
  {
   "key": "zone",
   "label": "Service zone",
   "kind": "zone"
  },
  {
   "key": "city",
   "label": "City name (free text)",
   "kind": "text",
   "hint": "Kochi"
  },
  {
   "key": "lastVendor",
   "label": "Last ordered from",
   "kind": "vendor"
  },
  {
   "key": "language",
   "label": "Language",
   "kind": "text",
   "hint": "en"
  },
  {
   "key": "minOrders",
   "label": "At least N delivered orders",
   "kind": "number"
  },
  {
   "key": "maxOrders",
   "label": "At most N delivered orders",
   "kind": "number"
  },
  {
   "key": "inactiveDays",
   "label": "No order for N days (has ordered before)",
   "kind": "number"
  },
  {
   "key": "activeWithinDays",
   "label": "Ordered within the last N days",
   "kind": "number"
  },
  {
   "key": "joinedWithinDays",
   "label": "Joined within the last N days",
   "kind": "number"
  },
  {
   "key": "minSpend",
   "label": "Lifetime spend at least ₹",
   "kind": "number"
  },
  {
   "key": "minAov",
   "label": "Average order at least ₹",
   "kind": "number"
  },
  {
   "key": "tag",
   "label": "Has tag",
   "kind": "text"
  },
  {
   "key": "hasActiveSubscription",
   "label": "Active subscription",
   "kind": "boolean"
  },
  {
   "key": "lifecycle",
   "label": "Lifecycle stage",
   "kind": "choice",
   "options": [
    {
     "value": "new",
     "label": "New — joined in the last 14 days, no order yet"
    },
    {
     "value": "never_ordered",
     "label": "Never ordered — joined 14+ days ago"
    },
    {
     "value": "first_order",
     "label": "One order, in the last 30 days"
    },
    {
     "value": "active",
     "label": "Active — 2–4 orders, ordered in the last 30 days"
    },
    {
     "value": "loyal",
     "label": "Loyal — 5+ orders, ordered in the last 30 days"
    },
    {
     "value": "champion",
     "label": "Champion — 10+ orders, ordered in the last 14 days"
    },
    {
     "value": "at_risk",
     "label": "At risk — last order 31–60 days ago"
    },
    {
     "value": "lapsed",
     "label": "Lapsed — last order 61–120 days ago"
    },
    {
     "value": "lost",
     "label": "Lost — last order over 120 days ago"
    }
   ]
  },
  {
   "key": "marketingOptIn",
   "label": "Opted in to offers",
   "kind": "boolean"
  },
  {
   "key": "goldEndsInDays",
   "label": "Kada Gold ends within N days",
   "kind": "number",
   "hint": "Synced daily by the autopilot"
  },
  {
   "key": "messEndsInDays",
   "label": "Mess plan ends within N days",
   "kind": "number",
   "hint": "Synced daily by the autopilot"
  },
  {
   "key": "unengagedDays",
   "label": "Opted in, no open or click for N days",
   "kind": "number",
   "hint": "Counts from their last open, click or opt-in, whichever is latest"
  }
 ],
 "templates": [
  {
   "key": "welcome",
   "name": "Welcome",
   "category": "authentication"
  },
  {
   "key": "password_changed",
   "name": "Password changed",
   "category": "authentication"
  },
  {
   "key": "login_alert",
   "name": "New sign-in alert",
   "category": "authentication"
  },
  {
   "key": "order_confirmation",
   "name": "Order confirmed",
   "category": "orders"
  },
  {
   "key": "order_delivered",
   "name": "Order delivered",
   "category": "orders"
  },
  {
   "key": "order_cancelled",
   "name": "Order cancelled",
   "category": "orders"
  },
  {
   "key": "payment_success",
   "name": "Payment received",
   "category": "payments"
  },
  {
   "key": "refund_completed",
   "name": "Refund processed",
   "category": "payments"
  },
  {
   "key": "stay_booking_confirmed",
   "name": "Stay booking confirmed",
   "category": "orders"
  },
  {
   "key": "vendor_approved",
   "name": "Partner is live (vendor / mess)",
   "category": "vendor"
  },
  {
   "key": "rider_approved",
   "name": "Rider approved",
   "category": "rider"
  },
  {
   "key": "host_kyc_approved",
   "name": "Host property live",
   "category": "host"
  },
  {
   "key": "subscription_renewal",
   "name": "Subscription renewal reminder",
   "category": "subscriptions"
  },
  {
   "key": "support_ticket_created",
   "name": "Support ticket opened",
   "category": "support"
  },
  {
   "key": "promo_reengagement",
   "name": "We miss you (marketing)",
   "category": "marketing"
  },
  {
   "key": "first_order_nudge",
   "name": "First-order nudge (marketing)",
   "category": "marketing"
  },
  {
   "key": "first_order_last_nudge",
   "name": "First-order last nudge (marketing)",
   "category": "marketing"
  },
  {
   "key": "reorder_nudge",
   "name": "Second-order nudge (marketing)",
   "category": "marketing"
  },
  {
   "key": "review_request",
   "name": "Review request",
   "category": "orders"
  },
  {
   "key": "winback_last",
   "name": "Win-back last reminder (marketing)",
   "category": "marketing"
  },
  {
   "key": "sunset_check",
   "name": "Sunset check-in (marketing)",
   "category": "marketing"
  },
  {
   "key": "stay_pre_arrival",
   "name": "Stay pre-arrival",
   "category": "orders"
  },
  {
   "key": "partner_day1",
   "name": "Partner day-1 checklist",
   "category": "vendor"
  },
  {
   "key": "partner_week1",
   "name": "Partner week-1 check-in",
   "category": "vendor"
  },
  {
   "key": "rider_day1",
   "name": "Rider first shifts",
   "category": "rider"
  },
  {
   "key": "rider_week1",
   "name": "Rider week-1 check-in",
   "category": "rider"
  },
  {
   "key": "host_day1",
   "name": "Host listing checklist",
   "category": "host"
  },
  {
   "key": "host_week1",
   "name": "Host week-1 check-in",
   "category": "host"
  },
  {
   "key": "stay_post_review",
   "name": "Post-stay review",
   "category": "orders"
  },
  {
   "key": "reservation_reminder",
   "name": "Table booking reminder",
   "category": "orders"
  },
  {
   "key": "dining_review",
   "name": "Dine-in review",
   "category": "orders"
  },
  {
   "key": "order_cancel_followup",
   "name": "Cancelled-order follow-up (marketing)",
   "category": "marketing"
  },
  {
   "key": "gold_expiring",
   "name": "Kada Gold renewal reminder",
   "category": "subscriptions"
  },
  {
   "key": "mess_renewal",
   "name": "Mess plan renewal reminder",
   "category": "subscriptions"
  },
  {
   "key": "referral_invite",
   "name": "Referral invite (marketing)",
   "category": "marketing"
  },
  {
   "key": "occasion_kerala_piravi",
   "name": "Kerala Piravi (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_diwali",
   "name": "Diwali (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_childrens_day",
   "name": "Children's Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_christmas",
   "name": "Christmas (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_new_year",
   "name": "New Year's Eve (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_republic_day",
   "name": "Republic Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_ramadan",
   "name": "Ramadan begins (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_valentines",
   "name": "Valentine's Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_eid_fitr",
   "name": "Eid al-Fitr (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_holi",
   "name": "Holi (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_easter",
   "name": "Easter (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_ipl",
   "name": "IPL season starts (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_vishu",
   "name": "Vishu (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_mothers_day",
   "name": "Mother's Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_eid_adha",
   "name": "Bakrid (Eid al-Adha) (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_monsoon",
   "name": "Monsoon arrives (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_fathers_day",
   "name": "Father's Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_independence_day",
   "name": "Independence Day (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_onam",
   "name": "Onam (Thiruvonam) (occasion)",
   "category": "marketing"
  },
  {
   "key": "occasion_world_food_day",
   "name": "World Food Day (occasion)",
   "category": "marketing"
  }
 ]
};
