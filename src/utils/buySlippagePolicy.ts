export type BuyDecision =
    | { shouldBuy: true; maxAcceptablePrice: number; reason: string }
    | { shouldBuy: false; maxAcceptablePrice: null; reason: string };

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Dynamic slippage policy for BUY orders based on the original executed price.
 *
 * Rationale:
 * - Very high prices near $1.00 offer little upside and can be noisy (MM/arbitrage).
 * - Mid-range prices can tolerate a small absolute slippage.
 * - Very low prices require proportional slippage to avoid paying 2x+.
 */
export const getBuyDecision = (
    originalExecutedPrice: number | string,
    config?: Partial<{
        deathZonePrice: number; // above this: never buy
        highZoneMin: number; // >= this: strict absolute slippage
        highZoneAbsSlippage: number;
        combatZoneMin: number; // >= this: moderate absolute slippage
        combatZoneAbsSlippage: number;
        zebraZoneMaxMultiplier: number; // below combatZoneMin: proportional cap
        absoluteMaxAcceptablePriceCap: number; // safety cap on maxAcceptablePrice
    }>
): BuyDecision => {
    const deathZonePrice = config?.deathZonePrice ?? 0.95;
    const highZoneMin = config?.highZoneMin ?? 0.8;
    const highZoneAbsSlippage = config?.highZoneAbsSlippage ?? 0.01;
    const combatZoneMin = config?.combatZoneMin ?? 0.2;
    const combatZoneAbsSlippage = config?.combatZoneAbsSlippage ?? 0.03;
    const zebraZoneMaxMultiplier = config?.zebraZoneMaxMultiplier ?? 1.2;
    const absoluteMaxAcceptablePriceCap = config?.absoluteMaxAcceptablePriceCap ?? 0.99;

    const priceNum = Number(originalExecutedPrice);

    if (!isFinitePositive(priceNum)) {
        return {
            shouldBuy: false,
            maxAcceptablePrice: null,
            reason: `invalid original price (${String(originalExecutedPrice)})`,
        };
    }

    const capMax = (value: number): number => {
        if (!Number.isFinite(absoluteMaxAcceptablePriceCap) || absoluteMaxAcceptablePriceCap <= 0) {
            return value;
        }
        return Math.min(value, absoluteMaxAcceptablePriceCap);
    };

    if (priceNum > deathZonePrice) {
        return {
            shouldBuy: false,
            maxAcceptablePrice: null,
            reason: `death zone: original price ${priceNum.toFixed(4)} > ${deathZonePrice.toFixed(4)}`,
        };
    }

    if (priceNum >= highZoneMin) {
        const maxAcceptablePrice = capMax(priceNum + highZoneAbsSlippage);
        return {
            shouldBuy: true,
            maxAcceptablePrice,
            reason: `high zone: +${highZoneAbsSlippage.toFixed(4)} cap`,
        };
    }

    if (priceNum >= combatZoneMin) {
        const maxAcceptablePrice = capMax(priceNum + combatZoneAbsSlippage);
        return {
            shouldBuy: true,
            maxAcceptablePrice,
            reason: `combat zone: +${combatZoneAbsSlippage.toFixed(4)} cap`,
        };
    }

    const maxAcceptablePrice = capMax(priceNum * zebraZoneMaxMultiplier);
    return {
        shouldBuy: true,
        maxAcceptablePrice,
        reason: `zebra zone: x${zebraZoneMaxMultiplier.toFixed(2)} cap`,
    };
};
