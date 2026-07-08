// SPDX-License-Identifier: MIT
import "FullMath.sol";
import "FixedPoint128.sol";
import "LiquidityMath.sol";

/// @notice A liquidity position over a tick range (canonical Position.Info; file-level struct
///         because SolidVM does not support library-nested struct references)
struct V3Position {
    // the amount of liquidity owned by this position
    uint liquidity;
    // fee growth per unit of liquidity as of the last update to liquidity or fees owed
    int feeGrowthInside0LastX128;
    int feeGrowthInside1LastX128;
    // the fees owed to the position owner in token0/token1
    uint tokensOwed0;
    uint tokensOwed1;
}

/// @title Position
/// @notice Positions represent an owner address' liquidity between a lower and upper tick boundary
/// @dev Positions store additional state for tracking fees owed to the position
///
/// SolidVM dialect notes (vs canonical Uniswap V3 Position, otherwise function-for-function):
/// - Positions are keyed (owner => tickLower => tickUpper) in a nested mapping — the same key
///   space as canonical's keccak256(owner, tickLower, tickUpper), and queryable in Cirrus
/// - uint/int replace uint128/uint256; fee growth values are signed ints. Canonical's fee delta
///   subtraction relies on uint256 wrap for transiently "negative" growth, so the positive-delta
///   guard is explicit here (a delta <= 0 accrues nothing); the "overflow is acceptable"
///   uint128 truncations on tokensOwed have no equivalent — amounts are exact
/// - Canonical's `Info memory _self = self` SLOAD optimization is dropped: SolidVM memory
///   structs are live storage views, so it would alias `self` rather than snapshot it
library Position {
    /// @notice Returns the Info struct of a position, given an owner and position boundaries
    /// @param self The mapping containing all user positions
    /// @param owner The address of the position owner
    /// @param tickLower The lower tick boundary of the position
    /// @param tickUpper The upper tick boundary of the position
    /// @return position The position info struct of the given owners' position
    function get(
        mapping(address => mapping(int => mapping(int => V3Position))) storage self,
        address owner,
        int tickLower,
        int tickUpper
    ) internal view returns (V3Position storage) {
        return self[owner][tickLower][tickUpper];
    }

    /// @notice Credits accumulated fees to a user's position
    /// @param self The individual position to update
    /// @param liquidityDelta The change in pool liquidity as a result of the position update
    /// @param feeGrowthInside0X128 The all-time fee growth in token0, per unit of liquidity, inside the position's tick boundaries
    /// @param feeGrowthInside1X128 The all-time fee growth in token1, per unit of liquidity, inside the position's tick boundaries
    function update(
        V3Position storage self,
        int liquidityDelta,
        int feeGrowthInside0X128,
        int feeGrowthInside1X128
    ) internal {
        uint liquidityNext;
        if (liquidityDelta == 0) {
            require(self.liquidity > 0, "NP"); // disallow pokes for 0 liquidity positions
            liquidityNext = self.liquidity;
        } else {
            liquidityNext = LiquidityMath.addDelta(self.liquidity, liquidityDelta);
        }

        // calculate accumulated fees
        uint tokensOwed0 = 0;
        uint tokensOwed1 = 0;
        int delta0 = feeGrowthInside0X128 - self.feeGrowthInside0LastX128;
        int delta1 = feeGrowthInside1X128 - self.feeGrowthInside1LastX128;
        if (delta0 > 0) {
            tokensOwed0 = FullMath.mulDiv(uint(delta0), self.liquidity, FixedPoint128.Q128);
        }
        if (delta1 > 0) {
            tokensOwed1 = FullMath.mulDiv(uint(delta1), self.liquidity, FixedPoint128.Q128);
        }

        // update the position
        if (liquidityDelta != 0) self.liquidity = liquidityNext;
        self.feeGrowthInside0LastX128 = feeGrowthInside0X128;
        self.feeGrowthInside1LastX128 = feeGrowthInside1X128;
        if (tokensOwed0 > 0 || tokensOwed1 > 0) {
            self.tokensOwed0 += tokensOwed0;
            self.tokensOwed1 += tokensOwed1;
        }
    }
}
