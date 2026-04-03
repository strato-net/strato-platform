// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library RateLimitLib {
    struct RateLimit {
        uint256 maxAmount;
        uint256 windowDuration;
        uint256 currentAmount;
        uint256 windowStart;
    }

    error RateLimitExceeded(uint256 requested, uint256 remaining);
    error InvalidRateLimit();

    function consume(RateLimit storage self, uint256 amount) internal {
        if (self.maxAmount == 0) revert InvalidRateLimit();

        // Reset window if expired
        if (block.timestamp >= self.windowStart + self.windowDuration) {
            self.currentAmount = 0;
            self.windowStart = block.timestamp;
        }

        uint256 available = self.maxAmount - self.currentAmount;
        if (amount > available) {
            revert RateLimitExceeded(amount, available);
        }

        self.currentAmount += amount;
    }

    function configure(
        RateLimit storage self,
        uint256 maxAmount,
        uint256 windowDuration
    ) internal {
        if (maxAmount == 0 || windowDuration == 0) revert InvalidRateLimit();
        self.maxAmount = maxAmount;
        self.windowDuration = windowDuration;
    }

    function remaining(RateLimit storage self) internal view returns (uint256) {
        if (self.maxAmount == 0) return 0;
        if (block.timestamp >= self.windowStart + self.windowDuration) {
            return self.maxAmount;
        }
        return self.maxAmount - self.currentAmount;
    }
}
