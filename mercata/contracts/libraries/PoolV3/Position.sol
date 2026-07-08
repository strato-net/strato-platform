// SPDX-License-Identifier: MIT
import "FixedPoint128.sol";

/// @notice A liquidity position over a tick range (canonical Position.Info; file-level struct
///         because SolidVM does not support library-nested struct references)
struct V3Position {
    uint liquidity;
    int feeGrowthInside0LastX128;
    int feeGrowthInside1LastX128;
    uint tokensOwed0;
    uint tokensOwed1;
}

/// @title Position
/// @notice Position liquidity/fee bookkeeping, ported from Uniswap V3 core's Position library
/// @dev Positions are keyed (owner => tickLower => tickUpper) in a nested mapping — the same
///      key space as canonical's keccak256(owner, tickLower, tickUpper), and queryable in
///      Cirrus. Divergence: poking (liquidityDelta == 0) an empty position is a no-op here,
///      where canonical reverts 'NP'
library Position {
    /// @notice Credit a liquidity change and accrue owed fees to a position (canonical update)
    function update(
        mapping(address => mapping(int => mapping(int => V3Position))) storage self,
        address owner,
        int tickLower,
        int tickUpper,
        int liquidityDelta,
        int feeGrowthInside0X128,
        int feeGrowthInside1X128
    ) internal {
        V3Position storage pos = self[owner][tickLower][tickUpper];

        if (pos.liquidity > 0) {
            int delta0 = feeGrowthInside0X128 - pos.feeGrowthInside0LastX128;
            int delta1 = feeGrowthInside1X128 - pos.feeGrowthInside1LastX128;
            if (delta0 > 0) {
                pos.tokensOwed0 += (pos.liquidity * uint(delta0)) / FixedPoint128.Q128;
            }
            if (delta1 > 0) {
                pos.tokensOwed1 += (pos.liquidity * uint(delta1)) / FixedPoint128.Q128;
            }
        }
        pos.feeGrowthInside0LastX128 = feeGrowthInside0X128;
        pos.feeGrowthInside1LastX128 = feeGrowthInside1X128;

        int liquidityNext = int(pos.liquidity) + liquidityDelta;
        require(liquidityNext >= 0, "Position liquidity underflow");
        pos.liquidity = uint(liquidityNext);
    }
}
