import "../../concrete/Tokenomics/TokenVesting.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of the upstream Hardhat suite test/TokenVesting.js from
// abdelhamidbakhta/token-vesting-contracts @ 2fef700, case for case.
//
// Harness differences from the upstream suite, all noted inline:
//  - Transfer events cannot be observed here, so every `.to.emit(Transfer)` becomes a
//    balance assertion on the sender and the recipient.
//  - Owner-only failures (createVestingSchedule with bad inputs, revoke by a stranger)
//    pass through the repo Ownable, which catches the failing body and routes into
//    AdminRegistry.castVoteOnIssue. The harness surfaces that as a generic revert, so
//    those cases assert "reverted AND state unchanged" instead of the message.
//  - The upstream Token mock mints the supply to its deployer in its constructor; here
//    the test contract (the owner) mints the same supply to itself.

// Mirror of the upstream MockTokenVesting: time is whatever the test sets.
contract MockTokenVesting is TokenVesting {
    uint256 mockTime = 0;

    constructor(address token_) TokenVesting(token_) {}

    function setCurrentTime(uint256 _time) external {
        mockTime = _time;
    }

    function getCurrentTime() internal virtual override view returns (uint256) {
        return mockTime;
    }

    // The harness cannot name the inherited struct type from the test contract, so the
    // upstream `vestingSchedule.released` / `.revoked` reads go through these helpers.
    function releasedOf(bytes32 vestingScheduleId) external view returns (uint256) {
        return getVestingSchedule(vestingScheduleId).released;
    }

    function isRevoked(bytes32 vestingScheduleId) external view returns (bool) {
        return getVestingSchedule(vestingScheduleId).revoked;
    }
}

contract Describe_TokenVesting {
    uint256 constant SUPPLY = 1000000;
    uint256 constant BASE_TIME = 1622551248;

    Token testToken;
    User addr1;
    User addr2;

    function beforeAll() public {
        addr1 = new User();
        addr2 = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        testToken = Token(factory.createTokenWithInitialOwner("TT", "Test Token", new string[](0), new string[](0), new string[](0), "TT", 0, 18, address(this)));
        testToken.setStatus(2);
        testToken.mint(address(this), SUPPLY);
    }

    function _deploy() internal returns (MockTokenVesting) {
        return new MockTokenVesting(address(testToken));
    }

    function _u(uint256 v) internal pure returns (string) {
        return string(v);
    }

    // it("Should assign the total supply of tokens to the owner")
    function it_assigns_the_total_supply_of_tokens_to_the_owner() public {
        require(testToken.totalSupply() == testToken.balanceOf(address(this)), "owner holds the total supply");
    }

    // it("Should vest tokens gradually")
    function it_vests_tokens_gradually() public {
        // deploy vesting contract
        MockTokenVesting tokenVesting = _deploy();
        require(tokenVesting.getToken() == address(testToken), "getToken");

        // send tokens to vesting contract (upstream: Transfer(owner, vesting, 1000))
        uint256 ownerBefore = testToken.balanceOf(address(this));
        testToken.transfer(address(tokenVesting), 1000);
        require(testToken.balanceOf(address(this)) == ownerBefore - 1000, "owner paid 1000");
        require(testToken.balanceOf(address(tokenVesting)) == 1000, "vesting contract balance is 1000");
        require(tokenVesting.getWithdrawableAmount() == 1000, "withdrawable is 1000");

        address beneficiary = address(addr1);
        uint256 startTime = BASE_TIME;
        uint256 cliff = 0;
        uint256 duration = 1000;
        uint256 slicePeriodSeconds = 1;
        bool revokable = true;
        uint256 amount = 100;

        // create new vesting schedule
        tokenVesting.createVestingSchedule(beneficiary, startTime, cliff, duration, slicePeriodSeconds, revokable, amount);
        require(tokenVesting.getVestingSchedulesCount() == 1, "one schedule");
        require(tokenVesting.getVestingSchedulesCountByBeneficiary(beneficiary) == 1, "one schedule for beneficiary");

        // compute vesting schedule id
        bytes32 vestingScheduleId = tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary, 0);

        // check that vested amount is 0
        require(tokenVesting.computeReleasableAmount(vestingScheduleId) == 0, "nothing releasable before start");

        // set time to half the vesting period
        uint256 halfTime = BASE_TIME + duration / 2;
        tokenVesting.setCurrentTime(halfTime);

        // check that vested amount is half the total amount to vest
        require(tokenVesting.computeReleasableAmount(vestingScheduleId) == 50, "half vested: " + _u(tokenVesting.computeReleasableAmount(vestingScheduleId)));

        // check that only beneficiary can try to release vested tokens
        addr2.doExpectingFailure(address(tokenVesting), "release(bytes32,uint256)", "TokenVesting: only beneficiary and owner can release vested tokens", vestingScheduleId, uint256(100));

        // check that beneficiary cannot release more than the vested amount
        addr1.doExpectingFailure(address(tokenVesting), "release(bytes32,uint256)", "TokenVesting: cannot release tokens, not enough vested tokens", vestingScheduleId, uint256(100));

        // release 10 tokens (upstream: Transfer(vesting, beneficiary, 10))
        addr1.doSuccessfully(address(tokenVesting), "release(bytes32,uint256)", vestingScheduleId, uint256(10));
        require(testToken.balanceOf(beneficiary) == 10, "beneficiary received 10");
        require(testToken.balanceOf(address(tokenVesting)) == 990, "vesting contract paid 10");

        // check that the vested amount is now 40
        require(tokenVesting.computeReleasableAmount(vestingScheduleId) == 40, "40 releasable after releasing 10");

        // check that the released amount is 10
        require(tokenVesting.releasedOf(vestingScheduleId) == 10, "released is 10");

        // set current time after the end of the vesting period
        tokenVesting.setCurrentTime(BASE_TIME + duration + 1);

        // check that the vested amount is 90
        require(tokenVesting.computeReleasableAmount(vestingScheduleId) == 90, "90 releasable after the end");

        // beneficiary release vested tokens (45)
        addr1.doSuccessfully(address(tokenVesting), "release(bytes32,uint256)", vestingScheduleId, uint256(45));
        require(testToken.balanceOf(beneficiary) == 55, "beneficiary received 45 more");

        // owner release vested tokens (45): tokens still go to the beneficiary
        tokenVesting.release(vestingScheduleId, 45);
        require(testToken.balanceOf(beneficiary) == 100, "owner-triggered release pays the beneficiary");
        require(testToken.balanceOf(address(this)) == ownerBefore - 1000, "owner received nothing");

        // check that the number of released tokens is 100
        require(tokenVesting.releasedOf(vestingScheduleId) == 100, "released is 100");

        // check that the vested amount is 0
        require(tokenVesting.computeReleasableAmount(vestingScheduleId) == 0, "nothing left to release");

        // check that anyone cannot revoke a vesting
        // Upstream expects "Ownable: caller is not the owner". Through the repo Ownable the
        // stranger's call is routed to AdminRegistry.castVoteOnIssue on the owner (this test
        // contract, which has no such function), which surfaces as a generic revert.
        bool reverted = false;
        try {
            addr2.do(address(tokenVesting), "revoke(bytes32)", vestingScheduleId);
        } catch {
            reverted = true;
        }
        require(reverted, "stranger cannot revoke");
        require(!tokenVesting.isRevoked(vestingScheduleId), "schedule not revoked by stranger");

        tokenVesting.revoke(vestingScheduleId);
        require(tokenVesting.isRevoked(vestingScheduleId), "owner revoked the schedule");
    }

    // it("Should release vested tokens if revoked")
    function it_releases_vested_tokens_if_revoked() public {
        // deploy vesting contract
        MockTokenVesting tokenVesting = _deploy();
        require(tokenVesting.getToken() == address(testToken), "getToken");

        // send tokens to vesting contract
        testToken.transfer(address(tokenVesting), 1000);
        require(testToken.balanceOf(address(tokenVesting)) == 1000, "vesting contract balance is 1000");

        address beneficiary = address(addr1);
        uint256 startTime = BASE_TIME;
        uint256 cliff = 0;
        uint256 duration = 1000;
        uint256 slicePeriodSeconds = 1;
        bool revokable = true;
        uint256 amount = 100;

        // create new vesting schedule
        tokenVesting.createVestingSchedule(beneficiary, startTime, cliff, duration, slicePeriodSeconds, revokable, amount);

        // compute vesting schedule id
        bytes32 vestingScheduleId = tokenVesting.computeVestingScheduleIdForAddressAndIndex(beneficiary, 0);

        // set time to half the vesting period
        uint256 halfTime = BASE_TIME + duration / 2;
        tokenVesting.setCurrentTime(halfTime);

        // revoke (upstream: Transfer(vesting, beneficiary, 50))
        tokenVesting.revoke(vestingScheduleId);
        require(testToken.balanceOf(beneficiary) == 50, "revoke paid the vested 50: " + _u(testToken.balanceOf(beneficiary)));
        require(testToken.balanceOf(address(tokenVesting)) == 950, "vesting contract keeps the unvested 50");
    }

    // it("Should compute vesting schedule index")
    function it_computes_vesting_schedule_index() public {
        MockTokenVesting tokenVesting = _deploy();
        // Upstream addr1 is the second default Hardhat signer; the expected id is
        // keccak256(abi.encodePacked(addr1, uint256(0))) as computed on the EVM.
        address hardhatAddr1 = address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8);
        bytes32 expectedVestingScheduleId = bytes32(0xa279197a1d7a4b7398aa0248e95b8fcc6cdfb43220ade05d01add9c5468ea097);
        require(tokenVesting.computeVestingScheduleIdForAddressAndIndex(hardhatAddr1, 0) == expectedVestingScheduleId, "id for (addr1, 0)");
        require(tokenVesting.computeNextVestingScheduleIdForHolder(hardhatAddr1) == expectedVestingScheduleId, "next id for addr1 with no schedules");
    }

    // it("Should check input parameters for createVestingSchedule method")
    function it_checks_input_parameters_for_createVestingSchedule_method() public {
        MockTokenVesting tokenVesting = _deploy();
        testToken.transfer(address(tokenVesting), 1000);
        uint256 time = BASE_TIME;

        // Each call is made by the owner with invalid inputs. Upstream asserts the exact
        // require message; through the repo Ownable the failing body is caught and routed
        // to AdminRegistry.castVoteOnIssue, so here: reverted AND nothing was created.
        bool reverted = false;
        try {
            tokenVesting.createVestingSchedule(address(addr1), time, 0, 0, 1, false, 1); // "TokenVesting: duration must be > 0"
        } catch {
            reverted = true;
        }
        require(reverted, "duration must be > 0");
        require(tokenVesting.getVestingSchedulesCount() == 0, "no schedule after zero duration");

        reverted = false;
        try {
            tokenVesting.createVestingSchedule(address(addr1), time, 0, 1, 0, false, 1); // "TokenVesting: slicePeriodSeconds must be >= 1"
        } catch {
            reverted = true;
        }
        require(reverted, "slicePeriodSeconds must be >= 1");
        require(tokenVesting.getVestingSchedulesCount() == 0, "no schedule after zero slice period");

        reverted = false;
        try {
            tokenVesting.createVestingSchedule(address(addr1), time, 0, 1, 1, false, 0); // "TokenVesting: amount must be > 0"
        } catch {
            reverted = true;
        }
        require(reverted, "amount must be > 0");
        require(tokenVesting.getVestingSchedulesCount() == 0, "no schedule after zero amount");
        require(tokenVesting.getVestingSchedulesTotalAmount() == 0, "nothing committed");
        require(tokenVesting.getWithdrawableAmount() == 1000, "everything still withdrawable");
    }
}
