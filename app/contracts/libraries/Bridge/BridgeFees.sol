/**
 * @title  BridgeFees
 * @notice The solver fee schedule shared by both STRATO-side bridges.
 *
 * @notice A user who initiates a bridge action may attach a MAXIMUM fee they
 *         are willing to pay a solver for immediate delivery on the far side.
 *         The fee a solver can actually capture decays exponentially from that
 *         maximum to exactly zero over three days, which does two jobs at
 *         once: it pays the fastest solver the most, and it is an automatic
 *         partial refund to a user whose transfer nobody rushed to fill.
 *
 * @notice THE SCHEDULE IS COMMITTED AT REQUEST TIME, never read live. The
 *         origin contract writes (maxFee, requestedAt, halfLife) into the
 *         request record and emits it; every later evaluation -- by a solver
 *         deciding whether to fill, by the destination contract computing what
 *         the recipient is owed -- recomputes from those three numbers. An
 *         admin who changes the configured half-life therefore cannot move the
 *         goalposts under a request that is already in flight.
 *
 * @dev THE SAME ARITHMETIC RUNS ON BOTH CHAINS. A fill is settled on one chain
 *      against a schedule committed on another, so the two implementations have
 *      to agree bit for bit; the Solidity twin of this library lives at
 *      app/ethereum/contracts/bridge/BridgeFeeDecay.sol and its tests pin the
 *      two against each other. Change one, change both.
 */
library BridgeFees {
    /// @notice The capturable fee hits exactly zero three days after the
    ///         request. A hard window, not a knob: it is the refund guarantee
    ///         the user is given, and the half-life below is the only dial.
    uint256 internal constant DECAY_WINDOW_SECONDS = 259200;

    /// @notice Past this many halvings the shift has driven any real token
    ///         amount to zero; short-circuited so a one-second half-life
    ///         cannot make the loop-free shift undefined.
    uint256 internal constant MAX_HALVINGS = 128;

    /// @notice Basis-point denominator for the fee-cap ceiling.
    uint256 internal constant BPS_DENOMINATOR = 10000;

    /**
     * @notice The fee a solver may keep for filling at time `at` a request
     *         made at `requestedAt` offering at most `maxFee`.
     *
     * @dev Exponential decay by repeated halving, with a straight line across
     *      each partial half-life. The line is exact at every half-life
     *      boundary and at most ~6% above a true exponential in between -- the
     *      shape that matters (monotone down, maxFee at zero elapsed, zero at
     *      the window) is exact, and the approximation is bounded by maxFee,
     *      which the user consented to.
     *
     * @dev NO WIDE PRODUCTS. `fee * remainder` would overflow for an absurd
     *      but representable maxFee, and SolidVM does not range-check
     *      intermediates (see techdocs/solidvm/differences.md), so the
     *      reduction is computed from the quotient and remainder of `fee`
     *      against the denominator instead. Both terms are then bounded by
     *      fee/2 and 2*halfLife^2 respectively. The split is exact: it
     *      reproduces ceil(fee*remainder/denominator) digit for digit.
     *
     * @dev ROUNDED AGAINST THE SOLVER. The deduction is rounded UP, so integer
     *      truncation can only ever move the fee down and the recipient's net
     *      up. A rounding rule has to point somewhere; it points at the party
     *      that chose to be here.
     *
     * @param maxFee     The ceiling the user committed to at request time.
     * @param requestedAt Origin-chain timestamp of the request.
     * @param halfLife   Seconds for the fee to halve; zero means no fee is
     *                   capturable at all (a request that opted out).
     * @param at         The timestamp being evaluated -- the destination
     *                   chain's block time when a fill is settled there.
     */
    function decayedFee(
        uint256 maxFee,
        uint256 requestedAt,
        uint256 halfLife,
        uint256 at
    ) internal pure returns (uint256) {
        if (maxFee == 0) return 0;
        if (halfLife == 0) return 0;

        // Clocks on two chains are independent. A destination block stamped
        // at or before the request is treated as "no time has passed" rather
        // than as an error: the request is real, the skew is not the user's
        // fault, and the full fee is what the user already agreed to.
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
     * @dev THIS IS THE ANTI-GRIEF BOUND, not a courtesy. A solver who fills
     *      with an inflated schedule underpays the recipient and occupies the
     *      one fill slot for that request, which would otherwise let anyone
     *      block fast delivery for the price of a dust transfer. Capping the
     *      fee means occupying the slot costs a solver almost the whole
     *      amount, paid to the user -- a grief that is indistinguishable from
     *      a gift.
     *
     * @dev maxFeeBps of zero refuses every fee, which is how a bridge turns
     *      fast fills off without touching any other switch.
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
        // Divide before multiplying: no product can overflow, and the slight
        // under-estimate only ever rejects a fee that was already at the edge.
        return maxFee <= (amount / BPS_DENOMINATOR) * maxFeeBps;
    }

    /**
     * @notice Whether a half-life is usable: non-zero, and short enough that
     *         the fee has actually decayed by the time the window closes.
     *
     * @dev A half-life longer than the window would make the schedule a cliff
     *      -- full fee for three days, then zero -- which is the incentive
     *      curve this design exists to avoid.
     */
    function isHalfLifeAllowed(uint256 halfLife) internal pure returns (bool) {
        return halfLife > 0 && halfLife <= DECAY_WINDOW_SECONDS;
    }
}
