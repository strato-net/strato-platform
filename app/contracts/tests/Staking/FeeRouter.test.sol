import "../../concrete/Staking/FeeRouter.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../Util.sol";

contract record MockGovernance {
    address public stakingContract;
    function setStakingContract(address s) public { stakingContract = s; }
}

contract record MockStaking {
    uint public proposerFeeBps;
    uint public processed;
    bool public revertOnProcess;
    bool public refuseRewards;
    address public stratoToken;
    mapping(address => uint) public record rewarded;
    function setProposerFeeBps(uint bps) public { proposerFeeBps = bps; }
    function setStratoToken(address t) public { stratoToken = t; }
    function setRevertOnProcess(bool r) public { revertOnProcess = r; }
    function setRefuseRewards(bool r) public { refuseRewards = r; }
    function processBlock() external {
        require(!revertOnProcess, "MockStaking: boom");
        processed += 1;
    }
    // Pulls the reward like StratoStaking.creditBlockReward.
    function creditBlockReward(address validator, uint amount) external {
        require(!refuseRewards, "MockStaking: validator not listed");
        require(Token(stratoToken).transferFrom(msg.sender, address(this), amount), "MockStaking: pull failed");
        rewarded[validator] += amount;
    }
}

// Helium's genesis MercataGovernance has no stakingContract() at all, so the lookup
// fails outright rather than answering zero. payFees has to survive that: a throw
// here would fail every transaction on the chain.
contract record LegacyGovernance {
    uint public validators;
    function voteToAddValidator(address proposed) public { validators += 1; }
}

contract record MockVoucher {
    mapping(address => uint) public balances;
    function mint(address to, uint amount) public { balances[to] += amount; }
    function burn(address from, uint amount) public {
        require(balances[from] >= amount, "no voucher");
        balances[from] -= amount;
    }
}

// The router reads its addresses through internal getters; the harness serves them
// from storage. Because SolidVM storage is name-keyed, a Signer that *is* a harness
// and DELEGATECALLs the router runs the router's code against its own addresses —
// exactly the signer-context execution the platform performs for payFees.
contract record FeeRouterHarness is FeeRouter {
    address public voucherAddr;
    address public usdstAddr;
    address public feeCollectorAddr;
    address public governanceAddr;
    address public stakingFallbackAddr;
    address public stratoAddr;
    address public priceOracleAddr;

    function configure(address v, address u, address f, address g) public {
        voucherAddr = v;
        usdstAddr = u;
        feeCollectorAddr = f;
        governanceAddr = g;
    }

    function configureStrato(address s, address o) public {
        stratoAddr = s;
        priceOracleAddr = o;
    }

    function setStakingFallback(address s) public { stakingFallbackAddr = s; }

    function _voucher() internal view override returns (address) { return voucherAddr; }
    function _usdst() internal view override returns (address) { return usdstAddr; }
    function _feeCollector() internal view override returns (address) { return feeCollectorAddr; }
    function _governance() internal view override returns (address) { return governanceAddr; }
    function _stakingFallback() internal view override returns (address) { return stakingFallbackAddr; }
    function _strato() internal view override returns (address) { return stratoAddr; }
    function _priceOracle() internal view override returns (address) { return priceOracleAddr; }
}

contract record Signer is FeeRouterHarness {
    function pay(address router) public {
        address(router).delegatecall("payFees");
    }
}

contract Describe_FeeRouter {
    address constant PROPOSER = address(0xaaaa);

    TokenFactory factory;
    Token usdst;
    MockGovernance gov;
    MockStaking staking;
    MockVoucher voucher;
    FeeRouterHarness router;
    Signer signer;
    User feeCollector;
    PriceOracle oracle;

    function beforeAll() public {
        feeCollector = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        usdst = Token(factory.createTokenWithInitialOwner("USDST", "USDST Token", new string[](0), new string[](0), new string[](0), "USDST", 0, 18, address(this)));
        usdst.setStatus(2);

        gov = new MockGovernance();
        staking = new MockStaking();
        voucher = new MockVoucher();
        router = new FeeRouterHarness();
        signer = new Signer();
        signer.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        usdst.mint(address(signer), 1e18);
    }

    function it_sends_the_whole_fee_to_the_collector_without_staking() public {
        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "collector got $0.01");
        require(usdst.balanceOf(address(signer)) == 1e18 - 1e16, "signer paid");
        require(staking.processed() == 0, "no staking to notify");
    }

    function it_splits_the_fee_and_notifies_staking() public {
        gov.setStakingContract(address(staking));
        staking.setProposerFeeBps(5000);

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 5e15, "collector half");
        require(usdst.balanceOf(address(staking)) == 5e15, "staking half");
        require(staking.processed() == 1, "processBlock called");

        staking.setProposerFeeBps(20000);
        signer.pay(address(router));
        require(usdst.balanceOf(address(staking)) == 5e15 + 1e16, "share capped at 100%");
        require(usdst.balanceOf(address(feeCollector)) == 5e15, "collector unchanged");
    }

    // Helium's genesis governance predates staking, so it answers stakingContract()
    // with nothing and the router has to reach staking through the subclassed fallback.
    // Point the router itself (not just the signer) at the mocks, since
    // payBlockRewards is a plain call and resolves against the router's storage.
    function _fundedRouter() internal returns (Token) {
        Token strato = Token(factory.createTokenWithInitialOwner(
            "STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        staking.setStratoToken(address(strato));
        gov.setStakingContract(address(staking));
        router.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        // Off block 0 first: the latch's zero default is indistinguishable from
        // "already rewarded" there, which only ever coincides with genesis.
        fastForward(1, 1);
        setBlockContext(PROPOSER, address(0), address(0), 0);
        return strato;
    }

    function it_routes_a_flat_block_reward_through_staking_for_the_proposer() public {
        Token strato = _fundedRouter();
        strato.mint(address(router), 1e18);

        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 1e16, "staking credited the proposer 0.01 STRATO");
        require(strato.balanceOf(address(staking)) == 1e16, "the reward moved into staking");
        require(strato.balanceOf(PROPOSER) == 0, "nothing paid to the node address directly");
        require(strato.balanceOf(address(router)) == 1e18 - 1e16, "paid out of the router's balance");
    }

    // The platform pays once per block on its own, but the latch has to hold too:
    // if a repeat call ever paid twice, the proposer and the verifier would derive
    // different state roots and the chain would stop committing.
    function it_pays_block_rewards_at_most_once_per_block() public {
        Token strato = _fundedRouter();
        strato.mint(address(router), 1e18);

        router.payBlockRewards();
        router.payBlockRewards();
        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 1e16, "repeat calls in one block pay nothing");

        fastForward(1, 1);
        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 2e16, "the next block pays again");
    }

    // A router that has run dry must not take the chain down with it.
    function it_survives_an_unfunded_router() public {
        Token strato = _fundedRouter();

        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 0, "nothing paid");
        require(router.lastRewardedBlock() == block.number, "still latched, so it is not retried");
    }

    // A proposer staking will not credit (not listed, delisted) is not paid, and the
    // reward stays with the router rather than leaking anywhere.
    function it_keeps_the_reward_when_staking_declines() public {
        Token strato = _fundedRouter();
        strato.mint(address(router), 1e18);
        staking.setRefuseRewards(true);

        router.payBlockRewards();
        require(strato.balanceOf(address(router)) == 1e18, "router keeps the reward");
        require(strato.balanceOf(address(staking)) == 0, "staking pulled nothing");
        require(router.lastRewardedBlock() == block.number, "latched");
    }

    function it_falls_back_when_governance_cannot_name_staking() public {
        signer.setStakingFallback(address(staking));
        staking.setProposerFeeBps(5000);

        signer.pay(address(router));
        require(usdst.balanceOf(address(staking)) == 5e15, "staking half via the fallback");
        require(usdst.balanceOf(address(feeCollector)) == 5e15, "collector half");
        require(staking.processed() == 1, "processBlock called");
    }

    function it_survives_governance_without_a_staking_lookup() public {
        LegacyGovernance legacy = new LegacyGovernance();
        signer.configure(address(voucher), address(usdst), address(feeCollector), address(legacy));
        signer.setStakingFallback(address(staking));
        staking.setProposerFeeBps(1000);

        signer.pay(address(router));
        require(usdst.balanceOf(address(staking)) == 1e15, "staking share via the fallback");
        require(usdst.balanceOf(address(feeCollector)) == 9e15, "collector keeps the rest");
        require(staking.processed() == 1, "processBlock called");
    }

    // The pre-install state: no fallback either, so the router must degrade to the
    // legacy behaviour instead of failing the transaction.
    function it_pays_the_collector_when_nothing_can_name_staking() public {
        LegacyGovernance legacy = new LegacyGovernance();
        signer.configure(address(voucher), address(usdst), address(feeCollector), address(legacy));

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "whole fee to the collector");
        require(usdst.balanceOf(address(signer)) == 1e18 - 1e16, "signer paid exactly once");
    }

    function it_prefers_governance_over_the_fallback() public {
        MockStaking named = new MockStaking();
        gov.setStakingContract(address(named));
        named.setProposerFeeBps(5000);
        signer.setStakingFallback(address(staking));

        signer.pay(address(router));
        require(usdst.balanceOf(address(named)) == 5e15, "governance's answer wins");
        require(usdst.balanceOf(address(staking)) == 0, "stale fallback unused");
        require(staking.processed() == 0, "stale fallback not notified");
    }

    function it_still_notifies_staking_on_the_voucher_path() public {
        gov.setStakingContract(address(staking));
        Signer voucherOnly = _signerWithVoucher();

        voucherOnly.pay(address(router));
        require(voucher.balances(address(voucherOnly)) == 0, "voucher burned");
        require(usdst.balanceOf(address(feeCollector)) == 0, "no USDST charged");
        require(staking.processed() == 1, "processBlock still called");
    }

    function it_swallows_process_block_failures() public {
        gov.setStakingContract(address(staking));
        staking.setRevertOnProcess(true);

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "fee paid although processBlock reverted");
    }

    // ---- payment order: STRATO, then USDST, then a voucher ----

    function _signerWithVoucher() internal returns (Signer) {
        Signer s = new Signer();
        s.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        voucher.mint(address(s), 1e18);
        return s;
    }

    // A STRATO token the signer holds 1 of, priced at `price` by a fresh oracle.
    function _stratoFees(uint price) internal returns (Token) {
        Token strato = Token(factory.createTokenWithInitialOwner(
            "STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        strato.mint(address(signer), 1e18);
        oracle = new PriceOracle(address(this));
        if (price > 0) oracle.setAssetPrice(address(strato), price);
        signer.configureStrato(address(strato), address(oracle));
        return strato;
    }

    function it_charges_a_cents_worth_of_strato_at_the_oracle_price() public {
        Token strato = _stratoFees(5e17); // $0.50
        voucher.mint(address(signer), 1e18);

        signer.pay(address(router));
        require(strato.balanceOf(address(feeCollector)) == 2e16, "0.02 STRATO at $0.50");
        require(strato.balanceOf(address(signer)) == 1e18 - 2e16, "signer paid in STRATO");
        require(usdst.balanceOf(address(signer)) == 1e18, "no USDST charged");
        require(voucher.balances(address(signer)) == 1e18, "no voucher burned");
    }

    function it_rounds_the_strato_fee_up() public {
        Token strato = _stratoFees(3e18); // $3: 1/300 STRATO is not a whole number of wei

        signer.pay(address(router));
        require(strato.balanceOf(address(feeCollector)) == 3333333333333334, "rounded up");
    }

    // STRATO fees are not split with staking yet: the whole fee goes to the collector,
    // but staking still gets its per-transaction processBlock.
    function it_sends_strato_fees_to_the_collector_and_still_notifies_staking() public {
        gov.setStakingContract(address(staking));
        staking.setProposerFeeBps(5000);
        Token strato = _stratoFees(1e18);

        signer.pay(address(router));
        require(strato.balanceOf(address(feeCollector)) == 1e16, "whole fee to the collector");
        require(strato.balanceOf(address(staking)) == 0, "no STRATO to staking");
        require(usdst.balanceOf(address(staking)) == 0, "no USDST to staking");
        require(staking.processed() == 1, "processBlock called");
    }

    function it_pays_usdst_while_strato_is_paused() public {
        Token strato = _stratoFees(1e18);
        strato.pause();

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18, "STRATO untouched");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "paid in USDST");
    }

    function it_pays_usdst_when_strato_has_no_price() public {
        Token strato = _stratoFees(0);

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18, "STRATO untouched");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "paid in USDST");
    }

    function it_pays_usdst_when_the_strato_price_is_stale() public {
        Token strato = _stratoFees(1e18);

        fastForward(3600, 1);
        signer.pay(address(router));
        require(strato.balanceOf(address(feeCollector)) == 1e16, "an hour old is still usable");

        fastForward(1, 1);
        signer.pay(address(router));
        require(strato.balanceOf(address(feeCollector)) == 1e16, "no STRATO past the hour");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "paid in USDST instead");
    }

    function it_pays_usdst_when_strato_is_short() public {
        Token strato = _stratoFees(1e16); // $0.01: the fee is a whole STRATO, the signer has exactly 1
        oracle.setAssetPrice(address(strato), 1e16 - 1);

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18, "STRATO untouched");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "paid in USDST");
    }

    function it_skips_strato_where_the_network_names_none() public {
        voucher.mint(address(signer), 1e18);

        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "paid in USDST");
        require(voucher.balances(address(signer)) == 1e18, "voucher kept");
    }

    function it_prefers_usdst_over_a_voucher() public {
        voucher.mint(address(signer), 1e18);

        signer.pay(address(router));
        require(usdst.balanceOf(address(signer)) == 1e18 - 1e16, "USDST charged");
        require(voucher.balances(address(signer)) == 1e18, "voucher kept");
    }

    // A signer holding part of the fee must not pay part in USDST and then a voucher on
    // top: the USDST step declines before moving anything.
    function it_burns_a_voucher_without_touching_a_short_usdst_balance() public {
        gov.setStakingContract(address(staking));
        staking.setProposerFeeBps(5000);
        Signer s = _signerWithVoucher();
        usdst.mint(address(s), 1e16 - 1);

        s.pay(address(router));
        require(voucher.balances(address(s)) == 0, "voucher burned");
        require(usdst.balanceOf(address(s)) == 1e16 - 1, "USDST untouched");
        require(usdst.balanceOf(address(staking)) == 0, "nothing to staking");
        require(usdst.balanceOf(address(feeCollector)) == 0, "nothing to the collector");
    }

    function it_takes_the_whole_usdst_fee_for_staking_from_an_exact_balance() public {
        gov.setStakingContract(address(staking));
        staking.setProposerFeeBps(10000);
        Signer s = new Signer();
        s.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        usdst.mint(address(s), 1e16);

        s.pay(address(router));
        require(usdst.balanceOf(address(staking)) == 1e16, "all of it to staking");
        require(usdst.balanceOf(address(s)) == 0, "signer paid exactly once");
    }

    function it_reverts_when_no_option_can_pay() public {
        Token strato = _stratoFees(1e18);
        Signer broke = new Signer();
        broke.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        broke.configureStrato(address(strato), address(oracle));
        strato.mint(address(broke), 1e16 - 1);
        usdst.mint(address(broke), 1e16 - 1);

        bool reverted = false;
        try broke.pay(address(router)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unpaid fee fails the transaction");
    }

    function it_reverts_when_the_signer_cannot_pay() public {
        Signer broke = new Signer();
        broke.configure(address(voucher), address(usdst), address(feeCollector), address(gov));
        bool reverted = false;
        try broke.pay(address(router)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unpaid fee fails the transaction");
    }
}
