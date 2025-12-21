import { getBuyDecision } from '../buySlippagePolicy';

describe('getBuyDecision', () => {
    it('rejects invalid original price', () => {
        const decision = getBuyDecision(0);
        expect(decision.shouldBuy).toBe(false);
    });

    it('accepts numeric strings defensively', () => {
        const decision = getBuyDecision('0.5');
        expect(decision.shouldBuy).toBe(true);
        if (decision.shouldBuy) {
            expect(decision.maxAcceptablePrice).toBeCloseTo(0.53);
        }
    });

    it('rejects death zone (> 0.95)', () => {
        const decision = getBuyDecision(0.951);
        expect(decision.shouldBuy).toBe(false);
    });

    it('high zone uses +0.01 cap', () => {
        const decision = getBuyDecision(0.9);
        expect(decision.shouldBuy).toBe(true);
        if (decision.shouldBuy) {
            expect(decision.maxAcceptablePrice).toBeCloseTo(0.91);
        }
    });

    it('caps max acceptable price at 0.99 by default', () => {
        const decision = getBuyDecision(0.95, {
            deathZonePrice: 1.0, // allow it to reach the cap path
            highZoneMin: 0.8,
            highZoneAbsSlippage: 0.1,
        });
        expect(decision.shouldBuy).toBe(true);
        if (decision.shouldBuy) {
            expect(decision.maxAcceptablePrice).toBeCloseTo(0.99);
        }
    });

    it('combat zone uses +0.03 cap', () => {
        const decision = getBuyDecision(0.5);
        expect(decision.shouldBuy).toBe(true);
        if (decision.shouldBuy) {
            expect(decision.maxAcceptablePrice).toBeCloseTo(0.53);
        }
    });

    it('zebra zone uses proportional cap (x1.2)', () => {
        const decision = getBuyDecision(0.05);
        expect(decision.shouldBuy).toBe(true);
        if (decision.shouldBuy) {
            expect(decision.maxAcceptablePrice).toBeCloseTo(0.06);
        }
    });
});
