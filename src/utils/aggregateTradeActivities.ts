const toNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

class KahanSum {
    private sum = 0;
    private c = 0;

    add(value: number): void {
        if (!Number.isFinite(value) || value === 0) return;
        const y = value - this.c;
        const t = this.sum + y;
        this.c = t - this.sum - y;
        this.sum = t;
    }

    value(): number {
        return this.sum;
    }
}

const findActivityId = (activity: any): string | null => {
    const candidates = [
        activity?.id,
        activity?.tradeId,
        activity?.trade_id,
        activity?.matchId,
        activity?.match_id,
        activity?.logIndex,
        activity?.log_index,
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const value = String(candidate);
        if (value.length > 0 && value !== 'null' && value !== 'undefined') return value;
    }

    return null;
};

/**
 * Polymarket Data API `activity?type=TRADE` returns executed trades (fills).
 *
 * One on-chain settlement transaction can include multiple fills at different prices,
 * returned as multiple rows with the same `transactionHash`.
 *
 * This function aggregates fills per (txHash, conditionId, asset, side, type) into a single
 * executed trade with:
 * - size: sum(abs(size))
 * - usdcSize: sum(abs(usdcSize))
 * - price: weighted average = sumUsdc / sumSize
 *
 * Robustness:
 * - If size/usdcSize ever come signed, we normalize using abs() and keep direction via `side`.
 * - Uses Kahan summation to reduce floating-point drift without new dependencies.
 * - Dedupes only when the API provides an explicit fill identifier (id/tradeId/matchId/logIndex).
 */
export const aggregateTradeActivities = (activities: any[]): any[] => {
    const groups = new Map<
        string,
        {
            base: any;
            sumSize: KahanSum;
            sumUsdc: KahanSum;
            fillCount: number;
            minPrice: number | null;
            maxPrice: number | null;
            firstFillTimestamp: number;
            lastFillTimestamp: number;
            seenIds: Set<string>;
        }
    >();

    let noTxCounter = 0;

    for (const activity of activities) {
        const transactionHash = String(activity?.transactionHash || '');
        const conditionId = String(activity?.conditionId || '');
        const asset = String(activity?.asset || '');
        const side = String(activity?.side || '');
        const type = String(activity?.type || '');

        // If the tx hash is missing, do not aggregate across entries (treat each as unique).
        const txKey = transactionHash.length > 0 ? transactionHash : `no_tx:${noTxCounter++}`;
        const key = `${txKey}:${conditionId}:${asset}:${side}:${type}`;

        const size = Math.abs(toNumber(activity?.size, 0));
        const usdcSize = Math.abs(toNumber(activity?.usdcSize, 0));
        const price = toNumber(activity?.price, 0);
        const timestamp = toNumber(activity?.timestamp, 0);

        const existing = groups.get(key);
        if (!existing) {
            const sumSize = new KahanSum();
            const sumUsdc = new KahanSum();
            sumSize.add(size);
            sumUsdc.add(usdcSize);

            const seenIds = new Set<string>();
            const activityId = findActivityId(activity);
            if (activityId) seenIds.add(activityId);

            groups.set(key, {
                base: { ...activity },
                sumSize,
                sumUsdc,
                fillCount: 1,
                minPrice: Number.isFinite(price) && price > 0 ? price : null,
                maxPrice: Number.isFinite(price) && price > 0 ? price : null,
                firstFillTimestamp: timestamp || 0,
                lastFillTimestamp: timestamp || 0,
                seenIds,
            });
            continue;
        }

        const activityId = findActivityId(activity);
        if (activityId) {
            if (existing.seenIds.has(activityId)) {
                continue;
            }
            existing.seenIds.add(activityId);
        }

        existing.sumSize.add(size);
        existing.sumUsdc.add(usdcSize);
        existing.fillCount += 1;

        if (timestamp) {
            if (!existing.firstFillTimestamp || timestamp < existing.firstFillTimestamp) {
                existing.firstFillTimestamp = timestamp;
            }
            if (!existing.lastFillTimestamp || timestamp > existing.lastFillTimestamp) {
                existing.lastFillTimestamp = timestamp;
            }
        }

        if (Number.isFinite(price) && price > 0) {
            if (existing.minPrice === null || price < existing.minPrice) existing.minPrice = price;
            if (existing.maxPrice === null || price > existing.maxPrice) existing.maxPrice = price;
        }
    }

    const results: any[] = [];
    for (const group of groups.values()) {
        const sumSize = group.sumSize.value();
        const sumUsdc = group.sumUsdc.value();
        const averagePrice =
            sumSize > 0 ? sumUsdc / sumSize : toNumber(group.base?.price, 0);

        const lastTs = group.lastFillTimestamp || toNumber(group.base?.timestamp, 0);

        results.push({
            ...group.base,
            size: sumSize,
            usdcSize: sumUsdc,
            price: averagePrice,
            timestamp: lastTs,
            fillCount: group.fillCount,
            minPrice: group.minPrice ?? toNumber(group.base?.price, 0),
            maxPrice: group.maxPrice ?? toNumber(group.base?.price, 0),
            firstFillTimestamp: group.firstFillTimestamp || toNumber(group.base?.timestamp, 0),
            lastFillTimestamp: lastTs,
        });
    }

    return results;
};

