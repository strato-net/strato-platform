#!/usr/bin/env python3
"""Generate PoolV3UniswapSwaps.test.sol from Uniswap v3-core's own golden snapshots.

Replays the 240 cases of v3-core/test/__snapshots__/UniswapV3Pool.swaps.spec.ts.snap
(15 pool configs x 16 swap cases) against the SolidVM PoolV3 port. With
lpSharePercent = 10000 the pool keeps 100%% of fees as LP fee growth, which is
exactly canonical with feeProtocol = 0 -- the configuration the snapshots were
generated with -- so every integer output must match bit for bit.

Platform-divergent cases (canonical accepts an exact-input swap that produces
zero output; the port's slippage floor rejects it) are emitted as expected
reverts and marked PLATFORM.

Usage: python3 gen_uniswap_swaps.py /path/to/v3-core > PoolV3UniswapSwaps.test.sol
"""

import re
import sys
from decimal import Decimal, getcontext, ROUND_HALF_UP, ROUND_FLOOR

getcontext().prec = 200

Q96 = 1 << 96
MIN_SQRT_RATIO = 4295128739
MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342
INT256_MAX = (1 << 255) - 1
E18 = 10**18


def bn_round40(x: Decimal) -> Decimal:
    """bignumber.js DECIMAL_PLACES=40, ROUNDING_MODE=4 (half-up)."""
    return x.quantize(Decimal(1).scaleb(-40), rounding=ROUND_HALF_UP)


def encode_price_sqrt(reserve1: int, reserve0: int) -> int:
    """Replicates utilities.ts encodePriceSqrt: div and sqrt each rounded to 40dp,
    then multiplied by 2^96 and floored (integerValue(3))."""
    d = bn_round40(Decimal(reserve1) / Decimal(reserve0))
    s = bn_round40(d.sqrt())
    return int((s * Q96).to_integral_value(rounding=ROUND_FLOOR))


def get_min_tick(spacing: int) -> int:
    return -((887272 // spacing) * spacing)


def get_max_tick(spacing: int) -> int:
    return (887272 // spacing) * spacing


def get_max_liquidity_per_tick(spacing: int) -> int:
    num_ticks = (get_max_tick(spacing) - get_min_tick(spacing)) // spacing + 1
    return ((1 << 128) - 1) // num_ticks


# ---- pool configs, transcribed from UniswapV3Pool.swaps.spec.ts TEST_POOLS ----

def full_range(spacing, liq):
    return [(get_min_tick(spacing), get_max_tick(spacing), liq)]


POOLS = [
    ("low fee, 1:1 price, 2e18 max range liquidity", 500, 10, encode_price_sqrt(1, 1), full_range(10, 2 * E18)),
    ("medium fee, 1:1 price, 2e18 max range liquidity", 3000, 60, encode_price_sqrt(1, 1), full_range(60, 2 * E18)),
    ("high fee, 1:1 price, 2e18 max range liquidity", 10000, 200, encode_price_sqrt(1, 1), full_range(200, 2 * E18)),
    ("medium fee, 10:1 price, 2e18 max range liquidity", 3000, 60, encode_price_sqrt(10, 1), full_range(60, 2 * E18)),
    ("medium fee, 1:10 price, 2e18 max range liquidity", 3000, 60, encode_price_sqrt(1, 10), full_range(60, 2 * E18)),
    ("medium fee, 1:1 price, 0 liquidity, all liquidity around current price", 3000, 60, encode_price_sqrt(1, 1),
     [(get_min_tick(60), -60, 2 * E18), (60, get_max_tick(60), 2 * E18)]),
    ("medium fee, 1:1 price, additional liquidity around current price", 3000, 60, encode_price_sqrt(1, 1),
     [(get_min_tick(60), get_max_tick(60), 2 * E18),
      (get_min_tick(60), -60, 2 * E18),
      (60, get_max_tick(60), 2 * E18)]),
    ("low fee, large liquidity around current price (stable swap)", 500, 10, encode_price_sqrt(1, 1),
     [(-10, 10, 2 * E18)]),
    ("medium fee, token0 liquidity only", 3000, 60, encode_price_sqrt(1, 1), [(0, 2000 * 60, 2 * E18)]),
    ("medium fee, token1 liquidity only", 3000, 60, encode_price_sqrt(1, 1), [(-2000 * 60, 0, 2 * E18)]),
    ("close to max price", 3000, 60, encode_price_sqrt(1 << 127, 1), full_range(60, 2 * E18)),
    ("close to min price", 3000, 60, encode_price_sqrt(1, 1 << 127), full_range(60, 2 * E18)),
    ("max full range liquidity at 1:1 price with default fee", 3000, 60, encode_price_sqrt(1, 1),
     full_range(60, get_max_liquidity_per_tick(60))),
    ("initialized at the max ratio", 3000, 60, MAX_SQRT_RATIO - 1, full_range(60, 2 * E18)),
    ("initialized at the min ratio", 3000, 60, MIN_SQRT_RATIO, full_range(60, 2 * E18)),
]

# ---- swap cases, transcribed from DEFAULT_POOL_SWAP_TESTS (descriptions must
#      reproduce swapCaseToDescription + format.ts exactly: they are snapshot keys) ----

P_HALF = encode_price_sqrt(50, 100)
P_TWO = encode_price_sqrt(200, 100)
P_5_2 = encode_price_sqrt(5, 2)
P_2_5 = encode_price_sqrt(2, 5)

ONE = "1.0000"
DUST = "0.0000000000000010000"

CASES = [
    (f"swap exactly {ONE} token0 for token1", "exactIn", True, E18, None),
    (f"swap exactly {ONE} token1 for token0", "exactIn", False, E18, None),
    (f"swap token0 for exactly {ONE} token1", "exactOut", True, E18, None),
    (f"swap token1 for exactly {ONE} token0", "exactOut", False, E18, None),
    (f"swap exactly {ONE} token0 for token1 to price 0.50000", "exactIn", True, E18, P_HALF),
    (f"swap exactly {ONE} token1 for token0 to price 2.0000", "exactIn", False, E18, P_TWO),
    (f"swap token0 for exactly {ONE} token1 to price 0.50000", "exactOut", True, E18, P_HALF),
    (f"swap token1 for exactly {ONE} token0 to price 2.0000", "exactOut", False, E18, P_TWO),
    (f"swap exactly {DUST} token0 for token1", "exactIn", True, 1000, None),
    (f"swap exactly {DUST} token1 for token0", "exactIn", False, 1000, None),
    (f"swap token0 for exactly {DUST} token1", "exactOut", True, 1000, None),
    (f"swap token1 for exactly {DUST} token0", "exactOut", False, 1000, None),
    ("swap token1 for token0 to price 2.5000", "toPrice", False, None, P_5_2),
    ("swap token0 for token1 to price 0.40000", "toPrice", True, None, P_2_5),
    ("swap token0 for token1 to price 2.5000", "toPrice", True, None, P_5_2),
    ("swap token1 for token0 to price 0.40000", "toPrice", False, None, P_2_5),
]


def parse_snapshots(path: str) -> dict:
    text = open(path).read()
    entries = {}
    for m in re.finditer(r"exports\[`(.+?)`\] = `\nObject \{\n(.*?)\n\}\n`;", text, re.S):
        key, body = m.group(1), m.group(2)
        fields = {}
        for fm in re.finditer(r'"(\w+)": (?:"([^"]*)"|(-?\d+)),', body):
            name = fm.group(1)
            fields[name] = fm.group(2) if fm.group(2) is not None else fm.group(3)
        entries[key] = fields
    return entries


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "/tmp/v3-core"
    snaps = parse_snapshots(f"{repo}/test/__snapshots__/UniswapV3Pool.swaps.spec.ts.snap")

    funcs = []
    n_ok = n_err = n_platform = 0

    for pi, (pool_desc, fee, spacing, price, positions) in enumerate(POOLS):
        for ci, (case_desc, kind, zero_for_one, amount, limit) in enumerate(CASES):
            key = f"UniswapV3Pool swap tests {pool_desc} {case_desc} 1"
            snap = snaps.get(key)
            assert snap is not None, f"missing snapshot: {key}"

            name = f"it_p{pi:02d}_c{ci:02d}"
            lines = []
            lines.append(f"    // {pool_desc} | {case_desc}")
            lines.append(f"    function {name}() {{")
            lines.append(f"        _setupPool({fee}, {price});")
            for (lo, hi, liq) in positions:
                lines.append(f"        _mint({lo}, {hi}, {liq});")

            if kind == "exactIn":
                amount_specified = amount
                amount_limit = 1
            elif kind == "exactOut":
                amount_specified = -amount
                amount_limit = "MAXIN"
            else:  # toPrice: canonical callee passes type(int256).max exact input
                amount_specified = "INT256_MAX"
                amount_limit = 1
            limit_val = limit if limit is not None else (MIN_SQRT_RATIO + 1 if zero_for_one else MAX_SQRT_RATIO - 1)
            zf1 = "true" if zero_for_one else "false"

            if "swapError" in snap:
                # canonical reverts (SPL etc.); before-state still pinned
                lines.append(f"        _checkBefore({snap['poolBalance0']}, {snap['poolBalance1']}, {snap['tickBefore']});")
                lines.append(f"        _swapReverts({zf1}, {amount_specified}, {limit_val}, {amount_limit});")
                n_err += 1
            else:
                a0, a1 = int(snap["amount0Delta"]), int(snap["amount1Delta"])
                out_delta = a1 if zero_for_one else a0
                lines.append(f"        _checkBefore({snap['amount0Before']}, {snap['amount1Before']}, {snap['tickBefore']});")
                if out_delta == 0:
                    # PLATFORM divergence: canonical executes with zero output (input is
                    # swallowed); the port's slippage floor / Nothing-swapped check reverts
                    lines.append(f"        _swapReverts({zf1}, {amount_specified}, {limit_val}, {amount_limit}); // PLATFORM: canonical returns zero output")
                    n_platform += 1
                else:
                    lines.append(f"        _swapOk({zf1}, {amount_specified}, {limit_val}, {amount_limit},")
                    lines.append(f"            {a0}, {a1},")
                    lines.append(f"            {snap['feeGrowthGlobal0X128Delta']}, {snap['feeGrowthGlobal1X128Delta']}, {snap['tickAfter']});")
                    n_ok += 1
            lines.append("    }")
            funcs.append("\n".join(lines))

    header = f"""import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

/*
 * GENERATED by gen_uniswap_swaps.py -- DO NOT EDIT BY HAND.
 *
 * Replays Uniswap v3-core's own golden swap snapshots
 * (test/__snapshots__/UniswapV3Pool.swaps.spec.ts.snap) against the SolidVM port:
 * 15 pool configurations x 16 swap cases = 240 cases
 * ({n_ok} exact-match, {n_err} canonical reverts, {n_platform} PLATFORM-divergent zero-output reverts).
 *
 * lpSharePercent is set to 10000 so 100% of fees accrue as LP fee growth --
 * canonical behavior with feeProtocol = 0, which the snapshots were generated with.
 * Every amount, fee growth value, and tick asserted below is canonical's exact output.
 */

contract Describe_PoolV3UniswapSwaps is Authorizable {{

    Mercata m;
    string[] emptyArray;
    PoolV3Factory factory;
    address token0Address;
    address token1Address;
    PoolV3 pool;

    uint constant BIG = 10**70;
    uint constant MAXIN = 2**250;
    int constant INT256_MAX = 2**255 - 1; // canonical swapToSqrtPrice passes type(int256).max
    uint constant DEADLINE_OFFSET = 3600;

    function beforeAll() {{
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
        factory = new PoolV3Factory(address(this));
        factory.initialize(address(m.tokenFactory()), address(m.feeCollector()));
    }}

    function _setupPool(uint fee, uint startingPrice) internal {{
        token0Address = m.tokenFactory().createToken(
            "Token 0", "Test Token 0", emptyArray, emptyArray, emptyArray, "TK0", BIG, 18);
        token1Address = m.tokenFactory().createToken(
            "Token 1", "Test Token 1", emptyArray, emptyArray, emptyArray, "TK1", BIG, 18);
        Token(token0Address).setStatus(2);
        Token(token1Address).setStatus(2);
        Token(token0Address).mint(address(this), BIG);
        Token(token1Address).mint(address(this), BIG);
        pool = PoolV3(factory.createPoolV3(token0Address, token1Address, fee, startingPrice));
        factory.setPoolLpSharePercent(address(pool), 10000); // canonical: feeProtocol = 0
        require(ERC20(token0Address).approve(address(pool), BIG), "approve0");
        require(ERC20(token1Address).approve(address(pool), BIG), "approve1");
    }}

    function _mint(int tickLower, int tickUpper, uint liq) internal {{
        pool.mint(address(this), tickLower, tickUpper, liq, BIG, BIG, block.timestamp + DEADLINE_OFFSET);
    }}

    function _checkBefore(uint bal0, uint bal1, int tickBefore) internal {{
        uint b0 = Token(token0Address).balanceOf(address(pool));
        uint b1 = Token(token1Address).balanceOf(address(pool));
        require(b0 == bal0, "amount0Before mismatch: " + string(b0));
        require(b1 == bal1, "amount1Before mismatch: " + string(b1));
        require(pool.currentTick() == tickBefore, "tickBefore mismatch: " + string(pool.currentTick()));
    }}

    function _swapOk(
        bool zeroForOne, int amountSpecified, uint limit, uint amountLimit,
        int expA0, int expA1, int expFee0, int expFee1, int expTickAfter
    ) internal {{
        (int a0, int a1) = pool.swap(address(this), zeroForOne, amountSpecified, limit, amountLimit, block.timestamp + DEADLINE_OFFSET);
        require(a0 == expA0, "amount0Delta mismatch: " + string(a0));
        require(a1 == expA1, "amount1Delta mismatch: " + string(a1));
        require(pool.feeGrowthGlobal0X128() == expFee0, "feeGrowth0 mismatch: " + string(pool.feeGrowthGlobal0X128()));
        require(pool.feeGrowthGlobal1X128() == expFee1, "feeGrowth1 mismatch: " + string(pool.feeGrowthGlobal1X128()));
        require(pool.currentTick() == expTickAfter, "tickAfter mismatch: " + string(pool.currentTick()));
    }}

    function _swapReverts(bool zeroForOne, int amountSpecified, uint limit, uint amountLimit) internal {{
        bool thrown = false;
        try {{
            pool.swap(address(this), zeroForOne, amountSpecified, limit, amountLimit, block.timestamp + DEADLINE_OFFSET);
        }} catch {{
            thrown = true;
        }}
        require(thrown, "swap should revert");
    }}
"""
    print(header)
    print("\n\n".join(funcs))
    print("}")
    sys.stderr.write(f"generated 240 cases: {n_ok} exact-match, {n_err} canonical reverts, {n_platform} platform-divergent\n")


if __name__ == "__main__":
    main()
