import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";

// Unit tests against unpaused tokens. The converter sits behind a Proxy owned by `owner`.
contract Describe_RewardsConverter {
    constructor() {}

    User owner;
    User alice;
    User stranger;

    Token rewardsToken;
    Token stratoToken;
    address conv;

    uint256 constant WAD = 1e18;
    uint256 constant ALICE_REWARDS = 1000e18;
    uint256 constant RESERVE = 5000e18;

    function beforeAll() {
        owner = new User();
        alice = new User();
        stranger = new User();
    }

    function beforeEach() {
        rewardsToken = _newToken("Rewards Token", "RWD");
        stratoToken = _newToken("STRATO", "STRATO");

        conv = _newConverter();
        owner.do(conv, "initialize", address(rewardsToken), address(stratoToken), WAD, false);

        ERC20(rewardsToken).transfer(address(alice), ALICE_REWARDS);
        ERC20(stratoToken).transfer(conv, RESERVE);
    }

    // Behind a Proxy, like every token the TokenFactory creates
    function _newToken(string name, string symbol) internal returns (Token) {
        Token token = Token(address(new Proxy(address(new Token(address(this))), address(this))));
        token.initialize(name, name, [], [], [], symbol, 1000000e18, 18, address(this));
        return token;
    }

    function _newConverter() internal returns (address) {
        return address(new Proxy(address(new RewardsConverter(address(this))), address(owner)));
    }

    function _rewards(address a) internal returns (uint256) {
        return ERC20(rewardsToken).balanceOf(a);
    }

    function _strato(address a) internal returns (uint256) {
        return ERC20(stratoToken).balanceOf(a);
    }

    function _approveAndConvert(uint256 amount) internal {
        alice.do(address(rewardsToken), "approve", conv, amount);
        alice.do(conv, "convert", amount);
    }

    function _fails(User user, address target, string f, variadic args) internal returns (bool) {
        try user.do(target, f, args) {
            return false;
        } catch {
            return true;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // INITIALIZE
    // ═════════════════════════════════════════════════════════════════════════

    function it_aa_initialize_sets_fields_and_the_pause_flag() {
        address paused = _newConverter();
        require(!Pausable(paused).paused(), "Should not be paused before initialize");

        owner.do(paused, "initialize", address(rewardsToken), address(stratoToken), 2 * WAD, true);

        require(RewardsConverter(paused).rewardsToken() == address(rewardsToken), "rewardsToken not set");
        require(RewardsConverter(paused).stratoToken() == address(stratoToken), "stratoToken not set");
        require(RewardsConverter(paused).rate() == 2 * WAD, "rate not set");
        require(Pausable(paused).paused(), "Should be paused when initialized paused");

        address live = _newConverter();
        owner.do(live, "initialize", address(rewardsToken), address(stratoToken), 2 * WAD, false);
        require(RewardsConverter(live).rate() == 2 * WAD, "rate not set when starting unpaused");
        require(!Pausable(live).paused(), "Should stay unpaused when initialized unpaused");
    }

    function it_ab_initialize_rejects_non_owner() {
        address fresh = _newConverter();
        require(_fails(stranger, fresh, "initialize", address(rewardsToken), address(stratoToken), WAD, true), "Non-owner should not initialize");
        require(RewardsConverter(fresh).rewardsToken() == address(0), "Failed initialize should set nothing");

        owner.do(fresh, "initialize", address(rewardsToken), address(stratoToken), WAD, true);
    }

    function it_ac_initialize_only_once() {
        owner.doExpectingFailure(conv, "initialize", "RewardsConverter: already initialized", address(stratoToken), address(rewardsToken), 2 * WAD, true);
        require(RewardsConverter(conv).rewardsToken() == address(rewardsToken), "rewardsToken should not change");
        require(RewardsConverter(conv).stratoToken() == address(stratoToken), "stratoToken should not change");
        require(RewardsConverter(conv).rate() == WAD, "rate should not change");
    }

    function it_ad_initialize_rejects_zero_addresses_and_zero_rate() {
        address fresh = _newConverter();
        owner.doExpectingFailure(fresh, "initialize", "RewardsConverter: invalid rewards token address", address(0), address(stratoToken), WAD, true);
        owner.doExpectingFailure(fresh, "initialize", "RewardsConverter: invalid strato token address", address(rewardsToken), address(0), WAD, true);
        owner.doExpectingFailure(fresh, "initialize", "RewardsConverter: zero rate", address(rewardsToken), address(stratoToken), uint256(0), true);
        require(!Pausable(fresh).paused(), "Failed initialize should not pause");

        owner.do(fresh, "initialize", address(rewardsToken), address(stratoToken), WAD, true);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONVERT
    // ═════════════════════════════════════════════════════════════════════════

    function it_ba_convert_at_one_to_one() {
        uint256 amount = 400e18;
        uint256 supplyBefore = ERC20(rewardsToken).totalSupply();

        _approveAndConvert(amount);

        require(_rewards(address(alice)) == ALICE_REWARDS - amount, "Caller rewards balance should drop by amount");
        require(ERC20(rewardsToken).totalSupply() == supplyBefore - amount, "Rewards supply should drop by amount");
        require(_rewards(conv) == 0, "Converter should hold no rewards tokens");
        require(_strato(address(alice)) == amount, "Caller should receive amount STRATO");
        require(_strato(conv) == RESERVE - amount, "Reserve should drop by the payout");
    }

    function it_bb_convert_at_other_rates_rounds_down() {
        uint256 supplyBefore = ERC20(rewardsToken).totalSupply();

        // 0.3 STRATO per rewards token; 7 * 0.3 = 2.1 rounds down to 2
        owner.do(conv, "setRate", 3e17);
        _approveAndConvert(7);
        require(_strato(address(alice)) == 2, "Payout should round down");

        // 2.5 STRATO per rewards token
        owner.do(conv, "setRate", 25e17);
        uint256 amount = 100e18 + 1;
        _approveAndConvert(amount);
        require(_strato(address(alice)) == 2 + 250e18 + 2, "Caller should receive amount * rate / 1e18");

        require(_rewards(address(alice)) == ALICE_REWARDS - 7 - amount, "Caller rewards balance should drop by amount");
        require(ERC20(rewardsToken).totalSupply() == supplyBefore - 7 - amount, "Rewards supply should drop by amount");
        require(_rewards(conv) == 0, "Converter should hold no rewards tokens");
    }

    // The converter is neither owner nor whitelisted on the rewards token, so the burn can only
    // succeed through the self-burn overload burn(uint256), never burn(address,uint256).
    function it_bc_convert_burns_through_the_self_burn_overload() {
        require(Ownable(rewardsToken).owner() != conv, "Converter must not own the rewards token");
        require(_fails(alice, address(rewardsToken), "burn(address,uint256)", address(alice), uint256(1)), "Owner-gated burn should reject a non-owner");

        uint256 amount = 10e18;
        uint256 supplyBefore = ERC20(rewardsToken).totalSupply();
        _approveAndConvert(amount);

        require(ERC20(rewardsToken).totalSupply() == supplyBefore - amount, "Rewards supply should drop by amount");
        require(_rewards(conv) == 0, "Converter should hold no rewards tokens");
    }

    function it_bd_convert_fails_while_paused() {
        uint256 amount = 10e18;
        alice.do(address(rewardsToken), "approve", conv, amount);

        owner.do(conv, "pause");
        require(_fails(alice, conv, "convert", amount), "convert should fail while paused");
        require(_rewards(address(alice)) == ALICE_REWARDS, "Failed convert should take nothing");

        owner.do(conv, "unpause");
        alice.do(conv, "convert", amount);
    }

    function it_be_convert_rejects_zero_amount() {
        alice.doExpectingFailure(conv, "convert", "RewardsConverter: zero amount", uint256(0));
    }

    function it_bf_convert_rejects_a_payout_rounding_to_zero() {
        // 1 wei of STRATO per whole rewards token
        owner.do(conv, "setRate", 1);
        alice.do(address(rewardsToken), "approve", conv, WAD);

        alice.doExpectingFailure(conv, "convert", "RewardsConverter: zero payout", WAD - 1);
        require(_rewards(address(alice)) == ALICE_REWARDS, "Failed convert should take nothing");

        alice.do(conv, "convert", WAD);
        require(_strato(address(alice)) == 1, "One whole rewards token should pay 1 wei");
    }

    function it_bg_convert_fails_when_reserve_is_short_by_one_wei() {
        uint256 amount = 100e18;
        uint256 supplyBefore = ERC20(rewardsToken).totalSupply();
        owner.do(conv, "withdrawReserve", address(owner), RESERVE - amount + 1);
        require(_strato(conv) == amount - 1, "Reserve should be 1 wei short");
        alice.do(address(rewardsToken), "approve", conv, amount);

        alice.doExpectingFailure(conv, "convert", "RewardsConverter: insufficient reserve", amount);
        require(_rewards(address(alice)) == ALICE_REWARDS, "Failed convert should take nothing");
        require(ERC20(rewardsToken).totalSupply() == supplyBefore, "Failed convert should burn nothing");
        require(_strato(address(alice)) == 0, "No partial fill");

        ERC20(stratoToken).transfer(conv, 1);
        alice.do(conv, "convert", amount);
        require(_strato(address(alice)) == amount, "Convert should succeed once the reserve covers it");
        require(_strato(conv) == 0, "Reserve should be drained");
    }

    function it_bh_convert_fails_without_enough_allowance() {
        uint256 amount = 100e18;
        alice.doExpectingFailure(conv, "convert", "ERC20: insufficient allowance", amount);

        alice.do(address(rewardsToken), "approve", conv, amount - 1);
        alice.doExpectingFailure(conv, "convert", "ERC20: insufficient allowance", amount);
        require(_rewards(address(alice)) == ALICE_REWARDS, "Failed convert should take nothing");
        require(_strato(address(alice)) == 0, "Failed convert should pay nothing");

        alice.do(address(rewardsToken), "approve", conv, amount);
        alice.do(conv, "convert", amount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SET RATE
    // ═════════════════════════════════════════════════════════════════════════

    function it_ca_setRate_only_owner() {
        require(_fails(stranger, conv, "setRate", 2 * WAD), "Non-owner should not set the rate");
        require(RewardsConverter(conv).rate() == WAD, "rate should not change");
    }

    function it_cb_setRate_rejects_zero() {
        owner.doExpectingFailure(conv, "setRate", "RewardsConverter: zero rate", uint256(0));
        require(RewardsConverter(conv).rate() == WAD, "rate should not change");
    }

    function it_cc_setRate_applies_to_the_next_convert() {
        _approveAndConvert(10e18);
        require(_strato(address(alice)) == 10e18, "First convert should pay 1:1");

        owner.do(conv, "setRate", 2 * WAD);
        require(RewardsConverter(conv).rate() == 2 * WAD, "rate should update");

        _approveAndConvert(10e18);
        require(_strato(address(alice)) == 10e18 + 20e18, "Second convert should pay the new rate");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // WITHDRAW RESERVE
    // ═════════════════════════════════════════════════════════════════════════

    function it_da_withdrawReserve_only_owner() {
        require(_fails(stranger, conv, "withdrawReserve", address(stranger), uint256(1)), "Non-owner should not withdraw");
        require(_strato(conv) == RESERVE, "Reserve should not change");
    }

    function it_db_withdrawReserve_works_while_paused_and_reduces_maxConvertible() {
        require(RewardsConverter(conv).maxConvertible() == RESERVE, "maxConvertible should equal the reserve at 1:1");

        owner.do(conv, "pause");
        owner.do(conv, "withdrawReserve", address(stranger), 1200e18);

        require(_strato(address(stranger)) == 1200e18, "Recipient should receive the withdrawal");
        require(_strato(conv) == RESERVE - 1200e18, "Reserve should drop by the withdrawal");
        require(RewardsConverter(conv).maxConvertible() == RESERVE - 1200e18, "maxConvertible should drop by the withdrawal");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PAUSE / UNPAUSE
    // ═════════════════════════════════════════════════════════════════════════

    function it_ea_pause_and_unpause_only_owner() {
        require(_fails(stranger, conv, "pause"), "Non-owner should not pause");
        require(!Pausable(conv).paused(), "Should still be unpaused");

        owner.do(conv, "pause");
        require(Pausable(conv).paused(), "Owner should pause");

        require(_fails(stranger, conv, "unpause"), "Non-owner should not unpause");
        require(Pausable(conv).paused(), "Should still be paused");

        owner.do(conv, "unpause");
        require(!Pausable(conv).paused(), "Owner should unpause");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // MAX CONVERTIBLE
    // ═════════════════════════════════════════════════════════════════════════

    function it_fa_maxConvertible_is_zero_before_initialize() {
        address fresh = _newConverter();
        ERC20(stratoToken).transfer(fresh, 100e18);
        require(RewardsConverter(fresh).maxConvertible() == 0, "maxConvertible should be 0 before initialize");
    }

    function it_fb_maxConvertible_matches_reserve_over_rate() {
        owner.do(conv, "setRate", 3 * WAD);
        require(RewardsConverter(conv).maxConvertible() == RESERVE * WAD / (3 * WAD), "maxConvertible should be balance * 1e18 / rate");

        owner.do(conv, "setRate", 4e17);
        require(RewardsConverter(conv).maxConvertible() == RESERVE * WAD / 4e17, "maxConvertible should be balance * 1e18 / rate");
    }

    function it_fc_convert_of_exactly_maxConvertible_succeeds_and_one_more_wei_fails() {
        // 2 STRATO per rewards token against a 600 STRATO reserve: exactly 300 rewards tokens
        owner.do(conv, "setRate", 2 * WAD);
        owner.do(conv, "withdrawReserve", address(owner), RESERVE - 600e18);
        uint256 max = RewardsConverter(conv).maxConvertible();
        require(max == 300e18, "maxConvertible should be 300 rewards tokens");
        alice.do(address(rewardsToken), "approve", conv, max + 1);

        alice.doExpectingFailure(conv, "convert", "RewardsConverter: insufficient reserve", max + 1);

        alice.do(conv, "convert", max);
        require(_strato(address(alice)) == 600e18, "Caller should receive the whole reserve");
        require(_strato(conv) == 0, "Reserve should be drained");
        require(RewardsConverter(conv).maxConvertible() == 0, "maxConvertible should be 0 once drained");
    }
}

// Mainnet condition: both tokens and the converter are owned by a real AdminRegistry, both
// tokens are paused, and the converter moves them only through registry whitelist grants.
contract Describe_RewardsConverter_PausedTokens {
    constructor() {}

    User alice;

    AdminRegistry adminRegistry;
    address rewardsToken;
    address stratoToken;
    address conv;

    uint256 constant ALICE_REWARDS = 1000e18;
    uint256 constant RESERVE = 5000e18;
    uint256 constant AMOUNT = 400e18;

    function beforeAll() {
        alice = new User();
    }

    function beforeEach() {
        adminRegistry = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        adminRegistry.initialize([this]);
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));

        TokenFactory tokenFactory = new TokenFactory(address(adminRegistry));
        rewardsToken = _createToken(tokenFactory, "Rewards Token", "RWD");
        stratoToken = _createToken(tokenFactory, "STRATO", "STRATO");

        conv = address(new Proxy(address(new RewardsConverter(address(this))), address(adminRegistry)));
        _vote(conv, "initialize", rewardsToken, stratoToken, 1e18, false);

        _vote(rewardsToken, "mint", address(alice), ALICE_REWARDS);
        _vote(stratoToken, "mint", conv, RESERVE);
        _vote(rewardsToken, "pause");
        _vote(stratoToken, "pause");

        // approve is not pause-gated
        alice.do(rewardsToken, "approve", conv, AMOUNT);
    }

    function _vote(address target, string f, variadic args) internal returns (variadic) {
        (bool executed, variadic ret) = adminRegistry.castVoteOnIssue(target, f, args);
        require(executed, "Vote did not execute: " + f);
        return ret;
    }

    function _createToken(TokenFactory tokenFactory, string name, string symbol) internal returns (address) {
        return address(_vote(address(tokenFactory), "createToken", name, name, [], [], [], symbol, 0, 18));
    }

    function _whitelistRewardsTransferFrom() internal {
        _vote(address(adminRegistry), "addWhitelist", rewardsToken, "transferFrom", conv);
    }

    function _whitelistStratoTransfer() internal {
        _vote(address(adminRegistry), "addWhitelist", stratoToken, "transfer", conv);
    }

    function _requireNothingMoved() internal {
        require(ERC20(rewardsToken).balanceOf(address(alice)) == ALICE_REWARDS, "Failed convert should take nothing");
        require(ERC20(rewardsToken).totalSupply() == ALICE_REWARDS, "Failed convert should burn nothing");
        require(ERC20(stratoToken).balanceOf(address(alice)) == 0, "Failed convert should pay nothing");
        require(ERC20(stratoToken).balanceOf(conv) == RESERVE, "Failed convert should leave the reserve");
    }

    function _requireConverted() internal {
        require(ERC20(rewardsToken).balanceOf(address(alice)) == ALICE_REWARDS - AMOUNT, "Caller rewards balance should drop by amount");
        require(ERC20(rewardsToken).totalSupply() == ALICE_REWARDS - AMOUNT, "Rewards supply should drop by amount");
        require(ERC20(rewardsToken).balanceOf(conv) == 0, "Converter should hold no rewards tokens");
        require(ERC20(stratoToken).balanceOf(address(alice)) == AMOUNT, "Caller should receive amount STRATO");
        require(ERC20(stratoToken).balanceOf(conv) == RESERVE - AMOUNT, "Reserve should drop by the payout");
    }

    function it_aa_setup_matches_mainnet() {
        require(Ownable(rewardsToken).owner() == address(adminRegistry), "Registry should own the rewards token");
        require(Ownable(stratoToken).owner() == address(adminRegistry), "Registry should own STRATO");
        require(Ownable(conv).owner() == address(adminRegistry), "Registry should own the converter");
        require(Pausable(rewardsToken).paused(), "Rewards token should be paused");
        require(Pausable(stratoToken).paused(), "STRATO should be paused");
        require(!Pausable(conv).paused(), "Converter should be unpaused");
    }

    function it_ab_convert_succeeds_with_both_grants() {
        _whitelistRewardsTransferFrom();
        _whitelistStratoTransfer();

        alice.do(conv, "convert", AMOUNT);
        _requireConverted();
    }

    function it_ac_convert_fails_without_any_grant() {
        alice.doExpectingFailure(conv, "convert", "not whitelisted", AMOUNT);
        _requireNothingMoved();
    }

    function it_ad_convert_fails_without_the_rewards_transferFrom_grant() {
        _whitelistStratoTransfer();
        alice.doExpectingFailure(conv, "convert", "not whitelisted", AMOUNT);
        _requireNothingMoved();

        _whitelistRewardsTransferFrom();
        alice.do(conv, "convert", AMOUNT);
        _requireConverted();
    }

    function it_ae_convert_fails_without_the_strato_transfer_grant() {
        _whitelistRewardsTransferFrom();
        alice.doExpectingFailure(conv, "convert", "not whitelisted", AMOUNT);
        _requireNothingMoved();

        _whitelistStratoTransfer();
        alice.do(conv, "convert", AMOUNT);
        _requireConverted();
    }
}
