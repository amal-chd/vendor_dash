#!/usr/bin/env bash
# Migrate every function to the Node 22 runtime, in batches that stay
# within 8 of the 20 vCPU us-central1 ceiling so a deploy spike
# can't starve live traffic. Each firebase deploy is synchronous, and the
# sleep gives instances from the previous batch time to scale back down.
set -euo pipefail
PROJECT=kada-restaurant-os-v1

echo '── batch 1/16 — 14 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:acceptDeliveryOffer,functions:adminPlatformAction,functions:advanceDeliveryStage,functions:aggregateHotelDailyAnalytics,functions:aggregatorWebhook,functions:analyzeDailyOperations,functions:applyReferralCode,functions:approveCampaign,functions:approveReferralReward,functions:approveRider,functions:archiveTemplate,functions:assignAgentToThread,functions:awardLoyaltyPoints,functions:backfillOnboarding
sleep 45

echo '── batch 2/16 — 12 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:backfillZones,functions:broadcastNotification,functions:broadcastToCustomers,functions:calculateDeliveryFee,functions:calculatePricing,functions:cancelCampaign,functions:cancelMessSubscription,functions:cancelStayBooking,functions:changelogAdmin,functions:changelogEngage,functions:checkAvailability,functions:commsBackfillProfiles
sleep 45

echo '── batch 3/16 — 13 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:commsOverview,functions:completeDelivery,functions:convertThreadToTicket,functions:createAdBoost,functions:createCampaign,functions:createCodDepositOrder,functions:createKbArticle,functions:createOutletAccount,functions:createRazorpayOrder,functions:createStayBooking,functions:createSubscriptionOrder,functions:createTeam,functions:createTemplate
sleep 45

echo '── batch 4/16 — 13 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:createWalletTopupOrder,functions:customerCancelOrder,functions:declineDeliveryOffer,functions:deleteServiceZone,functions:deleteStayReview,functions:deleteTenantAccount,functions:disburseDonations,functions:disbursePayout,functions:dispatchDueScheduledOrders,functions:duplicateCampaign,functions:escalateSupportThread,functions:expireUnpaidOnlineOrders,functions:fixRiderEarnings
sleep 45

echo '── batch 5/16 — 15 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:flagUnverifiedStayBooking,functions:generateCampaignPlan,functions:generateGstReport,functions:generateMenuFromPromptOrImage,functions:generateMessSettlements,functions:generateMultiAppContent,functions:generateNotificationContent,functions:generateRecipe,functions:generateVendorSettlements,functions:geocodeAddress,functions:getActivationBlockers,functions:getAgentAiAssistant,functions:getAiAuditLog,functions:getAiRecommendations,functions:getCodReconciliation
sleep 45

echo '── batch 6/16 — 14 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:getEarningsBreakdown,functions:getEmailPreferences,functions:getFinanceSummary,functions:getMyReferral,functions:getOnboardingState,functions:getPayoutConfig,functions:getPlanCatalog,functions:getPopularStays,functions:getReconciliationReport,functions:getSimilarStays,functions:getSubscriptionStatus,functions:hotelSubscriptionExpiryCron,functions:indexHotelGeohash,functions:listAiAuditLogs
sleep 45

echo '── batch 7/16 — 15 functions, 7.67 vCPU'
firebase deploy --project "$PROJECT" --only functions:migrateLegacyTrials,functions:notifyReservationBooking,functions:notifyVendorNewOrder,functions:onAdminNotificationBroadcasted,functions:onAdminNotificationCreated,functions:onboardingExpirySweep,functions:onCustomerProfileLocationChanged,functions:onEmailEventCreated,functions:onHostAssistMessageCreated,functions:onHostBankChanged,functions:onHostCreatedInitOnboarding,functions:onMessKitchenBankChanged,functions:onMessKitchenCreatedInitOnboarding,functions:onNotificationCreated,functions:onNotificationJobCreated
sleep 45

echo '── batch 8/16 — 16 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:onOrderCancelledFreeRider,functions:onOrderCompleted,functions:onOrderDepleteStock,functions:onOrderDonation,functions:onOrderEmail,functions:onOrderFinishedEnsureEarnings,functions:onOrderPaymentConfirmed,functions:onOrderPlacedAssignRider,functions:onOrderReleasedDispatch,functions:onOrderStampZone,functions:onReferralQualifyingOrder,functions:onRestaurantLocationChanged,functions:onReviewWritten,functions:onRiderBankChanged,functions:onRiderCreatedInitOnboarding,functions:onSupportAgentReply
sleep 45

echo '── batch 9/16 — 14 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:onSupportMessageCreated,functions:onVendorBankChanged,functions:onVendorCreatedInitOnboarding,functions:optimizeMenuItem,functions:payOrderWithWallet,functions:placeDetails,functions:placeFoodOrder,functions:placesAutocomplete,functions:pollBankValidation,functions:previewKbRetrieval,functions:previewZone,functions:pricingAdmin,functions:processCampaigns,functions:processRazorpayWebhook
sleep 45

echo '── batch 10/16 — 13 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:processScheduledCampaigns,functions:processScheduledOrders,functions:provisionStaffAccount,functions:publishDueChangelog,functions:publishTemplate,functions:purchaseGiftCard,functions:purchaseGoldMembership,functions:quoteFoodOrder,functions:quoteStayBooking,functions:quoteStayCancellation,functions:rateSupportThread,functions:razorpayWebhook,functions:readKycDocument
sleep 45

echo '── batch 11/16 — 15 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:reassignDelivery,functions:reassignExpiredOffers,functions:recommendSchedule,functions:recomputeOpsHealth,functions:reconcilePricingDaily,functions:redeemGiftCard,functions:redeemLoyaltyPoints,functions:reembedKbArticles,functions:refreshOpsHealth,functions:rejectRider,functions:releaseOrderForPickup,functions:replyToStayReview,functions:requestRiderPayout,functions:requestVendorPayout,functions:resendWebhook
sleep 45

echo '── batch 12/16 — 15 functions, 7.50 vCPU'
firebase deploy --project "$PROJECT" --only functions:resetDailyEarnings,functions:resetMonthlyEarnings,functions:resetWeeklyEarnings,functions:resolveOnboardingZone,functions:resolveSupportThread,functions:resolveZone,functions:retryFailedEmails,functions:retryFailedNotifications,functions:reverseReferralReward,functions:revokeAllSessions,functions:revokeSession,functions:revokeStaffAccount,functions:scheduledGatewaySync,functions:sealPartnerPrivateData,functions:searchKbArticles
sleep 45

echo '── batch 13/16 — 14 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:searchStays,functions:seedEmailTemplates,functions:seedKnowledgeBase,functions:seedSupportMacros,functions:sendCampaign,functions:sendDailySummary,functions:sendTestEmail,functions:setAdminRole,functions:setEntityZone,functions:settleRiderCash,functions:settleRiderPayout,functions:settleVendorPayout,functions:skipMessDay,functions:slaSweep
sleep 45

echo '── batch 14/16 — 14 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:smartAiSearch,functions:submitBankDetails,functions:submitForApproval,functions:submitOnboarding,functions:submitOnboardingStep,functions:submitStayReview,functions:subscribeDeviceToTopic,functions:subscribeToMess,functions:suspendRider,functions:sweepMessSubscriptions,functions:sweepStuckDeliveries,functions:syncFoodStudioPresets,functions:syncGatewaySettlements,functions:translateNotificationContent
sleep 45

echo '── batch 15/16 — 12 functions, 8.00 vCPU'
firebase deploy --project "$PROJECT" --only functions:unsubscribeAll,functions:updateCampaign,functions:updateEmailPreferences,functions:updateKbArticle,functions:updatePlanCatalog,functions:updateTemplate,functions:upsertServiceZone,functions:vendorTransitionOrder,functions:verifyBankAccount,functions:verifyMessPayment,functions:verifyRazorpayPayment,functions:verifyStayPayment
sleep 45

echo '── batch 16/16 — 2 functions, 1.50 vCPU'
firebase deploy --project "$PROJECT" --only functions:verifyWalletTopup,functions:vetCustomerOrder

echo 'All batches deployed.'
