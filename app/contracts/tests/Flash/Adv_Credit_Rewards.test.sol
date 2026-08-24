// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// ═══════════════════════════════════════════════════════════════════════════════
// ADVERSARIAL ITEM 4 — Rewards / StratoStaking / ValidatorRegistry snapshots.
//
// Result up front: this attack class does NOT reach these contracts, and the reason is
// structural rather than defensive. FlashMint mints exactly one token (`token` = USDST).
// Every balance-derived quantity in these three contracts is
// denominated in a DIFFERENT token:
//     Rewards.rewardToken      = CATA   (BaseCodeCollection.sol:190, 0x2680dc..)
//     StratoStaking.stratoToken = STRATO
//     ValidatorRegistry         = no balanceOf / totalSupply / block.timestamp at all
// and every one of those reads is `balanceOf(address(this))` — the contract's own
// inventory, used as a solvency GATE — never a third party's balance used as a weight.
//
// The tests below establish that empirically rather than by assertion:
//  4a  the reward token and stake token are not USDST
//  4b  a maximal flash-minted USDST balance held at the exact instant of a reward
//      computation and a claim changes the payout by ZERO
//  4c  Rewards weight comes from an owner-supplied integer, with no balance read at all
//  4d  StratoStaking weight requires a real STRATO transferFrom, which FlashMint cannot
//      produce; a flash-minted USDST balance changes stake and payout by ZERO
// ═══════════════════════════════════════════════════════════════════════════════

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/// @notice Holds a maximal flash-minted USDST balance and, at that exact instant,
///         samples every reward-side quantity we can reach.
contract FlashHolder {
    FlashMint public lender;
    address public usdst;
    Rewards public rewards;
    StratoStaking public staking;

    uint public usdstHeldDuring;
    uint public unclaimedDuring;
    uint public rewardTokenBalDuring;
    uint public stakeDuring;
    uint public stakingRewardBalDuring;

    function init(address _l, address _u, address _r, address _s) public {
        lender = FlashMint(_l); usdst = _u; rewards = Rewards(_r); staking = StratoStaking(_s);
    }

    function probe(uint amount, address op) public {
        lender.flashLoan(address(this), amount, op);
    }

    function onFlashMint(address _t, uint amount, uint fee, variadic data) external returns (string) {
        address op = address(data[0]);
        usdstHeldDuring        = IERC20(_t).balanceOf(address(this));
        unclaimedDuring        = rewards.unclaimedRewards(address(this));
        rewardTokenBalDuring   = IERC20(address(rewards.rewardToken())).balanceOf(address(rewards));
        stakeDuring            = staking.delegatedStake(address(this), op);
        stakingRewardBalDuring = staking.rewardBalance();

        // While holding 2,000,000 USDST, claim everything we can.
        try rewards.claimAllRewards() { } catch { }
        return "FlashMint.onFlashMint";
    }
}

contract Describe_Adv_Credit_Rewards is Authorizable {

    Mercata m;
    FlashMint fm;
    AdminRegistry admin;

    address USDST;
    Token usdstT;

    Rewards rewards;
    address CATA;
    Token cataT;

    StratoStaking staking;
    ValidatorRegistry vreg;
    Token strato;

    User opA;
    uint CAP;
    uint activityId;
    address SRC;

    function beforeAll() public {
        bypassAuthorizations = true;
        CAP = 2000000e18;
        SRC = address(0xBEEF);

        m     = new Mercata();
        fm    = m.flashMint();
        admin = m.adminRegistry();

        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        m.cdpRegistry().setUSDST(USDST);

        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "mint", address(fm));
        admin.castVoteOnIssue(address(admin), "addWhitelist", USDST, "burn", address(fm));
        fm.initialize(USDST, address(m.feeCollector()), CAP);
        fm.setWhitelistEnabled(false);

        // ── Rewards, owned by this suite so we can drive it directly.
        CATA  = m.tokenFactory().createToken("CATA","CATA reward token",[],[],[],"CATA",0,18);
        cataT = Token(CATA);
        cataT.setStatus(2);
        rewards = new Rewards(address(this));
        rewards.initialize(CATA);
        cataT.mint(address(rewards), 1000000e18);
        activityId = rewards.addOneTimeDirectPayoutActivity("BonusReward", SRC, "BonusApplied");

        // ── StratoStaking + ValidatorRegistry
        address st = m.tokenFactory().createTokenWithInitialOwner(
            "STRATO","STRATO Token",[],[],[],"STRATO",0,18,address(this)
        );
        strato = Token(st);
        strato.setStatus(2);

        staking = new StratoStaking(address(this));
        staking.initialize(address(strato), 100, 5000, 1000, 16);
        vreg = new ValidatorRegistry(address(this));
        vreg.initialize(address(staking));
        staking.setValidatorRegistry(address(vreg));

        opA = new User();
        vreg.addOperator(address(opA), 500, "Validator A", "first", "", "validator-a");
    }

    function beforeEach() public { }

    // ═════════════════════════════════════════════════════════════════════════
    // 4a — the facility mints exactly one token, and it is not the reward/stake token.
    // ═════════════════════════════════════════════════════════════════════════
    function it_aa_facility_cannot_mint_the_reward_or_stake_token() public {
        log("4a FlashMint.token()        : " + string(fm.token()));
        log("4a Rewards.rewardToken()    : " + string(address(rewards.rewardToken())));
        log("4a StratoStaking.stratoToken: " + string(address(staking.stratoToken())));

        require(fm.token() == USDST, "the facility mints USDST only");
        require(address(rewards.rewardToken()) != USDST, "reward token is NOT USDST");
        require(address(staking.stratoToken()) != USDST, "stake token is NOT USDST");
    }

    /// @notice Mainnet address check, straight out of the deployed wiring.
    function it_ab_deployed_reward_token_address_is_not_usdst() public {
        // BaseCodeCollection.sol:190  cataToken = Token(0x2680dc6693021cd3fefb84351570874fbef8332a)
        // FlashMint / CDP / SaveUSDSTVault all wire USDST = 0x937efa7e...
        log("4b deployed CATA  : " + string(address(m.cataToken())));
        log("4b deployed USDST : 937efa7e3a77e20bbdbd7c0d32b6514f368c1010");
        require(address(m.cataToken()) != address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010),
            "deployed reward token is a different asset from USDST");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4b — a maximal flash-minted USDST balance at the exact instant of a reward
    //      computation and a claim. Baseline vs attack, same numbers.
    // ═════════════════════════════════════════════════════════════════════════
    function it_ba_flash_minted_balance_changes_the_payout_by_zero() public {
        // BASELINE: an ordinary user with no USDST at all.
        User plain = new User();
        rewards.handleAction(SRC, "BonusApplied", address(plain), 500e18, uint256(1), uint256(0));
        uint plainUnclaimed = rewards.unclaimedRewards(address(plain));
        plain.do(address(rewards), "claimAllRewards");
        uint plainPaid = cataT.balanceOf(address(plain));

        // ATTACK: identical action, but the beneficiary holds 2,000,000 flash-minted
        // USDST at the exact instant the reward is computed AND claimed.
        FlashHolder h = new FlashHolder();
        h.init(address(fm), USDST, address(rewards), address(staking));
        rewards.handleAction(SRC, "BonusApplied", address(h), 500e18, uint256(2), uint256(0));
        uint hUnclaimed = rewards.unclaimedRewards(address(h));

        h.probe(CAP, address(opA));
        uint hPaid = cataT.balanceOf(address(h));

        log("4c USDST held at the instant of the claim : " + string(h.usdstHeldDuring()));
        log("4c baseline  unclaimed / paid (CATA)      : " + string(plainUnclaimed) + " / " + string(plainPaid));
        log("4c flash-holder unclaimed / paid (CATA)   : " + string(hUnclaimed) + " / " + string(hPaid));
        log("4c Rewards CATA inventory read during tx  : " + string(h.rewardTokenBalDuring()));

        require(h.usdstHeldDuring() == CAP, "the borrower really did hold the whole 2,000,000");
        require(hUnclaimed == plainUnclaimed, "DEMONSTRATED-NEGATIVE: identical accrual");
        require(hPaid == plainPaid, "DEMONSTRATED-NEGATIVE: identical payout, delta = 0 CATA");
    }

    /// @notice Where the weight actually comes from: an owner-supplied integer.
    ///         Doubling the argument doubles the payout; USDST holdings are irrelevant.
    function it_bb_reward_weight_is_an_owner_supplied_integer() public {
        User a = new User();
        User b = new User();
        rewards.handleAction(SRC, "BonusApplied", address(a), 1000e18, uint256(10), uint256(0));
        rewards.handleAction(SRC, "BonusApplied", address(b), 2000e18, uint256(11), uint256(0));

        uint ua = rewards.unclaimedRewards(address(a));
        uint ub = rewards.unclaimedRewards(address(b));
        log("4d amount=1000e18 -> unclaimed : " + string(ua));
        log("4d amount=2000e18 -> unclaimed : " + string(ub));
        require(ua == 1000e18 && ub == 2000e18,
            "the reward equals the caller-supplied `amount`; no balance is ever read");

        // And the direct-payout branch has NO replay protection: the same
        // (blockNumber, eventIndex) pays again.
        rewards.handleAction(SRC, "BonusApplied", address(a), 1000e18, uint256(10), uint256(0));
        uint ua2 = rewards.unclaimedRewards(address(a));
        log("4d same (blockNumber,eventIndex) replayed -> unclaimed : " + string(ua2));
        require(ua2 == ua + 1000e18,
            "NOTE: directPayout returns before the processedEvents check, so it is replayable");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4c — StratoStaking. Weight is a measured STRATO transfer, not a balance read.
    // ═════════════════════════════════════════════════════════════════════════
    function it_ca_staking_weight_requires_real_strato_not_a_usdst_balance() public {
        FlashHolder h = new FlashHolder();
        h.init(address(fm), USDST, address(rewards), address(staking));

        // Give the holder plenty of USDST-denominated "wealth" — none of it is STRATO.
        usdstT.mint(address(h), 1000000e18);

        uint stake0 = staking.delegatedStake(address(h), address(opA));
        uint rewardable0 = staking.totalRewardableStake();

        h.probe(CAP, address(opA));

        log("4e USDST held during the probe   : " + string(h.usdstHeldDuring()));
        log("4e delegatedStake during / after : " + string(h.stakeDuring()) + " / "
            + string(staking.delegatedStake(address(h), address(opA))));
        log("4e totalRewardableStake before/after: " + string(rewardable0) + " / "
            + string(staking.totalRewardableStake()));
        log("4e rewardBalance() during        : " + string(h.stakingRewardBalDuring()));

        require(h.stakeDuring() == stake0, "DEMONSTRATED-NEGATIVE: stake weight unmoved by USDST");
        require(staking.totalRewardableStake() == rewardable0, "totalRewardableStake unmoved");
        require(h.stakingRewardBalDuring() == 0,
            "rewardBalance() reads balanceOf(STRATO, self) - a USDST balance is invisible to it");
    }

    /// @notice Real staking, for contrast: the weight tracks the STRATO actually moved.
    function it_cb_staking_weight_tracks_the_measured_strato_delta() public {
        User staker = new User();
        strato.mint(address(staker), 10000e18);
        staker.do(address(strato), "approve", address(staking), 10000e18);
        staker.do(address(staking), "stake", address(opA), 4000e18);

        uint st = staking.delegatedStake(address(staker), address(opA));
        log("4f STRATO transferred in         : 4000000000000000000000");
        log("4f delegatedStake recorded       : " + string(st));
        log("4f totalRewardableStake          : " + string(staking.totalRewardableStake()));
        require(st == 4000e18, "weight == measured STRATO delta, not any balanceOf snapshot");

        // A flash-minted USDST balance present at the moment of the stake changes nothing.
        FlashHolder h = new FlashHolder();
        h.init(address(fm), USDST, address(rewards), address(staking));
        uint rw0 = staking.totalRewardableStake();
        h.probe(CAP, address(opA));
        log("4f totalRewardableStake after a 2m USDST flash mint: " + string(staking.totalRewardableStake()));
        require(staking.totalRewardableStake() == rw0, "DEMONSTRATED-NEGATIVE: unchanged");
    }

    /// @notice ValidatorRegistry: no token balance enters any decision at all.
    function it_da_validator_registry_has_no_balance_dependence() public {
        (bool exists, bool active, string name,,,) = vreg.operators(address(opA));
        log("4g operator exists / active      : " + string(exists) + " / " + string(active));
        log("4g operatorCount                 : " + string(vreg.operatorCount()));

        FlashHolder h = new FlashHolder();
        h.init(address(fm), USDST, address(rewards), address(staking));
        usdstT.mint(address(h), 1e18);
        uint c0 = vreg.operatorCount();
        h.probe(CAP, address(opA));
        log("4g operatorCount after 2m flash mint: " + string(vreg.operatorCount()));
        require(vreg.operatorCount() == c0, "DEMONSTRATED-NEGATIVE: registry is balance-blind");
        require(exists && active, "operator state intact");
    }
}
