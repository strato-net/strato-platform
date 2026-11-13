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

    event ValidatorVoteMade(address voter, address recipient, bool voteDirection);
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

    // Adds the validator if it is not one yet, marks it as staking-managed and
    // records its stake weight.
    function addValidatorFromStaking(address validator, uint stake) external onlyStaking {
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
    // liveness). Returns whether the validator was removed.
    function removeValidatorFromStaking(address validator) external onlyStaking returns (bool) {
        if (validatorMap[validator] == 0 || !stakingManaged[validator] || validators.length <= 1) {
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

    // Votes are cast for a change of membership. Once membership changes, by vote or
    // through staking, the votes still pending would count toward the opposite change.
    function clearValidatorVotes(address validator) internal {
        for (uint i = 0; i < validatorVotes[validator].length; i++) {
            address voter = validatorVotes[validator][i];
            delete validatorVotes[validator][i];
            delete validatorVoteMap[validator][voter];
        }
        validatorVotes[validator].length = 0;
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

    function voteToAddValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");

        uint v = validatorMap[proposedValidator];
        require(v == 0, "Votes to add cannot be counted for current validators");

        voteForValidator(msg.sender, proposedValidator);
    }

    function voteToRemoveValidator(address proposedValidator) external onlyOwner {
        uint a = adminMap[msg.sender];
        require(a > 0, "Only registered network admins can vote for validators");

        uint v = validatorMap[proposedValidator];
        require(v > 0, "Votes to remove can only be counted for current validators");
        require(validators.length > 1, "Cannot remove the last validator");

        voteForValidator(msg.sender, proposedValidator);
    }

    function voteForValidator(address sender, address proposedValidator) internal {
        uint voteIndex = validatorVoteMap[proposedValidator][sender];
        require(voteIndex == 0, "Vote to add already cast for " + string(proposedValidator));
        bool voteDirection = validatorMap[proposedValidator] == 0;
        emit ValidatorVoteMade(sender, proposedValidator, voteDirection);
        validatorVotes[proposedValidator].push(sender);
        validatorVoteMap[proposedValidator][sender] = validatorVotes[proposedValidator].length;

        uint newVoteCount = countAdminVotes(validatorVotes[proposedValidator]);
        if (newVoteCount >= ((2 * admins.length) / 3) + 1) {
            if (voteDirection) {
                addValidator(proposedValidator);
            } else {
                removeValidator(proposedValidator);
            }
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
