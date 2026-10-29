import "../../abstract/ERC20/access/Ownable.sol";

contract record AdminRegistry is Ownable {
    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;
    mapping (string => bool) public record currentIssues;

    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;

    mapping (address => mapping (string => uint)) public record votingThresholds;

    uint public defaultVotingThresholdBps = 6000; // 3/5

    event IssueCreated(address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address executor, string issueId, address target, string func, variadic args);
    event IssueDismissed(address sender, string issueId);

    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event AdminSwapped(address indexed replacedAdmin, address indexed newAdmin);

    event WhitelistGranted(address indexed target, string func, address indexed user);
    event WhitelistRevoked(address indexed target, string func, address indexed user);
    event VotingThresholdSet(address indexed target, string func, uint votingThresholdBps);
    event DefaultVotingThresholdSet(uint votingThresholdBps);
    event ContractCreated(address indexed contractAddress, string contractName);

    bool public initialized = false;

    modifier onlyOnce() {
        require(!initialized, "AdminRegistry is already initialized");
        initialized = true;
        _;
    }

    constructor() Ownable(this) { }

    function initialize(address[] _initialAdmins) external onlyOwner onlyOnce {
        defaultVotingThresholdBps = 6000; // 3/5
        require(admins.length == 0, "AdminRegistry is already initialized");
        require(_initialAdmins.length > 0, "At least one admin is required");
        for (uint i = 0; i < _initialAdmins.length; i++) {
            require(_initialAdmins[i] != address(0), "Invalid admin address");
            require(adminMap[_initialAdmins[i]] == 0, "Duplicate admin address");
            admins.push(_initialAdmins[i]);
            adminMap[_initialAdmins[i]] = admins.length;
            emit AdminAdded(_initialAdmins[i]);
        }
    }

    function addAdmin(address _admin) external {
        castVoteOnIssue(this, "_addAdmin", _admin);
    }

    function removeAdmin(address _admin) external {
        castVoteOnIssue(this, "_removeAdmin", _admin);
    }

    function swapAdmin(address _adminToReplace, address _newAdmin) external {
        castVoteOnIssue(this, "_swapAdmin", _adminToReplace, _newAdmin);
    }

    function isAdminAddress(address _admin) external returns (bool) {
        return adminMap[_admin] > 0;
    }

    function dismissIssue(string _issueId) external {
        require(currentIssues[_issueId], "Issue does not exist or is not active");
        require(votes[_issueId].length == 1, "Only issues with a single vote can be dismissed");
        require(votes[_issueId][0] == msg.sender, "Only the proposer can dismiss their issue");

        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
        delete currentIssues[_issueId];
        emit IssueDismissed(msg.sender, _issueId);
    }

    function castVoteOnIssue(address _target, string _func, variadic _args) public returns (bool, variadic) {
        // Ownership lives on the registry's Proxy, so its only route to owner-only calls on itself is through here
        if (_target == address(this)) {
            require(_func != "renounceOwnership", "AdminRegistry cannot renounce its ownership");
            require(_func != "transferOwnership" || adminMap[msg.sender] != 0, "Only admins can vote to transfer AdminRegistry ownership");
        }
        string issueId = _getIssueId(_target, _func, _args);
        if (adminMap[msg.sender] != 0) {
            bool hasVoted = votesMap[issueId][msg.sender] != 0;

            _createIssue(issueId, _target, _func, _args);

            if (!hasVoted) {
                votes[issueId].push(msg.sender);
                votesMap[issueId][msg.sender] = votes[issueId].length;
                emit IssueVoted(msg.sender, issueId, _target, _func, _args);
            }

            if (_shouldExecute(issueId, _target, _func, _args)) {
                variadic ret = _executeIssue(issueId, _target, _func, _args);
                return (true, ret);
            } else {
                return (false, issueId);
            }
        } else {
            // Non-admin path: only execute if whitelisted
            require(whitelist[_target][_func][msg.sender], "Only an admin or a whitelisted account can call castVoteOnIssue");
            variadic ret = _executeIssue(issueId, _target, _func, _args);
            return (true, ret);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func, variadic _args) internal returns (bool) {
        // Handing the registry's ownership away takes every current admin
        if (_target == address(this) && _func == "transferOwnership") {
            uint currentAdminVotes = 0;
            for (uint i = 0; i < votes[_issueId].length; i++) {
                if (adminMap[votes[_issueId][i]] != 0) currentAdminVotes++;
            }
            return currentAdminVotes == admins.length;
        }

        uint issueVotes = votes[_issueId].length;

        uint votingThresholdBps = votingThresholds[_target][_func];
        if (votingThresholdBps == 0) votingThresholdBps = defaultVotingThresholdBps;

        return 10000 * issueVotes >= votingThresholdBps * admins.length;
    }

    function _createIssue(string _issueId, address _target, string _func, variadic _args) internal {
        if(votes[_issueId].length == 0) {
            currentIssues[_issueId] = true;
            emit IssueCreated(msg.sender, _issueId, _target, _func, _args);
        }
    }

    function getIssueId(address _target, string _func, variadic _args) external returns (string) {
        return _getIssueId(_target, _func, _args);
    }

    function _getIssueId(address _target, string _func, variadic _args) internal returns (string) {
        return keccak256(_target, _func, _args);
    }

    function _executeIssue(string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
        delete currentIssues[_issueId];
        variadic ret = _target.call(_func, _args);
        emit IssueExecuted(msg.sender, _issueId, _target, _func, _args);
        return ret;
    }

    function _addAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        require(adminMap[_admin] == 0, "Account is already an admin");
        admins.push(_admin);
        adminMap[_admin] = admins.length;
        emit AdminAdded(_admin);
    }

    function _removeAdmin(address _admin) external onlyOwner {
        require(admins.length > 1, "Cannot remove the last admin");
        uint index = adminMap[_admin];
        require(index > 0, "Account is not an admin");
        address swap = admins[admins.length - 1];
        admins[index - 1] = swap;
        adminMap[swap] = index;
        adminMap[_admin] = 0;
        admins[admins.length - 1] = address(0);
        admins.length -= 1;
        emit AdminRemoved(_admin);
    }

    function _swapAdmin(address _adminToReplace, address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        uint index = adminMap[_admin];
        require(index == 0, "Account is already an admin");
        index = adminMap[_adminToReplace];
        require(index > 0, "Account to replace is not an admin");
        admins[index - 1] = _admin;
        adminMap[_admin] = index;
        adminMap[_adminToReplace] = 0;
        emit AdminSwapped(_adminToReplace, _admin);
    }

    function addWhitelist(address _target, string _func, address _user) external onlyOwner {
        if (_target == address(this)) {
            require(
                _func != "addWhitelist" &&
                _func != "removeWhitelist" &&
                _func != "_addAdmin" &&
                _func != "_createIssue" &&
                _func != "_executeIssue" &&
                _func != "_removeAdmin" &&
                _func != "_shouldExecute" &&
                _func != "_swapAdmin" &&
                _func != "setVotingThreshold" &&
                _func != "setDefaultVotingThresholdBps" &&
                _func != "createContract" &&
                _func != "createSaltedContract",
                "Cannot whitelist internal governance functions"
            );
        }
        whitelist[_target][_func][_user] = true;
        emit WhitelistGranted(_target, _func, _user);
    }

    function removeWhitelist(address _target, string _func, address _user) external onlyOwner {
        require(whitelist[_target][_func][_user], "Whitelist entry does not exist");
        whitelist[_target][_func][_user] = false;
        emit WhitelistRevoked(_target, _func, _user);
    }

    function setVotingThreshold(address _target, string _func, uint _votingThresholdBps) external onlyOwner {
        require(_votingThresholdBps > 0, "Voting threshold must be greater than 0");
        require(_votingThresholdBps <= 10000, "Voting threshold must be less than 100%");
        votingThresholds[_target][_func] = _votingThresholdBps;
        emit VotingThresholdSet(_target, _func, _votingThresholdBps);
    }

    function setDefaultVotingThresholdBps(uint _defaultVotingThresholdBps) external onlyOwner {
        require(_defaultVotingThresholdBps > 0, "Default voting threshold must be greater than 0");
        require(_defaultVotingThresholdBps <= 10000, "Default voting threshold must be less than 100%");
        defaultVotingThresholdBps = _defaultVotingThresholdBps;
        emit DefaultVotingThresholdSet(_defaultVotingThresholdBps);
    }

    function createContract(string _contractName, string _contractSrc, variadic _args) external onlyOwner returns (address) {
        address deployed = create(_contractName, _contractSrc, _args);
        emit ContractCreated(deployed, _contractName);
        return deployed;
    }

    function createSaltedContract(string _salt, string _contractName, string _contractSrc, variadic _args) external onlyOwner returns (address) {
        address deployed = create2(_salt, _contractName, _contractSrc, _args);
        emit ContractCreated(deployed, _contractName);
        return deployed;
    }
}
