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

    event ValidatorVoteMade(address voter, address recipient, bool voteDirection);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);
    event ValidatorStakeUpdated(address validator, uint stake);
    event StakingContractSet(address newStakingContract);
    event HardCapValidatorsSet(uint hardCap);

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

    function setValidatorStake(address validator, uint stake) internal {
        if (validatorStake[validator] == stake) return;
        validatorStake[validator] = stake;
        emit ValidatorStakeUpdated(validator, stake);
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

        voteForValidator(msg.sender, proposedValidator);
    }

    function voteForValidator(address sender, address proposedValidator) internal {
        uint voteIndex = validatorVoteMap[proposedValidator][sender];
        require(voteIndex == 0, "Vote to add already cast for " + string(proposedValidator));
        bool voteDirection = validatorMap[proposedValidator] == 0;
        emit ValidatorVoteMade(sender, proposedValidator, voteDirection);
        validatorVotes[proposedValidator].push(sender);
        validatorVoteMap[proposedValidator][sender] = validatorVotes[proposedValidator].length;

        uint newVoteCount = validatorVotes[proposedValidator].length;
        if (newVoteCount >= ((2 * admins.length) / 3) + 1) {
            for (uint i = 0; i < validatorVotes[proposedValidator].length; i++) {
                address voter = validatorVotes[proposedValidator][i];
                delete validatorVotes[proposedValidator][i];
                delete validatorVoteMap[proposedValidator][voter];
            }
            validatorVotes[proposedValidator].length = 0;
            if (voteDirection) {
                addValidator(proposedValidator);
            } else {
                removeValidator(proposedValidator);
            }
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
