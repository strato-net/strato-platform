// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title  BridgeFeeDecay
 * @notice The external-chain twin of STRATO's BridgeFees library: the solver
 *         fee schedule, evaluated identically on both sides of the bridge.
 *
 * @notice A user who initiates a bridge action may attach a MAXIMUM fee they
 *         are willing to pay a solver for immediate delivery on the far side.
 *         The fee a solver can actually capture decays exponentially from that
 *         maximum to exactly zero over three days, which pays the fastest
 *         solver the most and is an automatic partial refund to a user whose
 *         transfer nobody rushed to fill.
 *
 * @dev THE SCHEDULE IS COMMITTED AT REQUEST TIME. The origin contract writes
 *      (maxFee, requestedAt, halfLife) into the request and emits it; every
 *      later evaluation recomputes from those three numbers, so an admin who
 *      changes the configured half-life cannot move the goalposts under a
 *      request already in flight.
 *
 * @dev MUST STAY BIT-IDENTICAL to app/contracts/libraries/Bridge/BridgeFees.sol.
 *      A fill is settled on one chain against a schedule committed on the
 *      other; the two implementations disagreeing is a fund-loss bug, not a
 *      rounding difference. Change one, change both. The overflow-avoiding
 *      split in {decayedFee} is preserved here even though Solidity 0.8 would
 *      revert rather than wrap, so that both sides return the same number for
 *      every input rather than one reverting where the other answers.
 */
library BridgeFeeDecay {
    /// @notice The capturable fee hits exactly zero three days after the
    ///         request. A hard window, not a knob: it is the refund guarantee
    ///         the user is given, and the half-life is the only dial.
    uint256 internal constant DECAY_WINDOW_SECONDS = 259200;

    /// @notice Past this many halvings the shift has driven any real token
    ///         amount to zero.
    uint256 internal constant MAX_HALVINGS = 128;

    /// @notice Basis-point denominator for the fee-cap ceiling.
    uint256 internal constant BPS_DENOMINATOR = 10000;

    /**
     * @notice The fee a solver may keep for filling at time `at` a request
     *         made at `requestedAt` offering at most `maxFee`.
     *
     * @dev Exponential decay by repeated halving, with a straight line across
     *      each partial half-life: exact at every boundary, at most ~6% above
     *      a true exponential in between, and always bounded by maxFee. The
     *      deduction is rounded UP, so integer truncation can only move the
     *      fee down and the recipient's net up.
     */
    function decayedFee(
        uint256 maxFee,
        uint256 requestedAt,
        uint256 halfLife,
        uint256 at
    ) internal pure returns (uint256) {
        if (maxFee == 0) return 0;
        if (halfLife == 0) return 0;

        // Clocks on two chains are independent. A block stamped at or before
        // the request means no time has passed, not that something is wrong:
        // the skew is not the user's fault and the full fee is what they
        // already agreed to.
        if (at <= requestedAt) return maxFee;

        uint256 elapsed = at - requestedAt;
        if (elapsed >= DECAY_WINDOW_SECONDS) return 0;

        uint256 halvings = elapsed / halfLife;
        if (halvings >= MAX_HALVINGS) return 0;

        uint256 fee = maxFee >> halvings;
        if (fee == 0) return 0;

        uint256 remainder = elapsed % halfLife;
        if (remainder == 0) return fee;

        uint256 denominator = 2 * halfLife;
        uint256 whole = fee / denominator;
        uint256 part = fee % denominator;
        uint256 reduction = (whole * remainder)
            + ((part * remainder) + denominator - 1) / denominator;

        if (reduction >= fee) return 0;
        return fee - reduction;
    }

    /**
     * @notice Whether `maxFee` is an acceptable ceiling for `amount` under a
     *         bridge configured to allow at most `maxFeeBps` basis points.
     *
     * @dev THE ANTI-GRIEF BOUND. A solver who fills with an inflated schedule
     *      underpays the recipient and occupies the one fill slot for that
     *      request, which would otherwise let anyone block fast delivery for
     *      the price of a dust transfer. Capping the fee makes occupying the
     *      slot cost almost the whole amount, paid to the user -- a grief
     *      indistinguishable from a gift. Zero bps refuses every fee, which is
     *      how fast fills are turned off without touching another switch.
     */
    function isFeeCapAllowed(
        uint256 maxFee,
        uint256 amount,
        uint256 maxFeeBps
    ) internal pure returns (bool) {
        if (amount == 0) return false;
        if (maxFee == 0) return true;
        if (maxFee >= amount) return false;
        if (maxFeeBps == 0) return false;
        if (maxFeeBps >= BPS_DENOMINATOR) return true;
        return maxFee <= (amount / BPS_DENOMINATOR) * maxFeeBps;
    }

    /**
     * @notice Whether a half-life is usable: non-zero, and short enough that
     *         the fee has actually decayed before the window closes. A
     *         half-life longer than the window would make the schedule a cliff
     *         -- full fee for three days, then zero -- which is the incentive
     *         curve this design exists to avoid.
     */
    function isHalfLifeAllowed(uint256 halfLife) internal pure returns (bool) {
        return halfLife > 0 && halfLife <= DECAY_WINDOW_SECONDS;
    }
}
