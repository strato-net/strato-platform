// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Bid, BidLib} from '../libraries/BidLib.sol';
import {Checkpoint} from '../libraries/CheckpointLib.sol';
import {FixedPoint96} from '../libraries/FixedPoint96.sol';
/// @title CheckpointAccountingLib
/// @notice Pure accounting helpers for computing fills and currency spent across checkpoints
library CheckpointAccountingLib {
    /// @notice Calculate the tokens sold and proportion of input used for a fully filled bid between two checkpoints
    /// @dev MUST only be used for checkpoints where the bid's max price is strictly greater than the clearing price
    ///      because it uses lazy accounting to calculate the tokens filled
    /// @param upper The upper checkpoint
    /// @param startCheckpoint The start checkpoint of the bid
    /// @param bid The bid
    /// @return tokensFilled The tokens sold
    /// @return currencySpentQ96 The amount of currency spent in Q96 form
    function accountFullyFilledCheckpoints(Checkpoint memory upper, Checkpoint memory startCheckpoint, Bid memory bid)
        internal
        pure
        returns (uint256 tokensFilled, uint256 currencySpentQ96)
    {
        (tokensFilled, currencySpentQ96) = calculateFill(
            bid,
            upper.cumulativeMpsPerPrice - startCheckpoint.cumulativeMpsPerPrice,
            upper.cumulativeMps - startCheckpoint.cumulativeMps
        );
        return (tokensFilled, currencySpentQ96);
    }

    /// @notice Calculate the tokens sold and currency spent for a partially filled bid
    /// @param bid The bid
    /// @param tickDemandQ96 The total demand at the tick
    /// @param currencyRaisedAtClearingPriceQ96_X7 The cumulative supply sold to the clearing price
    /// @return tokensFilled The tokens sold
    /// @return currencySpentQ96 The amount of currency spent in Q96 form
    function accountPartiallyFilledCheckpoints(
        Bid memory bid,
        uint256 tickDemandQ96,
        uint256 currencyRaisedAtClearingPriceQ96_X7
    ) internal pure returns (uint256 tokensFilled, uint256 currencySpentQ96) {
        if (tickDemandQ96 == 0) return (0, 0);

        // Apply the ratio between bid demand and tick demand to the currencyRaisedAtClearingPriceQ96_X7 value
        // If currency spent is calculated to have a remainder, we round up.
        // In the case where the result would have been 0, we will return 1 wei.
        uint256 denominator = tickDemandQ96 * BidLib.mpsRemainingInAuctionAfterSubmission(bid);
        currencySpentQ96 = _mulDiv(bid.amountQ96, currencyRaisedAtClearingPriceQ96_X7, denominator, true);

        // We derive tokens filled from the currency spent by dividing it by the max price.
        // If the currency spent is 0, tokens filled will be 0 as well.
        tokensFilled = _mulDiv(bid.amountQ96, currencyRaisedAtClearingPriceQ96_X7, denominator, false) / bid.maxPrice;
        return (tokensFilled, currencySpentQ96);
    }

    /// @notice Calculate the tokens filled and currency spent for a bid
    /// @dev Uses lazy accounting to efficiently calculate fills across time periods without iterating blocks.
    ///      MUST only be used when the bid's max price is strictly greater than the clearing price throughout.
    /// @param bid the bid to evaluate
    /// @param cumulativeMpsPerPriceDelta the cumulative sum of supply to price ratio
    /// @param cumulativeMpsDelta the cumulative sum of mps values across the block range
    /// @return tokensFilled the amount of tokens filled for this bid
    /// @return currencySpentQ96 the amount of currency spent by this bid in Q96 form
    function calculateFill(Bid memory bid, uint256 cumulativeMpsPerPriceDelta, uint24 cumulativeMpsDelta)
        internal
        pure
        returns (uint256 tokensFilled, uint256 currencySpentQ96)
    {
        uint24 mpsRemainingInAuctionAfterSubmission = BidLib.mpsRemainingInAuctionAfterSubmission(bid);

        // Currency spent is original currency amount multiplied by percentage fully filled over percentage allocated
        currencySpentQ96 = _mulDiv(bid.amountQ96, cumulativeMpsDelta, mpsRemainingInAuctionAfterSubmission, true);

        // Tokens filled are calculated from the effective amount over the allocation
        tokensFilled = _mulDiv(
            bid.amountQ96,
            cumulativeMpsPerPriceDelta,
            (FixedPoint96.Q96 << FixedPoint96.RESOLUTION) * mpsRemainingInAuctionAfterSubmission,
            false
        );
        return (tokensFilled, currencySpentQ96);
    }

    function _mulDiv(uint256 x, uint256 y, uint256 denominator, bool roundUp) private pure returns (uint256) {
        require(denominator > 0, "CheckpointAccounting: div by zero");
        uint256 product = x * y;
        uint256 result = product / denominator;
        if (roundUp && (product % denominator) > 0) {
            result += 1;
        }
        return result;
    }
}

