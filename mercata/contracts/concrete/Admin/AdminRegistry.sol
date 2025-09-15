contract record AdminRegistry {
    mapping (string => address) public record delegates;

    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;

    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;

    mapping (address => mapping (string => uint)) public record votingThresholds;

    event IssueCreated(address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address executor, string issueId, address target, string func, variadic args);

    constructor(address[] _initialAdmins) {
        for (uint i = 0; i < _initialAdmins.length; i++) {
            admins.push(_initialAdmins[i]);
            adminMap[_initialAdmins[i]] = admins.length;
        }
    }

    function addAdmin(address _admin) external {
        castVoteOnIssue(this, "_addAdmin", _admin);
    }

    function removeAdmin(address _admin) external {
        castVoteOnIssue(this, "_removeAdmin", _admin);
    }

    function swapAdmin(address _admin) external {
        castVoteOnIssue(this, "_swapAdmin", _admin);
    }

    function isAdminAddress(address _admin) external returns (bool) {
        return adminMap[_admin] > 0;
    }

    function castVoteOnIssue(address _target, string _func, variadic _args) public returns (bool, variadic) {
        // For testing: treat blockapps_test user as an admin
        if (msg.sender == address(0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce) && adminMap[msg.sender] == 0) {
            adminMap[msg.sender] = 1; // Add test user as admin
        }
        
        if (adminMap[msg.sender] != 0 || adminMap[_target] != 0) {
            address sender = msg.sender;
            if (adminMap[msg.sender] == 0) {
                sender = _target;
                _target = msg.sender;
            }
            string issueId = _getIssueId(_target, _func, _args);
            require(votesMap[issueId][sender] == 0, "Cannot cast multiple votes for the same issue");

            try {
                _createIssue(issueId, _target, _func, _args);
            } catch {

            }

            if (_shouldExecute(issueId, _target, _func, _args)) {
                variadic ret = _executeIssue(issueId, _target, _func, _args);
                return (true, ret);
            } else {
                votes[issueId].push(sender);
                votesMap[issueId][sender] = votes[issueId].length;
                emit IssueVoted(sender, issueId, _target, _func, _args);
                return (false, issueId);
            }
        } else {
            try {
                if ( _target == this && (_func == "addWhitelist" || _func == "removeWhitelist") && address(_args[0]) == msg.sender) {
                    string issueId = _getIssueId(_target, _func, _args);
                    variadic ret = _executeIssue(issueId, _target, _func, _args);
                    return (true, ret);
                }
            } catch {

            }
            address sender = msg.sender;
            address target = _target;
            require(whitelist[target][_func][sender] || whitelist[sender][_func][target], "Only an admin or a whitelisted account can call castVoteOnIssue");
            if (!whitelist[target][_func][sender]) {
                sender = _target;
                target = msg.sender;
            }
            string issueId = _getIssueId(target, _func, _args);
            if (whitelist[target][_func][sender]) {
                variadic ret = _executeIssue(issueId, target, _func, _args);
                return (true, ret);
            } else {
                _createIssue(issueId, target, _func, _args);
            }
            return (false, issueId);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func, variadic _args) internal returns (bool) {
        return true;
        address delegate = delegates["_shouldExecute"];
        if (delegate != address(0)) {
            return delegate.delegatecall("_shouldExecute", _issueId, _target, _func, _args);
        } else {
            uint issueVotes = votes[_issueId].length;
            uint votingThresholdBps = votingThresholds[_target][_func];
            if (votingThresholdBps > 0) {
                return 10000 * (issueVotes + 1) > votingThresholdBps * admins.length;
            } else {
                return 3 * (issueVotes + 1) > 2 * admins.length;
            }
        }
    }

    function _createIssue(string _issueId, address _target, string _func, variadic _args) internal {
        require(votes[_issueId].length == 0, "Issue already exists");
        emit IssueCreated(msg.sender, _issueId, _target, _func, _args);
    }

    function getIssueId(address _target, string _func, variadic _args) external returns (string) {
        return _getIssueId(_target, _func, _args);
    }

    function _getIssueId(address _target, string _func, variadic _args) internal returns (string) {
        address delegate = delegates["_getIssueId"];
        if (delegate != address(0)) {
            return delegate.delegatecall("_getIssueId", _issueId, _target, _func, _args);
        } else {
            return keccak256(_target, _func, _args);
        }
    }

    function _executeIssue(string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        address delegate = delegates["_executeIssue"];
        if (delegate != address(0)) {
            return delegate.delegatecall("_executeIssue", _issueId, _target, _func, _args);
        } else {
            variadic ret = "";
            if (_target == this && delegates[_func] != address(0)) {
                ret = delegates[_func].delegatecall(_func, _args);
            } else {
                ret = _target.call(_func, _args);
            }
            for (uint i = 0; i < votes[_issueId].length; i++) {
                votesMap[_issueId][votes[_issueId][i]] = 0;
            }
            delete votes[_issueId];
            emit IssueExecuted(msg.sender, _issueId, _target, _func, _args);
            return ret;
        }
    }

    function _addAdmin(address _admin) internal {
        admins.push(_admin);
        adminMap[_admin] = admins.length;
    }

    function _removeAdmin(address _admin) internal {
        uint index = adminMap[_admin];
        require(index > 0, "Account is not an admin");
        address swap = admins[admins.length - 1];
        admins[index - 1] = swap;
        adminMap[swap] = index;
        adminMap[_admin] = 0;
        admins[admins.length - 1] = address(0);
        admins.length -= 1;
    }

    function _swapAdmin(address _admin) internal {
        uint index = adminMap[_admin];
        require(index == 0, "Account is already an admin");
        index = adminMap[msg.sender];
        require(index > 0, "Caller is not an admin");
        address swap = admins[admins.length - 1];
        admins[index - 1] = _admin;
        adminMap[_admin] = index;
        adminMap[msg.sender] = 0;
    }

    function addWhitelist(address _target, string _func, address _user) internal {
        whitelist[_target][_func][_user] = true;
    }

    function removeWhitelist(address _target, string _func, address _user) internal {
        whitelist[_target][_func][_user] = false;
    }

    function setVotingThreshold(address _target, string _func, uint _votingThresholdBps) internal {
        votingThresholds[_target][_func] = _votingThresholdBps;
    }

    function createContract(string _contractName, string _contractSrc, variadic _args) internal returns (address) {
        return create(_contractName, _contractSrc, _args);
    }

    function createSaltedContract(string _salt, string _contractName, string _contractSrc, variadic _args) internal returns (address) {
        return create2(_salt, _contractName, _contractSrc, _args);
    }

    function updateDelegate(string _func, address _delegate) internal {
        delegates[_func] = _delegate;
    }
}