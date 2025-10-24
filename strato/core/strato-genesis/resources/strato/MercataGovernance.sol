import "../contracts/abstract/ERC20/access/Ownable.sol";

contract record MercataGovernance is Ownable {
    address[] public record validators;
    mapping (address => uint) public record validatorMap;

    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (address => mapping (address => uint)) public record validatorVoteMap;
    mapping (address => address[]) public record validatorVotes;

    mapping (address => mapping (address => uint)) public record adminVoteMap;
    mapping (address => address[]) public record adminVotes;

    event ValidatorVoteMade(address voter, address recipient, bool voteDirection);
    event ValidatorAdded(address validator);
    event ValidatorRemoved(address validator);

    event AdminVoteMade(address voter, address recipient, bool voteDirection);
    event AdminAdded(address admin);
    event AdminRemoved(address admin);

    constructor(address _initialOwner) Ownable(_initialOwner) { }

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
                validators.push(proposedValidator);
                validatorMap[proposedValidator] = validators.length;
                emit ValidatorAdded(proposedValidator);
            } else {
                uint j = validatorMap[proposedValidator];
                address swap = validators[validators.length - 1];
                validators[j - 1] = swap;
                validatorMap[swap] = j;
                validators[validators.length - 1] = address(0);
                validatorMap[proposedValidator] = 0;
                validators.length--;
                emit ValidatorRemoved(proposedValidator);
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
