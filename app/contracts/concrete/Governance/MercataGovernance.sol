import "../../abstract/ERC20/access/Ownable.sol";

contract record MercataGovernance is Ownable {
    address[] public record validators;
    mapping (address => uint) public record validatorMap;

    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (address => mapping (address => uint)) public record validatorVoteMap;
    mapping (address => address[]) public record validatorVotes;

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
    // First block in which a removed validator may be added again. A block header
    // carries the block's additions and removals as two sets and consensus applies
    // the additions first, so a validator removed and then re-added within one block
    // would leave the consensus set while staying listed here.
    mapping (address => uint) public record readdableFromBlock;
    // Granularity of the published stake weights (0 = every change is published).
    // Consensus picks each block's proposer from these weights, so a weight that
    // follows the stake wei for wei lets a dust-sized stake change steer the pick.
    // With a quantum, a weight is republished only once the stake has moved a whole
    // quantum away from it, and it is published rounded down to the quantum.
    uint public record stakeQuantum;
    // Admin pins on the set. A validator pinned in stays whatever its stake: staking
    // cannot remove it, and takes it into its own set so its stake is published as its
    // weight. A validator pinned out stays out: staking cannot add it. The two are
    // exclusive; a registry kick drops a pin in along with the seat, and a clearing vote
    // hands the validator back to staking.
    mapping (address => bool) public record pinnedIn;
    mapping (address => bool) public record pinnedOut;
    // Direction of the open vote on each validator (VOTE_IN, VOTE_OUT, VOTE_CLEAR; 0 = none).
    mapping (address => uint) public record validatorVoteDirection;

    uint constant VOTE_IN = 1;
    uint constant VOTE_OUT = 2;
    uint constant VOTE_CLEAR = 3;

    event ValidatorVoteMade(address voter, address recipient, bool voteDirection);
    event ValidatorPinClearVoteMade(address voter, address validator);
    event ValidatorPinnedIn(address validator);
    event ValidatorPinnedOut(address validator);
    event ValidatorPinCleared(address validator);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);
    event ValidatorStakeUpdated(address validator, uint stake);
    event StakingContractSet(address newStakingContract);
    event HardCapValidatorsSet(uint hardCap);
    event StakeQuantumSet(uint quantum);

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

    // Keep the quantum at or below the staking contract's minStake: a validator whose
    // stake is under one quantum is published with no weight. Weights already
    // published stay as they are until their stake next moves a quantum.
    function setStakeQuantum(uint _quantum) external onlyOwner {
        stakeQuantum = _quantum;
        emit StakeQuantumSet(_quantum);
    }

    function isValidator(address validator) external view returns (bool) {
        return validatorMap[validator] > 0;
    }

    function validatorCount() external view returns (uint) {
        return validators.length;
    }

    // V2 headers discard stake events before the staking fork. Re-emit the full
    // current set after the fork so a V3 header can publish the weights for the
    // following block, even when governance's stored weights have not changed.
    // Anyone may retry this; normal setValidatorStake suppresses unchanged events.
    function publishValidatorStakeSnapshot() external {
        uint count = validators.length;
        require(count > 0, "No validators to publish");
        for (uint i = 0; i < count; i++) {
            require(validatorStake[validators[i]] > 0, "Validator has no stake weight");
        }
        for (uint i = 0; i < count; i++) {
            address validator = validators[i];
            emit ValidatorStakeUpdated(validator, validatorStake[validator]);
        }
    }

    // Adds the validator if it is not one yet, marks it as staking-managed and
    // records its stake weight.
    function addValidatorFromStaking(address validator, uint stake) external onlyStaking {
        require(!pinnedOut[validator], "Validator is pinned out by the admins");
        if (validatorMap[validator] == 0) {
            addValidator(validator);
        }
        stakingManaged[validator] = true;
        setValidatorStake(validator, stake);
    }

    function updateValidatorStake(address validator, uint stake) external onlyStaking {
        require(validatorMap[validator] > 0, "Stake can only be updated for current validators");
        setValidatorStake(validator, stake);
    }

    // Removes a staking-managed validator; never removes the last validator (chain
    // liveness) or one the admins pinned in. Returns whether the validator was removed.
    function removeValidatorFromStaking(address validator) external onlyStaking returns (bool) {
        if (validatorMap[validator] == 0 || !stakingManaged[validator] || pinnedIn[validator] || validators.length <= 1) {
            return false;
        }
        removeValidator(validator);
        return true;
    }

    // The registry kicked (delisted) the validator: it leaves the set even when pinned in
    // or never staking-managed, and a pin in goes with the seat. Only the last validator
    // stays. Returns whether the validator was removed.
    function removeKickedValidator(address validator) external onlyStaking returns (bool) {
        if (pinnedIn[validator]) {
            pinnedIn[validator] = false;
            emit ValidatorPinCleared(validator);
        }
        if (validatorMap[validator] == 0 || validators.length <= 1) {
            return false;
        }
        removeValidator(validator);
        return true;
    }

    function addValidator(address validator) internal {
        require(hardCapValidators == 0 || validators.length < hardCapValidators, "Validator set is at its hard cap");
        require(block.number >= readdableFromBlock[validator], "Validator was removed in this block");
        validators.push(validator);
        validatorMap[validator] = validators.length;
        clearValidatorVotes(validator);
        emit ValidatorAdded(validator);
    }

    // Never drops the last validator: an empty set halts consensus permanently
    function removeValidator(address validator) internal {
        require(validators.length > 1, "Cannot remove the last validator");
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
        readdableFromBlock[validator] = block.number + 1;
        clearValidatorVotes(validator);
        emit ValidatorRemoved(validator);
    }

    // Votes are cast against the membership a validator has. Once membership changes, by
    // vote or through staking, the votes still pending are dropped and the admins vote again.
    function clearValidatorVotes(address validator) internal {
        for (uint i = 0; i < validatorVotes[validator].length; i++) {
            address voter = validatorVotes[validator][i];
            delete validatorVotes[validator][i];
            delete validatorVoteMap[validator][voter];
        }
        validatorVotes[validator].length = 0;
        validatorVoteDirection[validator] = 0;
    }

    function setValidatorStake(address validator, uint stake) internal {
        uint published = validatorStake[validator];
        uint weight = stake;
        if (stakeQuantum > 0) {
            uint moved = 0;
            if (stake > published) {
                moved = stake - published;
            } else {
                moved = published - stake;
            }
            if (moved < stakeQuantum) return;
            weight = stake - (stake % stakeQuantum);
        }
        if (published == weight) return;
        validatorStake[validator] = weight;
        emit ValidatorStakeUpdated(validator, weight);
    }

    // Pins the validator in: it joins now if it is not seated, and staking can no longer
    // remove it. A seated validator can be pinned too.
    function voteToAddValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");
        require(!pinnedIn[proposedValidator], "Validator is already pinned in");

        voteForValidator(msg.sender, proposedValidator, VOTE_IN);
    }

    // Pins the validator out: it leaves now if it is seated, and staking can no longer
    // add it. A validator outside the set can be pinned out before it ever joins.
    function voteToRemoveValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");
        require(!pinnedOut[proposedValidator], "Validator is already pinned out");
        require(validatorMap[proposedValidator] == 0 || validators.length > 1, "Cannot remove the last validator");

        voteForValidator(msg.sender, proposedValidator, VOTE_OUT);
    }

    // Clears a pin and hands the validator back to staking. Membership stays as it is
    // until staking next syncs or activates the validator.
    function voteToClearValidatorPin(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");
        require(pinnedIn[proposedValidator] || pinnedOut[proposedValidator], "Validator is not pinned");

        voteForValidator(msg.sender, proposedValidator, VOTE_CLEAR);
    }

    // A vote in a new direction restarts the tally instead of counting toward the open one.
    function voteForValidator(address sender, address proposedValidator, uint direction) internal {
        if (validatorVoteDirection[proposedValidator] != direction) {
            clearValidatorVotes(proposedValidator);
            validatorVoteDirection[proposedValidator] = direction;
        }
        uint voteIndex = validatorVoteMap[proposedValidator][sender];
        require(voteIndex == 0, "Vote to add already cast for " + string(proposedValidator));
        if (direction == VOTE_CLEAR) {
            emit ValidatorPinClearVoteMade(sender, proposedValidator);
        } else {
            emit ValidatorVoteMade(sender, proposedValidator, direction == VOTE_IN);
        }
        validatorVotes[proposedValidator].push(sender);
        validatorVoteMap[proposedValidator][sender] = validatorVotes[proposedValidator].length;

        uint newVoteCount = countAdminVotes(validatorVotes[proposedValidator]);
        if (newVoteCount >= ((2 * admins.length) / 3) + 1) {
            clearValidatorVotes(proposedValidator);
            if (direction == VOTE_IN) {
                pinIn(proposedValidator);
            } else if (direction == VOTE_OUT) {
                pinOut(proposedValidator);
            } else {
                pinnedIn[proposedValidator] = false;
                pinnedOut[proposedValidator] = false;
                emit ValidatorPinCleared(proposedValidator);
            }
        }
    }

    function pinIn(address validator) internal {
        pinnedOut[validator] = false;
        pinnedIn[validator] = true;
        emit ValidatorPinnedIn(validator);
        if (validatorMap[validator] == 0) {
            addValidator(validator);
        }
    }

    function pinOut(address validator) internal {
        pinnedIn[validator] = false;
        pinnedOut[validator] = true;
        emit ValidatorPinnedOut(validator);
        if (validatorMap[validator] > 0) {
            removeValidator(validator);
        }
    }

    // A vote stops counting when the admin who cast it is removed.
    function countAdminVotes(address[] votes) internal view returns (uint count) {
        for (uint i = 0; i < votes.length; i++) {
            if (adminMap[votes[i]] > 0) count += 1;
        }
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
        // An empty admin list strands the contract: every voteTo* entry point
        // then fails its admin check and nothing can re-seed one.
        require(admins.length > 1, "Cannot remove the last admin");

        voteForAdmin(msg.sender, proposedAdmin);
    }

    function voteForAdmin(address sender, address proposedAdmin) internal {
        uint voteIndex = adminVoteMap[proposedAdmin][sender];
        require(voteIndex == 0, "Vote to add already cast for " + string(proposedAdmin));
        bool voteDirection = adminMap[proposedAdmin] == 0;
        emit AdminVoteMade(sender, proposedAdmin, voteDirection);
        adminVotes[proposedAdmin].push(sender);
        adminVoteMap[proposedAdmin][sender] = adminVotes[proposedAdmin].length;

        uint newVoteCount = countAdminVotes(adminVotes[proposedAdmin]);
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
                require(admins.length > 1, "Cannot remove the last admin");
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
