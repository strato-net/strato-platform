/**
 * @title Multisig
 * @notice Logic for a User wallet run as a multisig: the wallet points its logicContract
 * here and owns itself, so every owner-only action is a signer vote.
 * @dev Unlike AdminRegistry there is no whitelist and no per-function threshold: every
 * call the wallet makes needs the default threshold of current signers. Storage names
 * match AdminRegistry, so a wallet running AdminRegistry logic keeps its signers when
 * it switches here. No imports: SMD deploys this exact file and finds deployments by
 * its code hash.
 */
contract record Multisig {
    // The wallet's Ownable owner; the logic contract itself owns itself
    address _owner;

    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;
    mapping (string => bool) public record currentIssues;
    mapping (string => uint) public record issueConfigVersions;

    uint public defaultVotingThresholdBps = 6000; // 3/5

    // Bumped by every signer or threshold change; votes cast under an older version never count
    uint public configVersion;

    bool executing;

    event IssueCreated(address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address executor, string issueId, address target, string func, variadic args);
    event IssueDismissed(address sender, string issueId);

    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event AdminSwapped(address indexed replacedAdmin, address indexed newAdmin);

    event DefaultVotingThresholdSet(uint votingThresholdBps);

    bool public initialized = false;

    modifier onlyOwner() {
        require(msg.sender == _owner, "Only the owner can call this function");
        _;
    }

    modifier onlyOnce() {
        require(!initialized, "Multisig is already initialized");
        initialized = true;
        _;
    }

    constructor() {
        _owner = address(this);
    }

    function initialize(address[] _initialAdmins) external onlyOwner onlyOnce {
        require(_initialAdmins.length > 0, "At least one admin is required");
        defaultVotingThresholdBps = 6000; // 3/5
        configVersion = 1;
        for (uint i = 0; i < _initialAdmins.length; i++) {
            require(_initialAdmins[i] != address(0), "Invalid admin address");
            require(_initialAdmins[i] != address(this), "A multisig cannot be its own signer");
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
        _clearVotes(_issueId);
        emit IssueDismissed(msg.sender, _issueId);
    }

    function castVoteOnIssue(address _target, string _func, variadic _args) public returns (bool, variadic) {
        require(adminMap[msg.sender] != 0, "Only an admin can vote");
        require(!executing, "Cannot vote while an issue is executing");
        // The wallet is the only caller its owner-only functions accept, so this is the one
        // route to them. Anything else (callContract, addUserAddress, ...) would let an issue
        // wrap a call the multisig never voted on, or hand out standing authority
        if (_target == address(this)) {
            require(
                _func == "_addAdmin" ||
                _func == "_removeAdmin" ||
                _func == "_swapAdmin" ||
                _func == "setDefaultVotingThresholdBps" ||
                _func == "setLogicContract" ||
                _func == "transferOwnership",
                "Multisig cannot vote to call " + _func + " on itself"
            );
        }

        // A wallet that switched here from logic without config versions starts at version 0,
        // so its older issues are stale
        if (configVersion == 0) configVersion = 1;

        string issueId = _getIssueId(_target, _func, _args);
        if (issueConfigVersions[issueId] != configVersion) {
            _clearVotes(issueId);
            issueConfigVersions[issueId] = configVersion;
        }

        if (votesMap[issueId][msg.sender] == 0) {
            if (votes[issueId].length == 0) {
                currentIssues[issueId] = true;
                emit IssueCreated(msg.sender, issueId, _target, _func, _args);
            }
            votes[issueId].push(msg.sender);
            votesMap[issueId][msg.sender] = votes[issueId].length;
            emit IssueVoted(msg.sender, issueId, _target, _func, _args);
        }

        if (_shouldExecute(issueId, _target, _func)) {
            variadic ret = _executeIssue(issueId, _target, _func, _args);
            return (true, ret);
        } else {
            return (false, issueId);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func) internal returns (bool) {
        uint issueVotes = votes[_issueId].length;
        // Handing the wallet to a new owner takes every signer
        if (_target == address(this) && _func == "transferOwnership") {
            return issueVotes == admins.length;
        }
        return 10000 * issueVotes >= defaultVotingThresholdBps * admins.length;
    }

    function getIssueId(address _target, string _func, variadic _args) external returns (string) {
        return _getIssueId(_target, _func, _args);
    }

    function _getIssueId(address _target, string _func, variadic _args) internal returns (string) {
        return keccak256(_target, _func, _args);
    }

    function _executeIssue(string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        _clearVotes(_issueId);
        executing = true;
        variadic ret = _target.call(_func, _args);
        executing = false;
        emit IssueExecuted(msg.sender, _issueId, _target, _func, _args);
        return ret;
    }

    function _clearVotes(string _issueId) internal {
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
        delete currentIssues[_issueId];
    }

    function _addAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        require(_admin != address(this), "A multisig cannot be its own signer");
        require(adminMap[_admin] == 0, "Account is already an admin");
        admins.push(_admin);
        adminMap[_admin] = admins.length;
        configVersion++;
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
        configVersion++;
        emit AdminRemoved(_admin);
    }

    function _swapAdmin(address _adminToReplace, address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        require(_admin != address(this), "A multisig cannot be its own signer");
        uint index = adminMap[_admin];
        require(index == 0, "Account is already an admin");
        index = adminMap[_adminToReplace];
        require(index > 0, "Account to replace is not an admin");
        admins[index - 1] = _admin;
        adminMap[_admin] = index;
        adminMap[_adminToReplace] = 0;
        configVersion++;
        emit AdminSwapped(_adminToReplace, _admin);
    }

    function setDefaultVotingThresholdBps(uint _defaultVotingThresholdBps) external onlyOwner {
        require(_defaultVotingThresholdBps > 0, "Default voting threshold must be greater than 0");
        require(_defaultVotingThresholdBps <= 10000, "Default voting threshold must be less than 100%");
        defaultVotingThresholdBps = _defaultVotingThresholdBps;
        configVersion++;
        emit DefaultVotingThresholdSet(_defaultVotingThresholdBps);
    }
}
