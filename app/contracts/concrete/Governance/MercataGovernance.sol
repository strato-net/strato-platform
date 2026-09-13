import "../../abstract/ERC20/access/Ownable.sol";

// The staking contract's side of the validator set. Governance owns the set that
// consensus reads; staking keeps its own mirror of it for stake accounting and
// admission, and this is how it is told the set moved without it.
interface IGovernedStaking {
    function reconcileWithGovernance(address validator) external;
}

contract record MercataGovernance is Ownable {
    address[] public record validators;
    mapping (address => uint) public record validatorMap;

    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (address => mapping (address => uint)) public record validatorVoteMap;
    mapping (address => address[]) public record validatorVotes;
    // Which outcome the tally currently open on a validator is pointing at. A
    // validator has one tally, and it belongs to one direction: without this,
    // votes cast to add and votes cast to remove accumulate toward the same
    // threshold and whoever casts the deciding vote picks what the others voted
    // for. See VOTE_* below.
    mapping (address => uint) public record validatorVoteDirection;

    mapping (address => mapping (address => uint)) public record adminVoteMap;
    mapping (address => address[]) public record adminVotes;

    // Staking integration: the staking contract publishes each validator's stake
    // weight (consumed by consensus for proposer selection) and may add or remove
    // the validators it manages when their stake crosses the threshold.
    address public record stakingContract;
    mapping (address => uint) public record validatorStake;
    mapping (address => bool) public record stakingManaged;
    // Upper bound on the validator set (0 = none); the node is sized for ~50.
    uint public record hardCapValidators;

    // Admin override of stake-weighted selection. A validator the admins have
    // voted in stays in the set however its stake moves; one they have voted out
    // stays out however its stake moves. The two are mutually exclusive: setting
    // either clears the other, and a clearing vote clears both and hands the
    // decision back to stake weight.
    //
    // This set is the one consensus reads, so an override decides membership
    // outright, and the staking contract's mirror of the set is brought into line
    // in the same transaction (see notifyStaking).
    mapping (address => bool) public record forcedInByAdmins;
    mapping (address => bool) public record forcedOutByAdmins;

    // What the staking contract last asked for, recorded even while an override
    // is holding the opposite. Clearing an override falls back to this, which is
    // how the set is re-evaluated against stake weight without having to ask the
    // staking contract again. See STAKING_* below.
    mapping (address => uint) public record stakingIntent;
    // The weight staking last published, whether or not it reached the set. A
    // validator held out by an override still has its weight tracked, so lifting
    // the override can publish a current weight instead of a stale or zero one.
    mapping (address => uint) public record stakingWeight;

    // validatorVoteDirection values.
    uint constant VOTE_NONE = 0;
    uint constant VOTE_IN = 1;
    uint constant VOTE_OUT = 2;
    uint constant VOTE_CLEAR = 3;

    // stakingIntent values.
    uint constant STAKING_SILENT = 0;
    uint constant STAKING_WANTS_IN = 1;
    uint constant STAKING_WANTS_OUT = 2;

    event ValidatorVoteMade(address voter, address recipient, bool voteDirection);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);
    event ValidatorStakeUpdated(address validator, uint stake);
    event StakingContractSet(address newStakingContract);
    event HardCapValidatorsSet(uint hardCap);

    // Admin overrides. ValidatorVoteMade keeps its meaning for existing
    // consumers (cast for add / cast for remove); this carries the third
    // direction, which a bool cannot express.
    event ValidatorDesignationVoteMade(address voter, address validator, uint direction);
    event ValidatorForcedIn(address validator);
    event ValidatorForcedOut(address validator);
    event ValidatorDesignationCleared(address validator, bool stillValidator);

    event AdminVoteMade(address voter, address recipient, bool voteDirection);
    event AdminAdded(address admin);
    event AdminRemoved(address admin);

    constructor(address _initialOwner) Ownable(_initialOwner) { }

    modifier onlyStaking() {
        require(stakingContract != address(0) && msg.sender == stakingContract, "Only the staking contract can manage staked validators");
        _;
    }

    function setStakingContract(address _stakingContract) external onlyOwner {
        stakingContract = _stakingContract;
        emit StakingContractSet(_stakingContract);
    }

    function setHardCapValidators(uint _hardCap) external onlyOwner {
        require(_hardCap == 0 || _hardCap >= validators.length, "Hard cap below the current validator count");
        hardCapValidators = _hardCap;
        emit HardCapValidatorsSet(_hardCap);
    }

    function isValidator(address validator) external view returns (bool) {
        return validatorMap[validator] > 0;
    }

    function validatorCount() external view returns (uint) {
        return validators.length;
    }

    // Adds the validator if it is not one yet, marks it as staking-managed and
    // records its stake weight. A validator the admins have voted out is tracked
    // but not admitted: its weight is remembered for the day the designation is
    // lifted, and deliberately not published, because ValidatorStakeUpdated is
    // what consensus reads and a weight outside the set is a weight that can
    // neither propose nor vote.
    function addValidatorFromStaking(address validator, uint stake) external onlyStaking {
        stakingIntent[validator] = STAKING_WANTS_IN;
        stakingWeight[validator] = stake;
        if (forcedOutByAdmins[validator]) return;

        if (validatorMap[validator] == 0) {
            addValidator(validator);
        }
        stakingManaged[validator] = true;
        setValidatorStake(validator, stake);
    }

    function updateValidatorStake(address validator, uint stake) external onlyStaking {
        require(validatorMap[validator] > 0, "Stake can only be updated for current validators");
        stakingWeight[validator] = stake;
        setValidatorStake(validator, stake);
    }

    // Removes a staking-managed validator; never removes the last validator (chain
    // liveness). Returns whether the validator was removed.
    function removeValidatorFromStaking(address validator) external onlyStaking returns (bool) {
        stakingIntent[validator] = STAKING_WANTS_OUT;

        // Voted in by the admins: it stays, and staking is told the removal did
        // not happen -- the same answer it already gets when governance refuses
        // to drop its last validator, and one it already knows how to handle. It
        // keeps the operator in its own set and keeps publishing its weight,
        // which is exactly what a pinned validator needs.
        if (forcedInByAdmins[validator]) {
            return false;
        }

        // Voted out by the admins: it is already out of the set. Report that as
        // removed so the staking contract's own bookkeeping converges, instead of
        // it believing the validator is still seated and retrying forever.
        if (forcedOutByAdmins[validator]) {
            if (validatorMap[validator] > 0 && validators.length > 1) {
                removeValidator(validator);
            }
            return validatorMap[validator] == 0;
        }

        if (validatorMap[validator] == 0 || !stakingManaged[validator] || validators.length <= 1) {
            return false;
        }
        removeValidator(validator);
        return true;
    }

    function addValidator(address validator) internal {
        require(hardCapValidators == 0 || validators.length < hardCapValidators, "Validator set is at its hard cap");
        validators.push(validator);
        validatorMap[validator] = validators.length;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) internal {
        uint j = validatorMap[validator];
        uint last = validators.length;
        if (j != last) {
            address swap = validators[last - 1];
            validators[j - 1] = swap;
            validatorMap[swap] = j;
        }
        validators[last - 1] = address(0);
        validators.length--;
        validatorMap[validator] = 0;
        validatorStake[validator] = 0;
        stakingManaged[validator] = false;
        emit ValidatorRemoved(validator);
    }

    // Tell staking the set moved under it, so its own mirror converges now rather
    // than at whatever transaction happens to touch the operator next. Never
    // allowed to fail the vote: staking may be unwired, mid-upgrade, or older than
    // this contract. reconcileWithGovernance is permissionless and idempotent, so
    // a notification that does not land stays repairable by anyone.
    function notifyStaking(address validator) internal {
        if (stakingContract == address(0)) return;
        try {
            IGovernedStaking(stakingContract).reconcileWithGovernance(validator);
        } catch {
        }
    }

    function setValidatorStake(address validator, uint stake) internal {
        if (validatorStake[validator] == stake) return;
        validatorStake[validator] = stake;
        emit ValidatorStakeUpdated(validator, stake);
    }

    // Seat a validator and publish the weight staking last reported for it.
    // stakingManaged tracks whether staking is the one asking for it, so that a
    // later removeValidatorFromStaking is honoured rather than refused.
    function seatValidator(address validator) internal {
        addValidator(validator);
        stakingManaged[validator] = stakingIntent[validator] == STAKING_WANTS_IN;
        setValidatorStake(validator, stakingWeight[validator]);
    }

    // An admin vote to add pins the validator into the set: it joins now if it is
    // not seated, and insufficient stake weight can no longer take it out. A
    // validator that is already seated is a legal target -- pinning a sitting
    // validator whose stake is about to fall short is the point of the override.
    function voteToAddValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");

        voteForValidator(msg.sender, proposedValidator, VOTE_IN);
    }

    // An admin vote to remove pins the validator out of the set: it leaves now if
    // it is seated, and sufficient stake weight can no longer bring it back. A
    // validator that is not currently seated is a legal target -- that is how a
    // validator is barred before its stake ever qualifies it.
    function voteToRemoveValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");

        voteForValidator(msg.sender, proposedValidator, VOTE_OUT);
    }

    // Drop whichever designation the admins put on a validator and hand it back
    // to stake weight, which takes effect immediately.
    function voteToClearValidatorDesignation(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");

        voteForValidator(msg.sender, proposedValidator, VOTE_CLEAR);
    }

    function voteForValidator(address sender, address proposedValidator, uint direction) internal {
        // A vote in a new direction supersedes the tally that was open rather
        // than being counted alongside it.
        if (validatorVoteDirection[proposedValidator] != direction) {
            clearValidatorVotes(proposedValidator);
            validatorVoteDirection[proposedValidator] = direction;
        }

        uint voteIndex = validatorVoteMap[proposedValidator][sender];
        require(voteIndex == 0, "Vote already cast for " + string(proposedValidator));

        if (direction != VOTE_CLEAR) {
            emit ValidatorVoteMade(sender, proposedValidator, direction == VOTE_IN);
        }
        emit ValidatorDesignationVoteMade(sender, proposedValidator, direction);
        validatorVotes[proposedValidator].push(sender);
        validatorVoteMap[proposedValidator][sender] = validatorVotes[proposedValidator].length;

        uint newVoteCount = validatorVotes[proposedValidator].length;
        if (newVoteCount >= ((2 * admins.length) / 3) + 1) {
            clearValidatorVotes(proposedValidator);
            validatorVoteDirection[proposedValidator] = VOTE_NONE;
            if (direction == VOTE_IN) {
                forceInValidator(proposedValidator);
            } else if (direction == VOTE_OUT) {
                forceOutValidator(proposedValidator);
            } else {
                clearValidatorDesignation(proposedValidator);
            }
        }
    }

    function clearValidatorVotes(address proposedValidator) internal {
        for (uint i = 0; i < validatorVotes[proposedValidator].length; i++) {
            address voter = validatorVotes[proposedValidator][i];
            delete validatorVotes[proposedValidator][i];
            delete validatorVoteMap[proposedValidator][voter];
        }
        validatorVotes[proposedValidator].length = 0;
    }

    // Pin the validator into the set. A validator staking has never reported on
    // joins at weight 0: it is a member of the set, but under stake-weighted
    // selection a zero weight is never asked to propose and carries no quorum
    // vote. Pin such a validator before its stake is gone, or give it stake.
    function forceInValidator(address validator) internal {
        // Checked before anything is written, for the same reason as the last-
        // validator check below: a designation outlives the vote that set it.
        bool seated = validatorMap[validator] > 0;
        require(seated || hardCapValidators == 0 || validators.length < hardCapValidators, "Validator set is at its hard cap");

        forcedOutByAdmins[validator] = false;
        forcedInByAdmins[validator] = true;
        emit ValidatorForcedIn(validator);

        if (!seated) {
            seatValidator(validator);
        }
        notifyStaking(validator);
    }

    // Pin the validator out of the set. Never the last one: an empty validator
    // set stops the chain, and a designation survives a restart, so there would
    // be no block left to carry the vote that undoes it.
    function forceOutValidator(address validator) internal {
        // Checked before anything is written: the designation outlives the vote,
        // so a half-applied one would be worse than a rejected one.
        bool seated = validatorMap[validator] > 0;
        require(!seated || validators.length > 1, "Cannot vote out the last validator");

        forcedInByAdmins[validator] = false;
        forcedOutByAdmins[validator] = true;
        emit ValidatorForcedOut(validator);

        if (seated) {
            removeValidator(validator);
        }
        notifyStaking(validator);
    }

    // Hand the validator back to stake weight: whatever the staking contract last
    // asked for takes effect now. A validator staking has never reported on -- a
    // genesis validator, or one the admins seated by vote -- has no stake weight
    // to evaluate, so it keeps the membership it has and the admins stay free to
    // vote it either way.
    function clearValidatorDesignation(address validator) internal {
        forcedInByAdmins[validator] = false;
        forcedOutByAdmins[validator] = false;

        uint intent = stakingIntent[validator];
        if (intent == STAKING_WANTS_IN && validatorMap[validator] == 0) {
            // Not under the cap: leave it out rather than reverting the vote. It
            // is a waiter now, and staking promotes it the usual way when a slot
            // frees up.
            if (hardCapValidators == 0 || validators.length < hardCapValidators) {
                seatValidator(validator);
            }
        } else if (intent == STAKING_WANTS_OUT && validatorMap[validator] > 0 && validators.length > 1) {
            removeValidator(validator);
        }

        notifyStaking(validator);
        emit ValidatorDesignationCleared(validator, validatorMap[validator] > 0);
    }

    function voteToAddAdmin(address proposedAdmin) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for admins");

        uint v = adminMap[proposedAdmin];
        require(v == 0, "Votes to add cannot be counted for current admins");

        voteForAdmin(msg.sender, proposedAdmin);
    }

    function voteToRemoveAdmin(address proposedAdmin) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for admins");

        uint v = adminMap[proposedAdmin];
        require(v > 0, "Votes to remove can only be counted for current admins");

        voteForAdmin(msg.sender, proposedAdmin);
    }

    function voteForAdmin(address sender, address proposedAdmin) internal {
        uint voteIndex = adminVoteMap[proposedAdmin][sender];
        require(voteIndex == 0, "Vote to add already cast for " + string(proposedAdmin));
        bool voteDirection = adminMap[proposedAdmin] == 0;
        emit AdminVoteMade(sender, proposedAdmin, voteDirection);
        adminVotes[proposedAdmin].push(sender);
        adminVoteMap[proposedAdmin][sender] = adminVotes[proposedAdmin].length;

        uint newVoteCount = adminVotes[proposedAdmin].length;
        if (newVoteCount >= ((2 * admins.length) / 3) + 1) {
            for (uint i = 0; i < adminVotes[proposedAdmin].length; i++) {
                address voter = adminVotes[proposedAdmin][i];
                delete adminVotes[proposedAdmin][i];
                delete adminVoteMap[proposedAdmin][voter];
            }
            adminVotes[proposedAdmin].length = 0;
            if (voteDirection) {
                admins.push(proposedAdmin);
                adminMap[proposedAdmin] = admins.length;
                emit AdminAdded(proposedAdmin);
            } else {
                uint j = adminMap[proposedAdmin];
                address swap = admins[admins.length - 1];
                admins[j - 1] = swap;
                adminMap[swap] = j;
                admins[admins.length - 1] = address(0);
                adminMap[proposedAdmin] = 0;
                admins.length--;
                emit AdminRemoved(proposedAdmin);
            }
        }
    }
}
