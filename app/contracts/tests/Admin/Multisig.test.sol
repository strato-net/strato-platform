import "../../concrete/Admin/Multisig.sol";
import "../../concrete/User/UserRegistry.sol";

contract Signer {
    function invoke(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract MockToken {
    mapping (address => uint) public balanceOf;

    constructor(address holder) {
        balanceOf[holder] = 1000;
    }

    function transfer(address to, uint amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient funds");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Reverter {
    function fail() public {
        revert("target failed");
    }
}

// A signer whose own call, once voted through, tries to vote again
contract ReentrantSigner is Signer {
    Multisig wallet;
    uint public runs;
    bool public reentryBlocked;

    function setWallet(address _wallet) public {
        wallet = Multisig(_wallet);
    }

    // Vote for the issue that is running
    function runAgain() public {
        runs++;
        try {
            wallet.castVoteOnIssue(address(this), "runAgain");
        } catch {
            reentryBlocked = true;
        }
    }

    // Cast the deciding vote on another pending issue
    function runAndPay(address _token, address _to) public {
        runs++;
        try {
            wallet.castVoteOnIssue(_token, "transfer", _to, 1000);
        } catch {
            reentryBlocked = true;
        }
    }

    // Run another queued issue from inside this one
    function runAndExecute(address _token, address _to) public {
        runs++;
        try {
            wallet.executeIssue(_token, "transfer", _to, 1000);
        } catch {
            reentryBlocked = true;
        }
    }
}

// A signer that swallows the failure of its own vote
contract CatchingSigner is Signer {
    bool public caught;

    function voteAndCatch(address _wallet, address _target, string _func) public {
        try {
            Multisig(_wallet).castVoteOnIssue(_target, _func);
        } catch {
            caught = true;
        }
    }
}

// Something a signer might call that tries to vote in the signer's name
contract VoteTrap {
    function innocuous(address _wallet) public {
        Multisig(_wallet).castVoteOnIssue(msg.sender, "noop");
    }

    function noop() public { }
}

contract Describe_Multisig {
    User wallet;
    Multisig ms;
    MockToken token;
    Signer a;
    Signer b;
    Signer c;
    Signer outsider;

    function beforeEach() {
        a = new Signer();
        b = new Signer();
        c = new Signer();
        outsider = new Signer();
        wallet = new User("treasury");
        wallet.setLogicContract(address(new Multisig()));
        ms = Multisig(address(wallet));
        ms.initialize([address(a), address(b), address(c)]);
        wallet.transferOwnership(address(wallet));
        token = new MockToken(address(wallet));
    }

    function vote(Signer who, address target, string func, variadic args) internal returns (bool) {
        (bool executed, variadic ret) = who.invoke(address(wallet), "castVoteOnIssue", target, func, args);
        return executed;
    }

    function rejects(Signer who, address target, string func, variadic args) internal returns (bool) {
        bool reverted = false;
        try {
            who.invoke(target, func, args);
        } catch {
            reverted = true;
        }
        return reverted;
    }

    function swapSigner(address oldSigner, address newSigner) internal {
        Signer first = oldSigner == address(a) ? b : a;
        Signer second = oldSigner == address(c) ? b : c;
        first.invoke(address(wallet), "swapAdmin", oldSigner, newSigner);
        second.invoke(address(wallet), "swapAdmin", oldSigner, newSigner);
        require(!ms.isAdminAddress(newSigner), "signer activated before accepting");
        require(ms.isAdminAddress(oldSigner), "old signer removed before replacement accepted");
        Signer(newSigner).invoke(address(wallet), "acceptAdmin");
        require(ms.isAdminAddress(newSigner), "signer swap did not execute");
    }

    function enableTimelock() internal {
        vote(a, address(wallet), "setTimelockDelay", 86400);
        vote(b, address(wallet), "setTimelockDelay", 86400);
        require(ms.timelockDelay() == 86400, "timelock delay not set");
    }

    // Two of three signers pass an issue, which then waits out the delay
    function voteToQueue(address target, string func, variadic args) internal returns (string) {
        string issueId = ms.getIssueId(target, func, args);
        vote(a, target, func, args);
        require(!vote(b, target, func, args), "passed issue ran before its delay");
        require(issueExecutableAt(issueId) != 0, "passed issue was not queued");
        return issueId;
    }

    function issueExecutableAt(string issueId) internal returns (uint) {
        (, uint executableAt,) = ms.timelocks(issueId);
        return executableAt;
    }

    function it_rejects_outsiders() {
        require(rejects(outsider, address(wallet), "castVoteOnIssue", address(token), "transfer", address(outsider), 1000), "outsider voted");
        require(rejects(outsider, address(wallet), "callContract", address(token), "transfer", address(outsider), 1000), "outsider spent");
        require(rejects(outsider, address(wallet), "transferOwnership", address(outsider)), "outsider took ownership");
        require(rejects(outsider, address(wallet), "setLogicContract", address(outsider)), "outsider upgraded");
        require(rejects(outsider, address(wallet), "addUserAddress", address(outsider)), "outsider added a user address");
        require(rejects(outsider, address(wallet), "_addAdmin", address(outsider)), "outsider added a signer");
        require(rejects(outsider, address(wallet), "setDefaultVotingThresholdBps", 1), "outsider set the threshold");
        require(rejects(outsider, address(wallet), "initialize", [address(outsider)]), "outsider reinitialized");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
        require(wallet.owner() == address(wallet), "owner changed");
    }

    function it_lets_only_the_owner_initialize_a_valid_signer_set() {
        User fresh = new User("fresh");
        fresh.setLogicContract(address(new Multisig()));
        Multisig freshMs = Multisig(address(fresh));
        require(rejects(outsider, address(fresh), "initialize", [address(outsider)]), "outsider initialized");

        bool emptyReverted = false;
        try { freshMs.initialize([]); } catch { emptyReverted = true; }
        require(emptyReverted, "empty signer set accepted");
        bool duplicateReverted = false;
        try { freshMs.initialize([address(a), address(a)]); } catch { duplicateReverted = true; }
        require(duplicateReverted, "duplicate signer accepted");
        bool zeroReverted = false;
        try { freshMs.initialize([address(a), address(0)]); } catch { zeroReverted = true; }
        require(zeroReverted, "zero signer accepted");
        bool selfReverted = false;
        try { freshMs.initialize([address(a), address(fresh)]); } catch { selfReverted = true; }
        require(selfReverted, "wallet accepted as its own signer");

        bool tooFewReverted = false;
        try { freshMs.initialize([address(a), address(b)]); } catch { tooFewReverted = true; }
        require(tooFewReverted, "fewer than three signers accepted");

        freshMs.initialize([address(a), address(b), address(c)]);
        require(freshMs.isAdminAddress(address(a)) && freshMs.isAdminAddress(address(b)) && freshMs.isAdminAddress(address(c)), "signers not set");
        require(freshMs.configVersion() == 1, "config version not set");

        Multisig bare = new Multisig();
        bool bareReverted = false;
        try { bare.initialize([address(a)]); } catch { bareReverted = true; }
        require(bareReverted, "bare logic contract initialized");
    }

    function it_needs_two_distinct_signers_to_spend() {
        require(!vote(a, address(token), "transfer", address(outsider), 1000), "one vote executed");
        require(!vote(a, address(token), "transfer", address(outsider), 1000), "a repeated vote executed");
        require(token.balanceOf(address(wallet)) == 1000, "one signer spent");
        require(vote(b, address(token), "transfer", address(outsider), 1000), "two signers did not execute");
        require(token.balanceOf(address(outsider)) == 1000, "transfer did not land");
    }

    function it_binds_votes_to_target_function_and_arguments() {
        MockToken other = new MockToken(address(wallet));
        vote(a, address(token), "transfer", address(outsider), 10);
        require(!vote(b, address(token), "transfer", address(outsider), 11), "different amount combined");
        require(!vote(b, address(token), "transfer", address(c), 10), "different recipient combined");
        require(!vote(b, address(other), "transfer", address(outsider), 10), "different target combined");
        require(token.balanceOf(address(wallet)) == 1000 && other.balanceOf(address(wallet)) == 1000, "funds moved");
    }

    function it_needs_fresh_votes_to_repeat_a_payment() {
        vote(a, address(token), "transfer", address(outsider), 10);
        vote(b, address(token), "transfer", address(outsider), 10);
        require(!vote(a, address(token), "transfer", address(outsider), 10), "executed issue replayed");
        require(token.balanceOf(address(outsider)) == 10, "executed issue replayed");
        require(vote(b, address(token), "transfer", address(outsider), 10), "fresh votes did not execute");
        require(token.balanceOf(address(outsider)) == 20, "repeat payment did not land");
    }

    function it_drops_a_replaced_signers_vote() {
        vote(a, address(token), "transfer", address(outsider), 1000);
        Signer d = new Signer();
        swapSigner(address(a), address(d));
        require(!ms.isAdminAddress(address(a)), "a is still a signer");
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "replaced signer's vote counted");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
        require(vote(c, address(token), "transfer", address(outsider), 1000), "current signers did not execute");
    }

    function it_drops_continuing_signers_votes_when_a_signer_is_added() {
        vote(b, address(token), "transfer", address(outsider), 1000);
        Signer d = new Signer();
        a.invoke(address(wallet), "addAdmin", address(d));
        c.invoke(address(wallet), "addAdmin", address(d));
        require(!ms.isAdminAddress(address(d)), "signer activated before accepting");
        d.invoke(address(wallet), "acceptAdmin");
        require(ms.isAdminAddress(address(d)) && ms.configVersion() == 2, "signer not added");
        // Four signers at 60% need three fresh votes; b's earlier vote is gone
        require(!vote(c, address(token), "transfer", address(outsider), 1000), "executed on one fresh vote");
        require(!vote(a, address(token), "transfer", address(outsider), 1000), "stale vote counted");
        require(vote(d, address(token), "transfer", address(outsider), 1000), "three fresh votes did not execute");
    }

    function it_drops_votes_when_the_threshold_changes() {
        vote(a, address(token), "transfer", address(outsider), 1000);
        vote(b, address(wallet), "setDefaultVotingThresholdBps", 6666);
        vote(c, address(wallet), "setDefaultVotingThresholdBps", 6666);
        require(ms.defaultVotingThresholdBps() == 6666, "threshold not changed");
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "stale vote counted");
        require(vote(c, address(token), "transfer", address(outsider), 1000), "fresh votes did not execute");
    }

    function it_does_not_revive_votes_when_a_signer_is_re_added() {
        vote(a, address(token), "transfer", address(outsider), 1000);
        Signer d = new Signer();
        a.invoke(address(wallet), "addAdmin", address(d));
        b.invoke(address(wallet), "addAdmin", address(d));
        d.invoke(address(wallet), "acceptAdmin");
        b.invoke(address(wallet), "removeAdmin", address(a));
        c.invoke(address(wallet), "removeAdmin", address(a));
        d.invoke(address(wallet), "removeAdmin", address(a));
        b.invoke(address(wallet), "addAdmin", address(a));
        c.invoke(address(wallet), "addAdmin", address(a));
        a.invoke(address(wallet), "acceptAdmin");
        require(ms.isAdminAddress(address(a)), "a not re-added");
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "re-added signer's old vote counted");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
    }

    function it_rejects_unanimous_thresholds_and_unsafe_removals() {
        vote(a, address(wallet), "setDefaultVotingThresholdBps", 10000);
        require(rejects(b, address(wallet), "castVoteOnIssue", address(wallet), "setDefaultVotingThresholdBps", 10000), "unanimous threshold accepted");
        a.invoke(address(wallet), "removeAdmin", address(c));
        require(rejects(b, address(wallet), "removeAdmin", address(c)), "removed below three signers");

        Signer d = new Signer();
        a.invoke(address(wallet), "addAdmin", address(d));
        b.invoke(address(wallet), "addAdmin", address(d));
        d.invoke(address(wallet), "acceptAdmin");
        vote(a, address(wallet), "setDefaultVotingThresholdBps", 7500);
        vote(b, address(wallet), "setDefaultVotingThresholdBps", 7500);
        vote(c, address(wallet), "setDefaultVotingThresholdBps", 7500);
        a.invoke(address(wallet), "removeAdmin", address(d));
        b.invoke(address(wallet), "removeAdmin", address(d));
        require(rejects(c, address(wallet), "removeAdmin", address(d)), "unsafe removal succeeded");
        require(ms.isAdminAddress(address(d)), "unsafe removal changed signers");
    }

    function it_rejects_stale_signer_acceptance() {
        Signer d = new Signer();
        a.invoke(address(wallet), "addAdmin", address(d));
        b.invoke(address(wallet), "addAdmin", address(d));
        vote(a, address(wallet), "setDefaultVotingThresholdBps", 6666);
        vote(c, address(wallet), "setDefaultVotingThresholdBps", 6666);
        require(rejects(d, address(wallet), "acceptAdmin"), "stale signer proposal accepted");
        require(!ms.isAdminAddress(address(d)), "stale signer activated");
    }

    function it_keeps_votes_when_a_signer_change_fails() {
        vote(b, address(token), "transfer", address(outsider), 1000);
        a.invoke(address(wallet), "addAdmin", address(c));
        require(rejects(b, address(wallet), "addAdmin", address(c)), "adding an existing signer succeeded");
        require(ms.configVersion() == 1, "failed change bumped the config version");
        require(vote(c, address(token), "transfer", address(outsider), 1000), "pending vote was dropped");
    }

    function it_lets_a_proposer_dismiss_their_issue() {
        vote(a, address(token), "transfer", address(outsider), 1000);
        a.invoke(address(wallet), "dismissIssue", ms.getIssueId(address(token), "transfer", address(outsider), 1000));
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "dismissed vote counted");
    }

    function it_lets_a_signer_withdraw_their_vote() {
        string issueId = ms.getIssueId(address(token), "transfer", address(outsider), 1000);
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(rejects(outsider, address(wallet), "withdrawVote", address(token), "transfer", address(outsider), 1000), "non-voter withdrew a vote");
        a.invoke(address(wallet), "withdrawVote", address(token), "transfer", address(outsider), 1000);
        require(!ms.currentIssues(issueId), "empty issue remained open");
        require(ms.votesMap(issueId, address(a)) == 0, "withdrawn vote remained recorded");
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "withdrawn vote counted");
    }

    function it_executes_once_when_the_target_reenters() {
        ReentrantSigner r = new ReentrantSigner();
        swapSigner(address(c), address(r));
        r.setWallet(address(wallet));
        vote(a, address(r), "runAgain");
        r.invoke(address(wallet), "castVoteOnIssue", address(r), "runAgain");
        require(r.runs() == 1 && r.reentryBlocked(), "running issue was re-entered");
        require(ms.votesMap(ms.getIssueId(address(r), "runAgain"), address(r)) == 0, "re-entrant vote was recorded");
    }

    function it_blocks_executing_another_issue_from_a_running_one() {
        ReentrantSigner r = new ReentrantSigner();
        swapSigner(address(c), address(r));
        r.setWallet(address(wallet));
        vote(a, address(token), "transfer", address(outsider), 1000);
        vote(a, address(r), "runAndPay", address(token), address(outsider));
        r.invoke(address(wallet), "castVoteOnIssue", address(r), "runAndPay", address(token), address(outsider));
        require(r.runs() == 1 && r.reentryBlocked(), "nested vote was not blocked");
        require(token.balanceOf(address(wallet)) == 1000, "nested issue executed");
        require(vote(b, address(token), "transfer", address(outsider), 1000), "pending issue lost its vote");
    }

    function it_rolls_back_the_deciding_vote_when_the_target_reverts() {
        Reverter target = new Reverter();
        string issueId = ms.getIssueId(address(target), "fail");
        vote(a, address(target), "fail");
        require(rejects(b, address(wallet), "castVoteOnIssue", address(target), "fail"), "failed call reported success");
        require(ms.votesMap(issueId, address(a)) != 0 && ms.votesMap(issueId, address(b)) == 0, "votes changed");
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(vote(b, address(token), "transfer", address(outsider), 1000), "lock was left set");
    }

    function it_releases_the_lock_when_a_signer_catches_its_failed_vote() {
        CatchingSigner s = new CatchingSigner();
        swapSigner(address(c), address(s));
        Reverter target = new Reverter();
        vote(a, address(target), "fail");
        s.voteAndCatch(address(wallet), address(target), "fail");
        require(s.caught(), "failed call was not reported");
        require(ms.votesMap(ms.getIssueId(address(target), "fail"), address(s)) == 0, "caught vote was recorded");
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(vote(b, address(token), "transfer", address(outsider), 1000), "lock was left set");
    }

    function it_limits_calls_on_itself_to_governance() {
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "callContract", address(token), "transfer", address(a), 1000), "callContract proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "callContract", address(wallet), "addUserAddress", address(a)), "nested callContract proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "addUserAddress", address(a)), "addUserAddress proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "revokeAllUserAddresses"), "revokeAllUserAddresses proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "renounceOwnership"), "renounceOwnership proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "createContract", "C", "contract C {}"), "createContract proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "castVoteOnIssue", address(token), "transfer", address(a), 1000), "castVoteOnIssue proposed");
        require(rejects(a, address(wallet), "castVoteOnIssue", address(wallet), "addWhitelist", address(token), "transfer", address(a)), "addWhitelist proposed");
    }

    // The owner-only fallback in older User wallets votes as the wallet itself
    function it_cannot_make_the_wallet_its_own_signer() {
        a.invoke(address(wallet), "addAdmin", address(wallet));
        require(rejects(b, address(wallet), "addAdmin", address(wallet)), "wallet added as its own signer");
        a.invoke(address(wallet), "swapAdmin", address(c), address(wallet));
        require(rejects(b, address(wallet), "swapAdmin", address(c), address(wallet)), "wallet swapped in as its own signer");
        require(!ms.isAdminAddress(address(wallet)), "wallet is its own signer");
    }

    function it_does_not_vote_for_a_signer_through_a_helper() {
        VoteTrap trap = new VoteTrap();
        require(rejects(a, address(trap), "innocuous", address(wallet)), "helper voted");
        require(ms.votesMap(ms.getIssueId(address(a), "noop"), address(a)) == 0, "signer's vote recorded");
        require(ms.votesMap(ms.getIssueId(address(trap), "noop"), address(a)) == 0, "signer's vote recorded");
    }

    function it_uses_the_configured_quorum_to_transfer_ownership() {
        vote(a, address(wallet), "transferOwnership", address(outsider));
        require(wallet.owner() == address(wallet), "one of three transferred ownership");
        require(vote(b, address(wallet), "transferOwnership", address(outsider)), "quorum did not execute");
        require(wallet.owner() == address(outsider), "quorum did not transfer ownership");
    }

    function it_runs_a_passed_issue_at_once_without_a_timelock_delay() {
        require(ms.timelockDelay() == 0, "timelock delay should start at 0");
        string issueId = ms.getIssueId(address(token), "transfer", address(outsider), 1000);
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(vote(b, address(token), "transfer", address(outsider), 1000), "passed issue did not run");
        require(issueExecutableAt(issueId) == 0, "issue was queued");
    }

    function it_rejects_a_timelock_delay_above_the_maximum() {
        vote(a, address(wallet), "setTimelockDelay", 2592001);
        require(rejects(b, address(wallet), "castVoteOnIssue", address(wallet), "setTimelockDelay", 2592001), "delay above the maximum accepted");
        require(ms.timelockDelay() == 0, "timelock delay changed");
    }

    function it_queues_a_passed_issue_until_its_delay_is_up() {
        enableTimelock();
        string issueId = voteToQueue(address(token), "transfer", address(outsider), 1000);
        (uint queuedAt, uint executableAt, uint expiresAt) = ms.timelocks(issueId);
        require(queuedAt == block.timestamp && executableAt == queuedAt + 86400 && expiresAt == executableAt + 604800, "unexpected timelock");
        require(rejects(outsider, address(wallet), "executeIssue", address(token), "transfer", address(outsider), 1000), "ran before its delay");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved before the delay");

        fastForward(86400);
        outsider.invoke(address(wallet), "executeIssue", address(token), "transfer", address(outsider), 1000);
        require(token.balanceOf(address(outsider)) == 1000, "queued transfer did not run");
        require(!ms.currentIssues(issueId) && issueExecutableAt(issueId) == 0, "executed issue was not cleared");
        require(rejects(outsider, address(wallet), "executeIssue", address(token), "transfer", address(outsider), 1000), "queued issue ran twice");
    }

    function it_does_not_run_a_queued_issue_after_its_grace_period() {
        enableTimelock();
        voteToQueue(address(token), "transfer", address(outsider), 1000);
        fastForward(86400 + 604800 + 1);
        require(rejects(outsider, address(wallet), "executeIssue", address(token), "transfer", address(outsider), 1000), "expired issue ran");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved after expiry");
    }

    function it_takes_no_votes_or_dismissal_on_a_queued_issue() {
        // At one of three, the proposer's vote alone passes an issue
        vote(a, address(wallet), "setDefaultVotingThresholdBps", 3333);
        vote(b, address(wallet), "setDefaultVotingThresholdBps", 3333);
        vote(a, address(wallet), "setTimelockDelay", 86400);
        require(ms.timelockDelay() == 86400, "timelock delay not set");

        string issueId = ms.getIssueId(address(token), "transfer", address(outsider), 1000);
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(issueExecutableAt(issueId) != 0, "issue not queued");
        require(rejects(b, address(wallet), "castVoteOnIssue", address(token), "transfer", address(outsider), 1000), "voted on a queued issue");
        require(rejects(a, address(wallet), "dismissIssue", issueId), "dismissed a queued issue");
        require(ms.currentIssues(issueId), "queued issue was dropped");
    }

    function it_unqueues_an_issue_when_a_signer_withdraws() {
        enableTimelock();
        string issueId = voteToQueue(address(token), "transfer", address(outsider), 1000);
        b.invoke(address(wallet), "withdrawVote", address(token), "transfer", address(outsider), 1000);
        require(ms.currentIssues(issueId), "issue was cleared while one vote remained");
        require(issueExecutableAt(issueId) == 0, "issue stayed queued below quorum");
        require(ms.votesMap(issueId, address(b)) == 0, "withdrawn queued vote remained recorded");
        require(!vote(c, address(token), "transfer", address(outsider), 1000), "re-approved issue ran before its delay");
        require(issueExecutableAt(issueId) != 0, "re-approved issue was not queued again");
    }

    function it_runs_a_queued_issue_after_a_signer_change() {
        enableTimelock();
        Signer d = new Signer();
        voteToQueue(address(token), "transfer", address(outsider), 1000);
        voteToQueue(address(wallet), "_proposeAdmin", address(c), address(d));
        fastForward(86400);
        ms.executeIssue(address(wallet), "_proposeAdmin", address(c), address(d));
        d.invoke(address(wallet), "acceptAdmin");
        require(ms.isAdminAddress(address(d)) && !ms.isAdminAddress(address(c)), "signer swap did not run");

        require(rejects(d, address(wallet), "castVoteOnIssue", address(token), "transfer", address(outsider), 1000), "new signer voted on a queued issue");
        ms.executeIssue(address(token), "transfer", address(outsider), 1000);
        require(token.balanceOf(address(outsider)) == 1000, "queued issue did not survive the signer change");
    }

    function it_does_not_let_a_removed_signer_unqueue_an_issue() {
        enableTimelock();
        string issueId = voteToQueue(address(token), "transfer", address(outsider), 1000);
        Signer d = new Signer();
        voteToQueue(address(wallet), "_proposeAdmin", address(b), address(d));
        fastForward(86400);
        ms.executeIssue(address(wallet), "_proposeAdmin", address(b), address(d));
        d.invoke(address(wallet), "acceptAdmin");

        require(!ms.isAdminAddress(address(b)), "old signer was not removed");
        require(
            rejects(b, address(wallet), "withdrawVote", address(token), "transfer", address(outsider), 1000),
            "removed signer withdrew a queued vote"
        );
        require(issueExecutableAt(issueId) != 0, "removed signer cleared the timelock");
        ms.executeIssue(address(token), "transfer", address(outsider), 1000);
        require(token.balanceOf(address(outsider)) == 1000, "queued issue did not execute");
    }

    function it_lets_the_signers_cancel_a_queued_issue_before_its_delay_is_up() {
        enableTimelock();
        string issueId = voteToQueue(address(token), "transfer", address(outsider), 1000);
        require(!vote(c, address(wallet), "cancelIssue", issueId), "one vote cancelled the issue");
        require(vote(a, address(wallet), "cancelIssue", issueId), "cancel waited for the timelock");
        require(!ms.currentIssues(issueId) && issueExecutableAt(issueId) == 0, "cancelled issue was not cleared");

        fastForward(86400);
        require(rejects(outsider, address(wallet), "executeIssue", address(token), "transfer", address(outsider), 1000), "cancelled issue ran");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
    }

    function it_cannot_cancel_an_issue_that_is_not_queued() {
        string issueId = ms.getIssueId(address(token), "transfer", address(outsider), 1000);
        vote(a, address(token), "transfer", address(outsider), 1000);
        vote(a, address(wallet), "cancelIssue", issueId);
        require(rejects(b, address(wallet), "castVoteOnIssue", address(wallet), "cancelIssue", issueId), "cancelled an issue that was not queued");
        require(ms.currentIssues(issueId), "pending issue was dropped");
    }

    function it_waits_out_the_delay_to_hand_the_wallet_over() {
        enableTimelock();
        vote(a, address(wallet), "transferOwnership", address(outsider));
        require(!vote(b, address(wallet), "transferOwnership", address(outsider)), "ownership moved before the delay");
        require(wallet.owner() == address(wallet), "ownership moved before the delay");

        fastForward(86400);
        ms.executeIssue(address(wallet), "transferOwnership", address(outsider));
        require(wallet.owner() == address(outsider), "queued ownership transfer did not run");
    }

    function it_blocks_running_a_queued_issue_from_a_running_one() {
        ReentrantSigner r = new ReentrantSigner();
        r.setWallet(address(wallet));
        enableTimelock();
        voteToQueue(address(token), "transfer", address(outsider), 1000);
        voteToQueue(address(r), "runAndExecute", address(token), address(outsider));
        fastForward(86400);

        ms.executeIssue(address(r), "runAndExecute", address(token), address(outsider));
        require(r.runs() == 1 && r.reentryBlocked(), "nested execution was not blocked");
        require(token.balanceOf(address(wallet)) == 1000, "nested issue ran");
        ms.executeIssue(address(token), "transfer", address(outsider), 1000);
        require(token.balanceOf(address(outsider)) == 1000, "queued issue was lost");
    }

    function it_rejects_timelock_controls_outside_a_vote() {
        enableTimelock();
        string issueId = voteToQueue(address(token), "transfer", address(outsider), 1000);
        require(rejects(outsider, address(wallet), "setTimelockDelay", 0), "outsider set the delay");
        require(rejects(a, address(wallet), "setTimelockDelay", 0), "signer set the delay without a vote");
        require(rejects(a, address(wallet), "cancelIssue", issueId), "signer cancelled without a vote");
        require(ms.timelockDelay() == 86400 && issueExecutableAt(issueId) != 0, "timelock changed");
    }
}
