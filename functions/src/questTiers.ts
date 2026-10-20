/**
 * Rider Daily Quest — a ladder of milestones, each paid once per day when
 * reached. The rider app (delivery_mobile_app/lib/models/quest_tier.dart)
 * shows every rung and promises their SUM ("up to ₹700"); the server used to
 * pay only the top rung's bonus, at the top rung's trip count. This module is
 * the single server definition and mirrors the app's parsing exactly.
 *
 * Pure: no Firebase imports.
 */
export interface QuestTier {
  trips: number;
  bonus: number;
}

/** Same rules as QuestTier.parse in the rider app. */
export function parseQuestTiers(settings: Record<string, unknown>): QuestTier[] {
  const raw = settings.questTiers;
  if (Array.isArray(raw) && raw.length > 0) {
    const tiers = raw
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({ trips: Math.trunc(Number(m.trips) || 0), bonus: Math.trunc(Number(m.bonus) || 0) }))
      .filter((t) => t.trips > 0)
      .sort((a, b) => a.trips - b.trips);
    if (tiers.length > 0) return tiers;
  }
  // Legacy single target/bonus → the app's synthesized 40% / 75% / 100% ladder.
  const target = Math.trunc(Number(settings.questTarget) || 8);
  const bonus = Math.trunc(Number(settings.questBonus) || 150);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const t1 = clamp(Math.round(target * 0.4), 1, target);
  const t2 = clamp(Math.round(target * 0.75), t1 + 1, target);
  return [
    { trips: t1, bonus: Math.round(bonus * 0.2) },
    { trips: t2, bonus: Math.round(bonus * 0.55) },
    { trips: target, bonus },
  ];
}

/**
 * Rungs to pay on this delivery: reached today and not yet paid today.
 * `awardedToday` holds the trip counts of rungs already paid today.
 */
export function tiersToAward(tiers: QuestTier[], deliveriesToday: number, awardedToday: number[]): QuestTier[] {
  const paid = new Set(awardedToday);
  return tiers.filter((t) => t.bonus > 0 && t.trips <= deliveriesToday && !paid.has(t.trips));
}

/**
 * Rungs already paid today, from the rider doc. A rider paid under the old
 * single-bonus scheme earlier today counts as having every rung paid, so the
 * switch-over day can't pay twice.
 */
export function awardedTodayFrom(rider: Record<string, unknown>, todayIst: string, tiers: QuestTier[]): number[] {
  if (rider.questTiersAwardedDate === todayIst && Array.isArray(rider.questTiersAwarded)) {
    return (rider.questTiersAwarded as unknown[]).map((n) => Number(n)).filter(Number.isFinite);
  }
  if (rider.questAwardedDate === todayIst) return tiers.map((t) => t.trips);
  return [];
}
