import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Bridge/MercataBridge.sol";
import "../../concrete/Bridge/StratoNativeBridge.sol";
import "../../concrete/Bridge/StratoNativeCustodyVault.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../libraries/Bridge/BridgeFees.sol";

import "../Util.sol";

/// @dev BridgeFees is a library of internal functions, so it cannot be called
///      from a test directly. This exposes it.
contract FeeMath {
    function decayedFee(
        uint256 maxFee,
        uint256 requestedAt,
        uint256 halfLife,
        uint256 at
    ) public returns (uint256) {
        return BridgeFees.decayedFee(maxFee, requestedAt, halfLife, at);
    }

    function isFeeCapAllowed(
        uint256 maxFee,
        uint256 amount,
        uint256 maxFeeBps
    ) public returns (bool) {
        return BridgeFees.isFeeCapAllowed(maxFee, amount, maxFeeBps);
    }

    function isHalfLifeAllowed(uint256 halfLife) public returns (bool) {
        return BridgeFees.isHalfLifeAllowed(halfLife);
    }

    function window() public returns (uint256) {
        return BridgeFees.DECAY_WINDOW_SECONDS;
    }
}

/**
 * @notice The solver fast path on both STRATO-side bridges: the fee decay, the
 *         claim ladder and its exit offers, the mint/unlock redirect, bonded
 *         announcements, and the risk edges where a solver is meant to lose.
 *
 * @dev THE DECAY VECTORS ARE SHARED WITH THE EVM SIDE. The numbers in
 *      {it_fastpath_decay_matches_shared_vectors} are the same constants
 *      asserted against BridgeFeeDecay in
 *      app/ethereum/test/BridgeFeeDecay.test.js. A fill is settled on one
 *      chain against a schedule committed on the other, so the two libraries
 *      disagreeing is a fund-loss bug; these vectors are what catch it.
 *
 * @dev THERE IS NO TIME TRAVEL in the SolidVM test harness, so elapsed time is
 *      simulated the way the bridge itself sees it: a deposit's `requestedAt`
 *      comes from the ORIGIN chain and is therefore a parameter, so backdating
 *      it exercises the decay exactly as a slow relayer would. Withdrawal
 *      schedules start at this chain's `block.timestamp` and cannot be
 *      backdated, so their decay is covered by the library vectors here and by
 *      real elapsed time in the Hardhat suites.
 */
contract Describe_BridgeFastPath is Authorizable {
    using BridgeTypes for *;
    using StringUtils for string;

    // Six hours: twelve halvings across the three-day window.
    uint256 constant HALF_LIFE = 21600;
    uint256 constant FEE_BPS = 500;

    Mercata mercata;
    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    FeeMath feeMath;

    MercataBridge bridge;
    Token bridgedToken;
    address bridgedTokenAddress;
    address bridgeAddress;

    StratoNativeBridge nativeBridge;
    StratoNativeCustodyVault custodyVault;
    Token nativeToken;
    address nativeBridgeAddress;
    address custodyVaultAddress;
    address nativeTokenAddress;

    Token bondToken;
    address bondTokenAddress;

    User user;
    User solverA;
    User solverB;
    User announcer;
    User relayer;

    uint256 externalChainId;
    address externalToken;
    address externalSender;
    address externalRecipient;
    address externalBridge;
    address representationToken;
    address recipient;
    address treasury;
    string txHash;

    function beforeAll() {
        bypassAuthorizations = true;
        feeMath = new FeeMath();

        user = new User();
        solverA = new User();
        solverB = new User();
        announcer = new User();
        relayer = new User();

        externalChainId = 1;
        externalToken = address(0x5555);
        externalSender = address(0x1111);
        externalRecipient = address(0x2222);
        externalBridge = address(0x3333);
        representationToken = address(0x7777);
        treasury = address(0x9999);
        txHash = "0xfeedfacefeedface";
    }

    function beforeEach() {
        mercata = new Mercata();
        adminRegistry = mercata.adminRegistry();
        tokenFactory = mercata.tokenFactory();
        bridge = mercata.mercataBridge();
        bridgeAddress = address(bridge);
        recipient = address(user);

        adminRegistry.addWhitelist(bridgeAddress, "deposit", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "depositWithFee", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "depositBatchWithFee", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "confirmDeposit", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "reviewDeposit", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "abortDeposit", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "recordWithdrawalClaim", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "confirmWithdrawal", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "finaliseWithdrawal", address(relayer));
        adminRegistry.addWhitelist(bridgeAddress, "abortWithdrawal", address(relayer));

        bridgedTokenAddress = tokenFactory.createTokenWithInitialOwner(
            "Bridged", "BRDG", [], [], [], "BRDG", 0, 18, address(adminRegistry)
        );
        bridgedToken = Token(bridgedTokenAddress);
        bridgedToken.setStatus(2);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", bridgedTokenAddress, "mint", bridgeAddress);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", bridgedTokenAddress, "burn", bridgeAddress);

        bondTokenAddress = tokenFactory.createToken("Bond", "BOND", [], [], [], "BOND", 0, 18);
        bondToken = Token(bondTokenAddress);
        bondToken.setStatus(2);

        bridge.setChain("Ethereum", address(0x3333), address(0x3334), true, externalChainId, 1000, address(0x4444));
        bridge.setAsset(
            true, externalChainId, 18, "External Bridged", "EBRDG", externalToken, 1000000e18, bridgedTokenAddress
        );
        bridge.setFeeConfig(HALF_LIFE, FEE_BPS, true);
        bridge.setAnnouncementConfig(true, bondTokenAddress, 10e18, treasury, 7 * 86400);

        // Solvers need inventory of the bridged token to fill with.
        bridgedToken.mint(address(solverA), 10000e18);
        bridgedToken.mint(address(solverB), 10000e18);
        bondToken.mint(address(announcer), 100e18);

        _setUpNativeBridge();
    }

    function _setUpNativeBridge() internal {
        address implOwnerIgnored = address(0xdeadbeef);

        nativeBridge = StratoNativeBridge(
            address(new Proxy(address(new StratoNativeBridge(implOwnerIgnored)), address(adminRegistry)))
        );
        nativeBridgeAddress = address(nativeBridge);
        custodyVault = StratoNativeCustodyVault(
            address(new Proxy(address(new StratoNativeCustodyVault(implOwnerIgnored)), address(adminRegistry)))
        );
        custodyVaultAddress = address(custodyVault);

        nativeBridge.initialize(address(tokenFactory), custodyVaultAddress, address(relayer), address(this));
        custodyVault.initialize(nativeBridgeAddress, address(this));

        adminRegistry.addWhitelist(nativeBridgeAddress, "abortWithdrawal", address(relayer));

        nativeTokenAddress = tokenFactory.createToken("Native", "NST", [], [], [], "NST", 0, 18);
        nativeToken = Token(nativeTokenAddress);
        nativeToken.setStatus(2);
        nativeToken.mint(address(user), 1000e18);
        nativeToken.mint(address(solverA), 1000e18);
        nativeToken.mint(address(solverB), 1000e18);

        nativeBridge.setAsset(
            true, externalChainId, externalBridge, representationToken,
            "Wrapped Native", "wNST", 500e18, 100e18, nativeTokenAddress
        );
        nativeBridge.setFeeConfig(HALF_LIFE, FEE_BPS, true);
        nativeBridge.setAnnouncementConfig(true, bondTokenAddress, 10e18, treasury, 7 * 86400);
    }

    // ============ The fee schedule ============

    /**
     * @notice The exact numbers the EVM-side library must also produce. Any
     *         divergence between the two implementations means a solver is paid
     *         one amount on one chain and owed another on the other.
     */
    function it_fastpath_decay_matches_shared_vectors() {
        uint256 fee = 3e18;
        uint256 t0 = 1000000;

        require(feeMath.window() == 259200, "window must be three days");

        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0) == 3000000000000000000, "at request");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 - 500) == 3000000000000000000, "clock skew keeps full fee");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + HALF_LIFE) == 1500000000000000000, "one half-life halves it");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 2 * HALF_LIFE) == 750000000000000000, "two half-lives quarter it");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + HALF_LIFE / 2) == 2250000000000000000, "mid half-life interpolates");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 1) == 2999930555555555555, "one second in");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 259199) == 732455783420138, "one second before the window closes");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 259200) == 0, "exactly at the window it is zero");
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 259200 + 1000000) == 0, "past the window it stays zero");
        require(feeMath.decayedFee(0, t0, HALF_LIFE, t0 + 10) == 0, "no fee offered");
        require(feeMath.decayedFee(fee, t0, 0, t0 + 10) == 0, "no half-life means no fee");
        require(feeMath.decayedFee(7, t0, HALF_LIFE, t0 + 11 * HALF_LIFE) == 0, "a tiny fee shifts to nothing");
        require(feeMath.decayedFee(fee, t0, 1, t0 + 200) == 0, "a one-second half-life is gone in minutes");
        require(feeMath.decayedFee(3e6, t0, HALF_LIFE, t0 + HALF_LIFE / 2) == 2250000, "six-decimal token scales");
    }

    /// @notice The decay must never increase, or a solver could profit by
    ///         waiting and the user's automatic refund would run backwards.
    function it_fastpath_decay_is_monotone() {
        uint256 fee = 3e18;
        uint256 t0 = 1000000;
        uint256 previous = fee + 1;

        for (uint256 elapsed = 0; elapsed < 259200; elapsed = elapsed + 617) {
            uint256 current = feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + elapsed);
            require(current <= previous, "fee increased at elapsed " + string(elapsed));
            require(current <= fee, "fee exceeded the ceiling at elapsed " + string(elapsed));
            require(current > 0, "fee should still be positive inside the window");
            previous = current;
        }
        require(feeMath.decayedFee(fee, t0, HALF_LIFE, t0 + 259200) == 0, "zero exactly at the window");
    }

    function it_fastpath_fee_cap_and_half_life_bounds() {
        require(feeMath.isFeeCapAllowed(0, 100e18, 500), "a zero fee is always allowed");
        require(feeMath.isFeeCapAllowed(5e18, 100e18, 500), "5% under a 5% ceiling");
        require(!feeMath.isFeeCapAllowed(6e18, 100e18, 500), "6% over a 5% ceiling");
        require(!feeMath.isFeeCapAllowed(1, 100e18, 0), "a zero ceiling refuses every fee");
        require(!feeMath.isFeeCapAllowed(100e18, 100e18, 10000), "a fee equal to the amount leaves nothing");
        require(!feeMath.isFeeCapAllowed(1, 0, 10000), "a zero amount cannot carry a fee");

        require(feeMath.isHalfLifeAllowed(1), "one second is a legal half-life");
        require(feeMath.isHalfLifeAllowed(259200), "the whole window is a legal half-life");
        require(!feeMath.isHalfLifeAllowed(0), "zero is not");
        require(!feeMath.isHalfLifeAllowed(259201), "longer than the window is a cliff, not a decay");
    }

    // ============ MercataBridge: inbound deposit fills ============

    function _recordDeposit(uint256 amount, uint256 maxFee, uint256 requestedAt) internal {
        relayer.do(
            bridgeAddress, "depositWithFee",
            externalChainId, externalSender, externalToken, amount,
            txHash, recipient, bridgedTokenAddress, maxFee, requestedAt
        );
    }

    function it_fastpath_deposit_fill_pays_recipient_and_redirects_mint() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        uint256 recipientBefore = IERC20(bridgedTokenAddress).balanceOf(recipient);
        uint256 solverBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverA));

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        uint256 netPaid = solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18,
            3e18, false, 0
        );

        require(netPaid == 97e18, "recipient is paid the amount less the full fee");
        require(
            IERC20(bridgedTokenAddress).balanceOf(recipient) == recipientBefore + 97e18,
            "the recipient holds the solver's tokens immediately"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == solverBefore - 97e18,
            "the solver paid out of their own balance"
        );

        relayer.do(bridgeAddress, "confirmDeposit", externalChainId, txHash);

        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == solverBefore + 3e18,
            "the mint goes to the solver, netting them the fee"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(recipient) == recipientBefore + 97e18,
            "the recipient is not paid twice"
        );
    }

    /**
     * @notice The contract prices a fill with the COMMITTED schedule and the
     *         shared library, not with anything read live.
     *
     * @dev The SolidVM harness runs at `block.timestamp == 0`, so no elapsed
     *      time can be produced here and the decay itself is covered by
     *      {it_fastpath_decay_matches_shared_vectors} and by real elapsed time
     *      in app/ethereum/test. What this pins is the wiring: the terms the
     *      request committed are the terms the quote uses, and the quote is
     *      exactly what the library returns for them. Given the vectors, that
     *      is what makes the decay reachable through the contract.
     */
    function it_fastpath_deposit_quote_uses_the_committed_schedule() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        (bool set, uint256 maxFee, uint256 requestedAt, uint256 halfLife) =
            bridge.depositFeeTerms(externalChainId, txHash);
        require(set, "the schedule is committed at record time");
        require(maxFee == 3e18, "scaled into STRATO units");
        require(halfLife == HALF_LIFE, "with the half-life in force when the deposit was recorded");

        (address payTo, uint256 quotedFee, uint256 netToPay, bool forSale) =
            bridge.quoteDepositFill(externalChainId, txHash);
        require(payTo == recipient, "rung zero pays the user");
        require(forSale, "an unclaimed deposit is open to anyone");
        require(
            quotedFee == feeMath.decayedFee(maxFee, requestedAt, halfLife, block.timestamp),
            "the quote is the shared library applied to the committed terms"
        );
        require(netToPay == 100e18 - quotedFee, "and the user receives the rest");

        // Changing the configured half-life must not move a committed schedule.
        bridge.setFeeConfig(600, FEE_BPS, true);
        (, , , uint256 halfLifeAfter) = bridge.depositFeeTerms(externalChainId, txHash);
        require(halfLifeAfter == HALF_LIFE, "a config change cannot re-price a deposit in flight");
    }

    function it_fastpath_deposit_fill_rejects_stale_expectations() {
        _recordDeposit(100e18, 3e18, block.timestamp);
        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);

        // Asking for MORE than the schedule offers is refused. Asking for less
        // is not an error -- it is how a solver absorbs the decay that happens
        // between quoting and landing.
        solverA.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: fee below your minimum",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 4e18, false, 0
        );
        solverA.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: amount mismatch",
            externalChainId, txHash, recipient, bridgedTokenAddress, 99e18, 3e18, false, 0
        );
        solverA.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: recipient mismatch",
            externalChainId, txHash, address(0xBEEF), bridgedTokenAddress, 100e18, 3e18, false, 0
        );
    }

    // ============ The claim ladder ============

    /// @notice A solver who knows a transfer is good keeps their position. This
    ///         is the whole reason the ladder is opt-in: without it, anyone
    ///         could take a claim for a penny of decay.
    function it_fastpath_claim_is_not_transferable_by_default() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, false, 0
        );

        solverB.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverB.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: claim not transferable",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 0, false, 0
        );
    }

    /**
     * @notice The handoff, priced by the solver being displaced.
     *
     *         Solver A fills at the full 3 and offers to be bought out at 1:
     *         B pays A 99, so A nets 2 for having carried it, and B is owed the
     *         full 100 at settlement for a profit of 1. The user's 97 never
     *         moves, and the bridge still mints exactly 100.
     */
    function it_fastpath_claim_transfers_at_the_holders_price() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        uint256 aBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverA));
        uint256 bBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverB));
        uint256 recipientBefore = IERC20(bridgedTokenAddress).balanceOf(recipient);

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, true, 1e18
        );

        (address payTo, uint256 quotedFee, uint256 netToPay, bool forSale) =
            bridge.quoteDepositFill(externalChainId, txHash);
        require(payTo == address(solverA), "the next rung pays the current holder");
        require(quotedFee == 1e18, "at the holder's asking price");
        require(netToPay == 99e18, "so the taker must hand over ninety-nine");
        require(forSale, "the holder is selling");

        solverB.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverB.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 1e18, false, 0
        );

        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == aBefore - 97e18 + 99e18,
            "A recovered their outlay plus two"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverB)) == bBefore - 99e18,
            "B has paid ninety-nine and holds the claim"
        );

        relayer.do(bridgeAddress, "confirmDeposit", externalChainId, txHash);

        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverB)) == bBefore - 99e18 + 100e18,
            "B is minted the full amount, netting one"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == aBefore + 2e18,
            "A keeps two for having carried the risk first"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(recipient) == recipientBefore + 97e18,
            "the user's leg is untouched by any of it"
        );
    }

    /**
     * @notice Shedding a claim you have come to distrust, at a LOSS.
     *
     *         A filled at 3 and now believes the deposit will be aborted, so it
     *         asks 5 -- more than it earned -- to get out. B pays 95, A eats a
     *         loss of 2, and B carries the risk for a profit of 5 if it
     *         settles. Nothing about this is bounded by the user's schedule,
     *         because the user was already paid at rung zero.
     */
    function it_fastpath_claim_can_be_offloaded_above_the_users_schedule() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        uint256 aBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverA));
        uint256 bBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverB));

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, true, 5e18
        );

        solverB.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverB.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 5e18, false, 0
        );

        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == aBefore - 2e18,
            "A paid two to be rid of the position"
        );

        relayer.do(bridgeAddress, "confirmDeposit", externalChainId, txHash);
        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverB)) == bBefore + 5e18,
            "B is paid five for taking it on"
        );
    }

    /// @notice A holder may reprice or withdraw the offer at any time, and a
    ///         taker who arrives against the old price is refused rather than
    ///         charged the new one.
    function it_fastpath_claim_offer_can_be_repriced_and_withdrawn() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, true, 1e18
        );

        // Repricing UPWARD cannot hurt a taker: a bigger exitFee means they pay
        // less and keep more, so the floor lets it through.
        solverA.do(bridgeAddress, "setDepositClaimExitOffer", externalChainId, txHash, true, 2e18);
        solverB.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);

        // Cutting the price after a taker has committed is the case the floor
        // exists for.
        solverA.do(bridgeAddress, "setDepositClaimExitOffer", externalChainId, txHash, true, 500000000000000000);
        solverB.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: fee below your minimum",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 1e18, false, 0
        );

        solverA.do(bridgeAddress, "setDepositClaimExitOffer", externalChainId, txHash, false, 0);
        solverB.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: claim not transferable",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 500000000000000000, false, 0
        );

        solverB.doExpectingFailure(
            bridgeAddress, "setDepositClaimExitOffer", "MB: not the claimant",
            externalChainId, txHash, true, 0
        );
    }

    // ============ Where a solver is meant to lose ============

    /// @notice An aborted deposit is the risk a solver priced. The recipient
    ///         keeps what the solver handed them and nothing is minted.
    function it_fastpath_abort_voids_the_claim_and_costs_the_solver() {
        _recordDeposit(100e18, 3e18, block.timestamp);

        uint256 aBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverA));
        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, false, 0
        );

        relayer.do(bridgeAddress, "reviewDeposit", externalChainId, txHash);
        relayer.do(bridgeAddress, "abortDeposit", externalChainId, txHash);

        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == aBefore - 97e18,
            "the solver is out of pocket and nothing compensates them"
        );

        (,,,,, bool voided,,,,,,,,,) = bridge.depositClaims(externalChainId, txHash);
        require(voided, "the claim is marked void so the loss is explicit on chain");
    }

    /**
     * @notice A claim priced against an announcement the relayer then
     *         contradicts is VOID, not a blocker: the recipient is minted to
     *         exactly as if no solver had appeared, and the solver eats the
     *         loss.
     *
     *         This is the case the snapshot exists for. A solver who fills an
     *         unverified announcement without checking the origin chain is
     *         trusting a stranger, and the bridge must neither pay them nor
     *         get stuck because of them.
     */
    function it_fastpath_contradicted_announcement_voids_the_claim() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 3e18, block.timestamp
        );

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, false, 0
        );

        uint256 aBefore = IERC20(bridgedTokenAddress).balanceOf(address(solverA));
        uint256 recipientBefore = IERC20(bridgedTokenAddress).balanceOf(recipient);

        // The relayer's own record says the deposit was for half as much. Its
        // version wins.
        _recordDeposit(50e18, 1e18, block.timestamp);
        relayer.do(bridgeAddress, "confirmDeposit", externalChainId, txHash);

        require(
            IERC20(bridgedTokenAddress).balanceOf(recipient) == recipientBefore + 50e18,
            "the recipient is minted the real amount, as if nobody had filled"
        );
        require(
            IERC20(bridgedTokenAddress).balanceOf(address(solverA)) == aBefore,
            "and the solver gets nothing for a claim that never matched"
        );
    }

    /// @notice An action deposit cannot be filled: a solver cannot reproduce an
    ///         auto-forge, so taking the mint would leave the depositor holding
    ///         the wrong asset.
    function it_fastpath_action_deposits_are_not_fillable() {
        bridge.setDepositAction(externalToken, externalChainId, bridgedTokenAddress, uint(DepositAction.AUTO_SAVE), true);
        adminRegistry.addWhitelist(bridgeAddress, "depositWithAction", address(relayer));
        relayer.do(
            bridgeAddress, "depositWithAction",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, uint(DepositAction.AUTO_SAVE), address(0), 0
        );

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: action deposits are not fillable",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 0, false, 0
        );
    }

    // ============ The user's abort hatch closes once a solver has paid ============

    function it_fastpath_user_cannot_abort_a_claimed_withdrawal() {
        user.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        bridgedToken.mint(recipient, 100e18);

        uint256 id = user.do(
            bridgeAddress, "requestWithdrawalWithFee",
            externalChainId, externalRecipient, externalToken, bridgedTokenAddress, 100e18, 3e18
        );
        require(id > 0, "withdrawal created");

        (bool set, uint256 maxFee, uint256 requestedAt, uint256 halfLife) = bridge.withdrawalFeeTerms(id);
        require(set, "the schedule is committed at request time");
        require(maxFee == 3e18, "and carries the user's ceiling in external units");
        require(halfLife == HALF_LIFE, "and the half-life in force when they asked");
        require(requestedAt == block.timestamp, "starting now");

        relayer.do(
            bridgeAddress, "recordWithdrawalClaim",
            id, address(solverA), 0, 3e18, 97e18, block.timestamp, "0xabc123"
        );

        // The user's timeout hatch is what a solver most needs closed: they
        // have already been paid on the far chain.
        user.doExpectingFailure(
            bridgeAddress, "abortWithdrawal", "MB: claimed by solver", id
        );

        // Governance can still abort. That is the admin-rejection risk a
        // solver prices, and it must stay available for incidents.
        relayer.do(bridgeAddress, "abortWithdrawal", id);
    }

    function it_fastpath_withdrawal_claim_must_respect_the_schedule() {
        bridgedToken.mint(recipient, 100e18);
        user.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        uint256 id = user.do(
            bridgeAddress, "requestWithdrawalWithFee",
            externalChainId, externalRecipient, externalToken, bridgedTokenAddress, 100e18, 3e18
        );

        relayer.doExpectingFailure(
            bridgeAddress, "recordWithdrawalClaim", "MB: fee above schedule",
            id, address(solverA), 0, 4e18, 96e18, block.timestamp, "0xabc123"
        );
        relayer.doExpectingFailure(
            bridgeAddress, "recordWithdrawalClaim", "MB: net does not match",
            id, address(solverA), 0, 3e18, 90e18, block.timestamp, "0xabc123"
        );
        relayer.doExpectingFailure(
            bridgeAddress, "recordWithdrawalClaim", "MB: fill in the future",
            id, address(solverA), 0, 3e18, 97e18, block.timestamp + 100, "0xabc123"
        );
        relayer.doExpectingFailure(
            bridgeAddress, "recordWithdrawalClaim", "MB: first claim must be index zero",
            id, address(solverA), 1, 3e18, 97e18, block.timestamp, "0xabc123"
        );
    }

    /// @notice A later rung is solvers trading among themselves and is NOT
    ///         bounded by the user's ceiling -- the whole point of letting a
    ///         solver pay to get out of a claim they distrust.
    function it_fastpath_later_withdrawal_rungs_may_exceed_the_users_ceiling() {
        bridgedToken.mint(recipient, 100e18);
        user.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        uint256 id = user.do(
            bridgeAddress, "requestWithdrawalWithFee",
            externalChainId, externalRecipient, externalToken, bridgedTokenAddress, 100e18, 3e18
        );

        relayer.do(
            bridgeAddress, "recordWithdrawalClaim",
            id, address(solverA), 0, 3e18, 97e18, block.timestamp, "0xabc123"
        );
        relayer.do(
            bridgeAddress, "recordWithdrawalClaim",
            id, address(solverB), 1, 8e18, 92e18, block.timestamp, "0xdef456"
        );

        (address claimant, uint256 claimIndex, , uint256 feeCharged, ,) = bridge.withdrawalClaims(id);
        require(claimant == address(solverB), "the head of the ladder is the last claimant");
        require(claimIndex == 1, "at rung one");
        require(feeCharged == 8e18, "above the user's ceiling, which is fine: A paid for that");
    }

    // ============ Bonded announcements ============

    function it_fastpath_announcement_is_fillable_but_never_confirmable() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 3e18, block.timestamp
        );

        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(status == BridgeStatus.ANNOUNCED, "an announcement records the deposit as announced");
        require(IERC20(bondTokenAddress).balanceOf(bridgeAddress) == 10e18, "the bond is held by the bridge");
        require(bridge.bondedBalance(bondTokenAddress) == 10e18, "and accounted for separately from escrow");

        // The bridge must not mint against a stranger's claim.
        relayer.doExpectingFailure(
            bridgeAddress, "confirmDeposit", "MB: bad state", externalChainId, txHash
        );

        // But a solver may act on it, at their own risk.
        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        uint256 netPaid = solverA.do(
            bridgeAddress, "fillDeposit",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, false, 0
        );
        require(netPaid == 97e18, "the solver can front an announced deposit");
    }

    function it_fastpath_adopting_a_matching_announcement_returns_the_bond() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 3e18, block.timestamp
        );

        uint256 announcerBefore = IERC20(bondTokenAddress).balanceOf(address(announcer));
        _recordDeposit(100e18, 3e18, block.timestamp);

        require(
            IERC20(bondTokenAddress).balanceOf(address(announcer)) == announcerBefore + 10e18,
            "an announcement the relayer confirms gets its bond straight back"
        );
        require(bridge.bondedBalance(bondTokenAddress) == 0, "and stops being bonded");

        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(status == BridgeStatus.INITIATED, "the relayer's record takes over");
    }

    /// @notice Disagreeing with the relayer is not fraud. A superseded
    ///         announcement keeps its bond reclaimable, because the honest
    ///         reasons to differ are real -- a rebase adjustment, a reorg race.
    function it_fastpath_superseded_announcement_keeps_its_bond_reclaimable() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, address(0xBEEF), bridgedTokenAddress, 3e18, block.timestamp
        );

        uint256 announcerBefore = IERC20(bondTokenAddress).balanceOf(address(announcer));
        _recordDeposit(100e18, 3e18, block.timestamp);

        require(
            IERC20(bondTokenAddress).balanceOf(address(announcer)) == announcerBefore,
            "a mismatch is not refunded on the spot"
        );
        require(bridge.bondedBalance(bondTokenAddress) == 10e18, "the bond stays held");

        // ...but it is not confiscated either. It is reclaimable once the TTL
        // has run, which this test cannot advance; what it can check is that
        // the bond is still live rather than slashed.
        (,,,, uint256 state) = bridge.depositAnnouncements(externalChainId, txHash);
        require(state == 1, "the announcement is still live, not slashed");

        announcer.doExpectingFailure(
            bridgeAddress, "reclaimAnnouncementBond", "MB: bond not yet reclaimable",
            externalChainId, txHash
        );
    }

    function it_fastpath_governance_can_slash_a_fake_announcement() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 3e18, block.timestamp
        );

        uint256 treasuryBefore = IERC20(bondTokenAddress).balanceOf(treasury);
        bridge.rejectAnnouncement(externalChainId, txHash);

        require(
            IERC20(bondTokenAddress).balanceOf(treasury) == treasuryBefore + 10e18,
            "the bond goes to the treasury"
        );
        require(bridge.bondedBalance(bondTokenAddress) == 0, "and stops being bonded");

        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(status == BridgeStatus.ABORTED, "a rejected announcement stops being fillable");

        announcer.doExpectingFailure(
            bridgeAddress, "reclaimAnnouncementBond", "MB: bond already resolved",
            externalChainId, txHash
        );
    }

    function it_fastpath_only_owner_may_slash() {
        announcer.do(bondTokenAddress, "approve", bridgeAddress, 10e18);
        announcer.do(
            bridgeAddress, "announceDeposit",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 3e18, block.timestamp
        );

        bool reverted = false;
        try {
            solverA.do(bridgeAddress, "rejectAnnouncement", externalChainId, txHash);
        } catch {
            reverted = true;
        }
        require(reverted, "a solver cannot confiscate an announcer's bond");
    }

    // ============ Switches fail closed ============

    function it_fastpath_is_off_until_configured() {
        bridge.setFeeConfig(HALF_LIFE, FEE_BPS, false);
        _recordDeposit(100e18, 3e18, block.timestamp);

        solverA.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        solverA.doExpectingFailure(
            bridgeAddress, "fillDeposit", "MB: fills disabled",
            externalChainId, txHash, recipient, bridgedTokenAddress, 100e18, 3e18, false, 0
        );

        bridge.setAnnouncementConfig(false, address(0), 0, address(0), 0);
        announcer.doExpectingFailure(
            bridgeAddress, "announceDeposit", "MB: announcements disabled",
            externalChainId, externalSender, externalToken, 100e18,
            "0xdeadbeef01", recipient, bridgedTokenAddress, 3e18, block.timestamp
        );
    }

    function it_fastpath_fee_above_the_ceiling_is_refused_at_request_time() {
        // 5% ceiling, so 6 on 100 is out of bounds.
        relayer.doExpectingFailure(
            bridgeAddress, "depositWithFee", "MB: fee too large",
            externalChainId, externalSender, externalToken, 100e18,
            txHash, recipient, bridgedTokenAddress, 6e18, block.timestamp
        );

        bridgedToken.mint(recipient, 100e18);
        user.do(bridgedTokenAddress, "approve", bridgeAddress, 100e18);
        user.doExpectingFailure(
            bridgeAddress, "requestWithdrawalWithFee", "MB: fee too large",
            externalChainId, externalRecipient, externalToken, bridgedTokenAddress, 100e18, 6e18
        );
    }

    function it_fastpath_rejects_an_invalid_decay_configuration() {
        bool reverted = false;
        try {
            bridge.setFeeConfig(0, FEE_BPS, true);
        } catch {
            reverted = true;
        }
        require(reverted, "a zero half-life would be a cliff, not a decay");

        reverted = false;
        try {
            bridge.setFeeConfig(259201, FEE_BPS, true);
        } catch {
            reverted = true;
        }
        require(reverted, "a half-life longer than the window is the same cliff");

        reverted = false;
        try {
            bridge.setFeeConfig(HALF_LIFE, 10001, true);
        } catch {
            reverted = true;
        }
        require(reverted, "a ceiling over 100% is meaningless");
    }

    // ============ StratoNativeBridge: the same shape, a vault instead of a mint ============

    function _recordNativeDeposit(uint256 amount, uint256 maxFee, uint256 requestedAt) internal returns (string) {
        relayer.do(
            nativeBridgeAddress, "recordDepositWithFee",
            externalChainId, externalBridge, 7, externalSender, txHash,
            representationToken, recipient, amount, maxFee, requestedAt
        );
        return nativeBridge.getDepositId(externalChainId, externalBridge, 7);
    }

    /// @dev The vault can only unlock what it holds, so an inbound deposit has
    ///      to be backed by a prior outbound lock. That is true in production
    ///      too: the native bridge is a lock/unlock pair, not a mint.
    function _lockIntoVault(uint256 amount) internal {
        user.do(nativeTokenAddress, "approve", custodyVaultAddress, amount);
        user.do(
            nativeBridgeAddress, "requestWithdrawal",
            externalChainId, externalRecipient, nativeTokenAddress, amount
        );
    }

    function it_fastpath_native_deposit_fill_redirects_the_vault_unlock() {
        _lockIntoVault(100e18);
        string depositId = _recordNativeDeposit(100e18, 3e18, block.timestamp);

        uint256 recipientBefore = IERC20(nativeTokenAddress).balanceOf(recipient);
        uint256 solverBefore = IERC20(nativeTokenAddress).balanceOf(address(solverA));

        solverA.do(nativeTokenAddress, "approve", nativeBridgeAddress, 100e18);
        uint256 netPaid = solverA.do(
            nativeBridgeAddress, "fillDeposit",
            depositId, recipient, nativeTokenAddress, 100e18, 3e18, false, 0
        );
        require(netPaid == 97e18, "the recipient is paid the amount less the fee");
        require(
            IERC20(nativeTokenAddress).balanceOf(recipient) == recipientBefore + 97e18,
            "immediately, out of the solver's own balance"
        );

        relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, 7);

        require(
            IERC20(nativeTokenAddress).balanceOf(address(solverA)) == solverBefore + 3e18,
            "the vault unlocks to the solver, netting them the fee"
        );
        require(
            custodyVault.lockedBalance(nativeTokenAddress) == 0,
            "and the vault's liability is discharged exactly once"
        );
    }

    function it_fastpath_native_claim_ladder_respects_the_holder() {
        _lockIntoVault(100e18);
        string depositId = _recordNativeDeposit(100e18, 3e18, block.timestamp);

        solverA.do(nativeTokenAddress, "approve", nativeBridgeAddress, 100e18);
        solverA.do(
            nativeBridgeAddress, "fillDeposit",
            depositId, recipient, nativeTokenAddress, 100e18, 3e18, false, 0
        );

        solverB.do(nativeTokenAddress, "approve", nativeBridgeAddress, 100e18);
        solverB.doExpectingFailure(
            nativeBridgeAddress, "fillDeposit", "SNB: claim not transferable",
            depositId, recipient, nativeTokenAddress, 100e18, 0, false, 0
        );

        // Quoting above what is on offer is refused even once it is for sale.
        solverA.do(nativeBridgeAddress, "setDepositClaimExitOffer", depositId, true, 1e18);
        solverB.doExpectingFailure(
            nativeBridgeAddress, "fillDeposit", "SNB: fee below your minimum",
            depositId, recipient, nativeTokenAddress, 100e18, 2e18, false, 0
        );
        solverA.do(nativeBridgeAddress, "setDepositClaimExitOffer", depositId, false, 0);

        solverA.do(nativeBridgeAddress, "setDepositClaimExitOffer", depositId, true, 1e18);

        uint256 aBefore = IERC20(nativeTokenAddress).balanceOf(address(solverA));
        solverB.do(
            nativeBridgeAddress, "fillDeposit",
            depositId, recipient, nativeTokenAddress, 100e18, 1e18, false, 0
        );
        require(
            IERC20(nativeTokenAddress).balanceOf(address(solverA)) == aBefore + 99e18,
            "the displaced solver is paid their asking price"
        );

        relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, 7);
        (address claimant,,,,,,,,,,,,,) = nativeBridge.depositClaims(depositId);
        require(claimant == address(solverB), "and the last claimant took the unlock");
    }

    function it_fastpath_native_user_cannot_abort_a_claimed_withdrawal() {
        user.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user.do(
            nativeBridgeAddress, "requestWithdrawalWithFee",
            externalChainId, externalRecipient, nativeTokenAddress, 50e18, 1e18
        );

        relayer.do(
            nativeBridgeAddress, "recordWithdrawalClaim",
            id, address(solverA), 0, 1e18, 49e18, block.timestamp, "0xabc123"
        );

        user.doExpectingFailure(
            nativeBridgeAddress, "abortWithdrawal", "SNB: claimed by solver", id
        );
        relayer.do(nativeBridgeAddress, "abortWithdrawal", id);
    }

    function it_fastpath_native_announcement_is_fillable_but_never_confirmable() {
        _lockIntoVault(100e18);

        announcer.do(bondTokenAddress, "approve", nativeBridgeAddress, 10e18);
        string depositId = announcer.do(
            nativeBridgeAddress, "announceDeposit",
            externalChainId, externalBridge, 7, externalSender, txHash,
            representationToken, recipient, 100e18, 3e18, block.timestamp
        );

        (BridgeStatus status,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(status == BridgeStatus.ANNOUNCED, "announced, not initiated");

        relayer.doExpectingFailure(
            nativeBridgeAddress, "confirmDeposit", "SNB: bad state",
            externalChainId, externalBridge, 7
        );

        solverA.do(nativeTokenAddress, "approve", nativeBridgeAddress, 100e18);
        uint256 netPaid = solverA.do(
            nativeBridgeAddress, "fillDeposit",
            depositId, recipient, nativeTokenAddress, 100e18, 3e18, false, 0
        );
        require(netPaid == 97e18, "a solver may still front it");

        uint256 announcerBefore = IERC20(bondTokenAddress).balanceOf(address(announcer));
        relayer.do(
            nativeBridgeAddress, "recordDepositWithFee",
            externalChainId, externalBridge, 7, externalSender, txHash,
            representationToken, recipient, 100e18, 3e18, block.timestamp
        );
        require(
            IERC20(bondTokenAddress).balanceOf(address(announcer)) == announcerBefore + 10e18,
            "adoption returns the bond"
        );

        uint256 solverBefore = IERC20(nativeTokenAddress).balanceOf(address(solverA));
        relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, 7);
        require(
            IERC20(nativeTokenAddress).balanceOf(address(solverA)) == solverBefore + 100e18,
            "and the solver is made whole on settlement"
        );
    }
}
