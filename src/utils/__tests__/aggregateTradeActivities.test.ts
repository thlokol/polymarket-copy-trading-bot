import { aggregateTradeActivities } from '../aggregateTradeActivities';

describe('aggregateTradeActivities', () => {
    it('aggregates multiple fills in the same tx with weighted average price', () => {
        const activities = [
            {
                transactionHash: '0xabc',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 100,
                size: 10,
                usdcSize: 5,
                price: 0.5,
            },
            {
                transactionHash: '0xabc',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 101,
                size: 20,
                usdcSize: 5,
                price: 0.25,
            },
        ];

        const aggregated = aggregateTradeActivities(activities);
        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].size).toBeCloseTo(30);
        expect(aggregated[0].usdcSize).toBeCloseTo(10);
        expect(aggregated[0].price).toBeCloseTo(10 / 30);
        expect(aggregated[0].fillCount).toBe(2);
        expect(aggregated[0].minPrice).toBeCloseTo(0.25);
        expect(aggregated[0].maxPrice).toBeCloseTo(0.5);
        expect(aggregated[0].firstFillTimestamp).toBe(100);
        expect(aggregated[0].lastFillTimestamp).toBe(101);
        expect(aggregated[0].timestamp).toBe(101);
    });

    it('normalizes signed size/usdcSize using abs()', () => {
        const aggregated = aggregateTradeActivities([
            {
                transactionHash: '0xdef',
                conditionId: '0xcond',
                asset: 'token',
                side: 'SELL',
                type: 'TRADE',
                timestamp: 200,
                size: -10,
                usdcSize: -3.5,
                price: 0.35,
            },
        ]);

        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].size).toBeCloseTo(10);
        expect(aggregated[0].usdcSize).toBeCloseTo(3.5);
        expect(aggregated[0].price).toBeCloseTo(0.35);
    });

    it('dedupes only when an explicit id-like field exists', () => {
        const aggregated = aggregateTradeActivities([
            {
                id: 'fill-1',
                transactionHash: '0xaaa',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 300,
                size: 10,
                usdcSize: 5,
                price: 0.5,
            },
            {
                id: 'fill-1',
                transactionHash: '0xaaa',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 300,
                size: 10,
                usdcSize: 5,
                price: 0.5,
            },
            {
                // No id: should not be deduped by fingerprint.
                transactionHash: '0xaaa',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 301,
                size: 10,
                usdcSize: 5,
                price: 0.5,
            },
        ]);

        expect(aggregated).toHaveLength(1);
        expect(aggregated[0].fillCount).toBe(2);
        expect(aggregated[0].size).toBeCloseTo(20);
        expect(aggregated[0].usdcSize).toBeCloseTo(10);
    });

    it('does not aggregate across entries missing transactionHash', () => {
        const aggregated = aggregateTradeActivities([
            {
                transactionHash: '',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 400,
                size: 1,
                usdcSize: 0.4,
                price: 0.4,
            },
            {
                transactionHash: '',
                conditionId: '0xcond',
                asset: 'token',
                side: 'BUY',
                type: 'TRADE',
                timestamp: 401,
                size: 1,
                usdcSize: 0.4,
                price: 0.4,
            },
        ]);

        expect(aggregated).toHaveLength(2);
    });
});

