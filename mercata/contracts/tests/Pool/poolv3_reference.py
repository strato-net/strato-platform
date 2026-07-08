#!/usr/bin/env python3
"""Reference-value generator for PoolV3.test.sol.

Replicates Uniswap V3 core's integer math EXACTLY (TickMath, SqrtPriceMath,
SwapMath, tick-crossing swap loop) so the values pinned in the SolidVM tests
are, by construction, the values canonical UniswapV3Pool.sol produces.

Every hardcoded number in the tests comes from here. Rerun after any change:
    python3 poolv3_reference.py
"""

from decimal import Decimal, getcontext

getcontext().prec = 120

Q32 = 1 << 32
Q96 = 1 << 96
Q128 = 1 << 128
U256_MAX = (1 << 256) - 1

MIN_TICK = -887272
MAX_TICK = 887272

# The 20 magic constants from canonical TickMath.getSqrtRatioAtTick:
# constant k encodes sqrt(1.0001)^-(2^k) in Q128.128.
TICK_CONSTANTS = [
    0xFFFCB933BD6FAD37AA2D162D1A594001,
    0xFFF97272373D413259A46990580E213A,
    0xFFF2E50F5F656932EF12357CF3C7FDCC,
    0xFFE5CACA7E10E4E61C3624EAA0941CD0,
    0xFFCB9843D60F6159C9DB58835C926644,
    0xFF973B41FA98C081472E6896DFB254C0,
    0xFF2EA16466C96A3843EC78B326B52861,
    0xFE5DEE046A99A2A811C461F1969C3053,
    0xFCBE86C7900A88AEDCFFC83B479AA3A4,
    0xF987A7253AC413176F2B074CF7815E54,
    0xF3392B0822B70005940C7A398E4B70F3,
    0xE7159475A2C29B7443B29C7FA6E889D9,
    0xD097F3BDFD2022B8845AD8F792AA5825,
    0xA9F746462D870FDF8A65DC1F90E061E5,
    0x70D869A156D2A1B890BB3DF62BAF32F7,
    0x31BE135F97D08FD981231505542FCFA6,
    0x9AA508B5B7A84E1C677DE54F3E99BC9,
    0x5D6AF8DEDB81196699C329225EE604,
    0x2216E584F5FA1EA926041BEDFE98,
    0x48A170391F7DC42444E8FA2,
]


def validate_constants():
    """Each constant k must be within 1 ULP of 2^128 / sqrt(1.0001)^(2^k).

    The smallest constant has ~90 significant bits, so absolute agreement to
    < 1 unit in its own last place is the strongest possible check.
    """
    for k, c in enumerate(TICK_CONSTANTS):
        exact = Decimal(2) ** 128 / (Decimal("1.0001") ** (Decimal(2**k) / 2))
        assert abs(Decimal(c) - exact) < 1, (k, c, exact)
    print(f"# all {len(TICK_CONSTANTS)} TickMath constants within 1 ULP of 120-digit reference")


def get_sqrt_ratio_at_tick(tick: int) -> int:
    """Bit-exact port of TickMath.getSqrtRatioAtTick."""
    assert MIN_TICK <= tick <= MAX_TICK
    abs_tick = -tick if tick < 0 else tick

    ratio = TICK_CONSTANTS[0] if abs_tick & 1 else (1 << 128)
    for k in range(1, 20):
        if abs_tick & (1 << k):
            ratio = (ratio * TICK_CONSTANTS[k]) >> 128

    if tick > 0:
        ratio = U256_MAX // ratio

    # Q128.128 -> Q64.96, rounding up
    return (ratio >> 32) + (0 if ratio % Q32 == 0 else 1)


def get_tick_at_sqrt_ratio(sqrt_ratio_x96: int) -> int:
    """Spec: greatest tick whose ratio is <= the input (input in [MIN_RATIO, MAX_RATIO))."""
    assert get_sqrt_ratio_at_tick(MIN_TICK) <= sqrt_ratio_x96 < get_sqrt_ratio_at_tick(MAX_TICK)
    lo, hi = MIN_TICK, MAX_TICK
    while lo < hi:
        mid = (lo + hi + 1) // 2  # SolidVM floor division == Python //
        if get_sqrt_ratio_at_tick(mid) <= sqrt_ratio_x96:
            lo = mid
        else:
            hi = mid - 1
    return lo


def div_round_up(a: int, b: int) -> int:
    return -(-a // b)


def amount0_delta(sqrt_a: int, sqrt_b: int, liq: int, round_up: bool) -> int:
    """SqrtPriceMath.getAmount0Delta. ceil(ceil(n/b)/a) == ceil(n/(a*b)) so one exact div."""
    if sqrt_a > sqrt_b:
        sqrt_a, sqrt_b = sqrt_b, sqrt_a
    num = liq * Q96 * (sqrt_b - sqrt_a)
    den = sqrt_b * sqrt_a
    return div_round_up(num, den) if round_up else num // den


def amount1_delta(sqrt_a: int, sqrt_b: int, liq: int, round_up: bool) -> int:
    if sqrt_a > sqrt_b:
        sqrt_a, sqrt_b = sqrt_b, sqrt_a
    num = liq * (sqrt_b - sqrt_a)
    return div_round_up(num, Q96) if round_up else num // Q96


def next_sqrt_from_amount0_up(sqrt_p: int, liq: int, amount: int, add: bool) -> int:
    """SqrtPriceMath.getNextSqrtPriceFromAmount0RoundingUp (no-overflow path is exact)."""
    if amount == 0:
        return sqrt_p
    numerator1 = liq * Q96
    if add:
        return div_round_up(numerator1 * sqrt_p, numerator1 + amount * sqrt_p)
    product = amount * sqrt_p
    assert numerator1 > product, "insufficient liquidity for exact output"
    return div_round_up(numerator1 * sqrt_p, numerator1 - product)


def next_sqrt_from_amount1_down(sqrt_p: int, liq: int, amount: int, add: bool) -> int:
    if add:
        return sqrt_p + (amount * Q96) // liq
    quotient = div_round_up(amount * Q96, liq)
    assert sqrt_p > quotient
    return sqrt_p - quotient


def next_sqrt_from_input(sqrt_p: int, liq: int, amount_in: int, zero_for_one: bool) -> int:
    return (next_sqrt_from_amount0_up(sqrt_p, liq, amount_in, True) if zero_for_one
            else next_sqrt_from_amount1_down(sqrt_p, liq, amount_in, True))


def next_sqrt_from_output(sqrt_p: int, liq: int, amount_out: int, zero_for_one: bool) -> int:
    return (next_sqrt_from_amount1_down(sqrt_p, liq, amount_out, False) if zero_for_one
            else next_sqrt_from_amount0_up(sqrt_p, liq, amount_out, False))


def compute_swap_step(sqrt_current: int, sqrt_target: int, liq: int,
                      amount_remaining: int, fee_pips: int):
    """Bit-exact port of SwapMath.computeSwapStep."""
    zero_for_one = sqrt_current >= sqrt_target
    exact_in = amount_remaining >= 0

    if exact_in:
        amount_remaining_less_fee = (amount_remaining * (10**6 - fee_pips)) // 10**6
        amount_in = (amount0_delta(sqrt_target, sqrt_current, liq, True) if zero_for_one
                     else amount1_delta(sqrt_current, sqrt_target, liq, True))
        if amount_remaining_less_fee >= amount_in:
            sqrt_next = sqrt_target
        else:
            sqrt_next = next_sqrt_from_input(sqrt_current, liq, amount_remaining_less_fee, zero_for_one)
    else:
        amount_out = (amount1_delta(sqrt_target, sqrt_current, liq, False) if zero_for_one
                      else amount0_delta(sqrt_current, sqrt_target, liq, False))
        if -amount_remaining >= amount_out:
            sqrt_next = sqrt_target
        else:
            sqrt_next = next_sqrt_from_output(sqrt_current, liq, -amount_remaining, zero_for_one)

    is_max = sqrt_target == sqrt_next

    if zero_for_one:
        amount_in = (amount_in if is_max and exact_in
                     else amount0_delta(sqrt_next, sqrt_current, liq, True))
        amount_out = (amount_out if is_max and not exact_in
                      else amount1_delta(sqrt_next, sqrt_current, liq, False))
    else:
        amount_in = (amount_in if is_max and exact_in
                     else amount1_delta(sqrt_current, sqrt_next, liq, True))
        amount_out = (amount_out if is_max and not exact_in
                      else amount0_delta(sqrt_current, sqrt_next, liq, False))

    if not exact_in and amount_out > -amount_remaining:
        amount_out = -amount_remaining

    if exact_in and sqrt_next != sqrt_target:
        fee_amount = amount_remaining - amount_in  # remainder is fee
    else:
        fee_amount = div_round_up(amount_in * fee_pips, 10**6 - fee_pips)

    return sqrt_next, amount_in, amount_out, fee_amount


class Pool:
    """Minimal exact simulator: positions, ticks, bitmap-free next-tick, swap loop,
    platform lpShare fee routing (lpFee stays as Q128 fee growth, rest leaves)."""

    def __init__(self, fee_pips: int, tick_spacing: int, sqrt_price_x96: int, lp_share_bps: int = 7000):
        self.fee = fee_pips
        self.spacing = tick_spacing
        self.sqrt_price = sqrt_price_x96
        self.tick = get_tick_at_sqrt_ratio(sqrt_price_x96)
        self.liquidity = 0
        self.lp_share_bps = lp_share_bps
        self.ticks = {}  # tick -> [gross, net]
        self.fee_growth_global = [0, 0]  # Q128 per token
        self.protocol_fees = [0, 0]

    def mint(self, tick_lower: int, tick_upper: int, liq: int):
        for t, upper in ((tick_lower, False), (tick_upper, True)):
            g, n = self.ticks.get(t, (0, 0))
            self.ticks[t] = (g + liq, n - liq if upper else n + liq)
        amount0 = amount1 = 0
        sqrt_l, sqrt_u = get_sqrt_ratio_at_tick(tick_lower), get_sqrt_ratio_at_tick(tick_upper)
        if self.tick < tick_lower:
            amount0 = amount0_delta(sqrt_l, sqrt_u, liq, True)
        elif self.tick < tick_upper:
            amount0 = amount0_delta(self.sqrt_price, sqrt_u, liq, True)
            amount1 = amount1_delta(sqrt_l, self.sqrt_price, liq, True)
            self.liquidity += liq
        else:
            amount1 = amount1_delta(sqrt_l, sqrt_u, liq, True)
        return amount0, amount1

    def _next_tick(self, zero_for_one: bool):
        cands = [t for t, (g, _) in self.ticks.items() if g > 0]
        if zero_for_one:
            below = [t for t in cands if t <= self.tick]
            return (max(below), True) if below else (MIN_TICK, False)
        above = [t for t in cands if t > self.tick]
        return (min(above), True) if above else (MAX_TICK, False)

    def swap(self, zero_for_one: bool, amount_specified: int, sqrt_limit: int = 0):
        if sqrt_limit == 0:
            sqrt_limit = (get_sqrt_ratio_at_tick(MIN_TICK) + 1 if zero_for_one
                          else get_sqrt_ratio_at_tick(MAX_TICK) - 1)
        exact_in = amount_specified > 0
        remaining = amount_specified
        calculated = 0
        in_idx = 0 if zero_for_one else 1

        while remaining != 0 and self.sqrt_price != sqrt_limit:
            next_tick, initialized = self._next_tick(zero_for_one)
            sqrt_next_tick = get_sqrt_ratio_at_tick(next_tick)
            target = (sqrt_limit
                      if (sqrt_next_tick < sqrt_limit if zero_for_one else sqrt_next_tick > sqrt_limit)
                      else sqrt_next_tick)

            sqrt_after, step_in, step_out, step_fee = compute_swap_step(
                self.sqrt_price, target, self.liquidity, remaining, self.fee)

            if exact_in:
                remaining -= step_in + step_fee
                calculated -= step_out
            else:
                remaining += step_out
                calculated += step_in + step_fee

            lp_fee = (step_fee * self.lp_share_bps) // 10000
            self.protocol_fees[in_idx] += step_fee - lp_fee
            if lp_fee > 0 and self.liquidity > 0:
                self.fee_growth_global[in_idx] += (lp_fee * Q128) // self.liquidity

            self.sqrt_price = sqrt_after
            if sqrt_after == sqrt_next_tick:
                if initialized:
                    net = self.ticks[next_tick][1]
                    self.liquidity += -net if zero_for_one else net
                self.tick = next_tick - 1 if zero_for_one else next_tick
            elif sqrt_after != target or True:
                self.tick = get_tick_at_sqrt_ratio(sqrt_after)

        if exact_in:
            amount_in_total = amount_specified - remaining
            amount_out_total = -calculated
        else:
            amount_in_total = calculated
            amount_out_total = -(amount_specified - remaining)
        return amount_in_total, amount_out_total


E18 = 10**18


def main():
    validate_constants()
    print("MIN_SQRT_RATIO =", get_sqrt_ratio_at_tick(MIN_TICK))
    print("MAX_SQRT_RATIO =", get_sqrt_ratio_at_tick(MAX_TICK))
    print("Q96 (tick 0)   =", get_sqrt_ratio_at_tick(0))
    for t in (1, -1, 2, 60, -60, 100, -100, 1000, 10000, -10000, 887271, -887271):
        print(f"sqrtRatio({t}) =", get_sqrt_ratio_at_tick(t))

    # boundary behavior for getTickAtSqrtRatio
    s60 = get_sqrt_ratio_at_tick(60)
    print("tickAt(s60) / (s60-1) / (s60+1) =",
          get_tick_at_sqrt_ratio(s60), get_tick_at_sqrt_ratio(s60 - 1), get_tick_at_sqrt_ratio(s60 + 1))

    # maxLiquidityPerTick for default spacings (V3 Tick.tickSpacingToMaxLiquidityPerTick)
    for spacing in (10, 60, 200):
        min_t = div_round_up(MIN_TICK, spacing) * spacing if MIN_TICK % spacing else MIN_TICK
        min_t = -((887272 // spacing) * spacing)
        max_t = (887272 // spacing) * spacing
        num_ticks = (max_t - min_t) // spacing + 1
        print(f"maxLiquidityPerTick(spacing {spacing}) =", ((1 << 128) - 1) // num_ticks)

    # mint amounts: L=1000e18 over [-600,600) at price 1.0
    p = Pool(3000, 60, Q96)
    a0, a1 = p.mint(-600, 600, 1000 * E18)
    print("mint L=1000e18 [-600,600) @1.0: amount0 =", a0, "amount1 =", a1)

    # canonical single swap: L=100000e18 [-6000,6000], 10e18 exactIn zeroForOne, fee 3000
    p = Pool(3000, 60, Q96)
    p.mint(-6000, 6000, 100000 * E18)
    used, out = p.swap(True, 10 * E18)
    print("swap 10e18 exactIn: in =", used, "out =", out,
          "sqrtAfter =", p.sqrt_price, "tick =", p.tick)

    # staircase down: [-60,60) 100k, [-180,-60) 200k, [-300,-180) 300k; 2000e18 in
    p = Pool(3000, 60, Q96)
    p.mint(-60, 60, 100000 * E18)
    p.mint(-180, -60, 200000 * E18)
    p.mint(-300, -180, 300000 * E18)
    used, out = p.swap(True, 2000 * E18)
    print("staircase down: in =", used, "out =", out, "tick =", p.tick, "L =", p.liquidity)

    # staircase up mirror
    p = Pool(3000, 60, Q96)
    p.mint(-60, 60, 100000 * E18)
    p.mint(60, 180, 200000 * E18)
    p.mint(180, 300, 300000 * E18)
    used, out = p.swap(False, 2000 * E18)
    print("staircase up: in =", used, "out =", out, "tick =", p.tick, "L =", p.liquidity)

    # gap: [-60,60) and [-360,-240) 100k each; 500e18 in
    p = Pool(3000, 60, Q96)
    p.mint(-60, 60, 100000 * E18)
    p.mint(-360, -240, 100000 * E18)
    used, out = p.swap(True, 500 * E18)
    print("gap swap: in =", used, "out =", out, "tick =", p.tick, "L =", p.liquidity)

    # partial fill: [-60,60) 100k only; 1000e18 in
    p = Pool(3000, 60, Q96)
    dep0, dep1 = p.mint(-60, 60, 100000 * E18)
    used, out = p.swap(True, 1000 * E18)
    print("partial fill: deposited1 =", dep1, "consumed =", used, "out =", out,
          "tick =", p.tick, "sqrtAfter =", p.sqrt_price,
          "minSqrt+1 =", get_sqrt_ratio_at_tick(MIN_TICK) + 1)

    # exact output: L=100000e18 [-6000,6000]; want exactly 5e18 token1 out
    p = Pool(3000, 60, Q96)
    p.mint(-6000, 6000, 100000 * E18)
    used, out = p.swap(True, -5 * E18)
    print("exactOut 5e18: in =", used, "out =", out, "sqrtAfter =", p.sqrt_price, "tick =", p.tick)

    # exact output crossing a tick: want 200e18 token1 from staircase-down book
    p = Pool(3000, 60, Q96)
    p.mint(-60, 60, 100000 * E18)
    p.mint(-180, -60, 200000 * E18)
    used, out = p.swap(True, -200 * E18)
    print("exactOut 200e18 cross: in =", used, "out =", out, "tick =", p.tick, "L =", p.liquidity)

    # fee accounting reference: 100e18 exactIn at fee 3000, lpShare 7000, L=100000e18
    p = Pool(3000, 60, Q96)
    p.mint(-6000, 6000, 100000 * E18)
    used, out = p.swap(True, 100 * E18)
    owed = (100000 * E18 * p.fee_growth_global[0]) // Q128
    print("fees on 100e18: protocol0 =", p.protocol_fees[0],
          "feeGrowth0X128 =", p.fee_growth_global[0], "lpOwed0 =", owed)

    # round trip: 10e18 down then swap the output back up
    p = Pool(3000, 60, Q96)
    p.mint(-6000, 6000, 100000 * E18)
    _, out_b = p.swap(True, 10 * E18)
    _, back_a = p.swap(False, out_b)
    print("roundtrip: outB =", out_b, "backA =", back_a, "loss =", 10 * E18 - back_a)


if __name__ == "__main__":
    main()
