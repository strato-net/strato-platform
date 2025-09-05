contract record AdminRegistry {
    mapping (string => address) public record delegates;

    address[] public record admins;
    mapping (address => uint) adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) votesMap;

    mapping (address => mapping (string => mapping (address => bool))) whitelist;

    event IssueCreated(address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address executor, string issueId, address target, string func, variadic args);

    modifier onlyAdmin(string f) {
        require(adminMap[msg.sender] != 0, "Only an admin can call " + f);
        _;
    }

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

    function isAdminAddress(address _admin) external returns (bool) {
        return adminMap[_admin] > 0;
    }

    function castVoteOnIssue(address _target, string _func, variadic _args) public onlyAdmin("castVoteOnIssue") returns (bool, variadic) {
        string issueId = _getIssueId(_target, _func, _args);
        require(votesMap[issueId][msg.sender] == 0, "Cannot cast multiple votes for the same issue");

        try {
            _createIssue(issueId, _target, _func, _args);
        } catch {

        }

        if (_shouldExecute(issueId, _target, _func, _args)) {
            variadic ret = _executeIssue(issueId, _target, _func, _args);
            return (true, ret);
        } else {
            votes[issueId].push(msg.sender);
            votesMap[issueId][msg.sender] = votes[issueId].length;
            emit IssueVoted(msg.sender, issueId, _target, _func, _args);
            return (false, issueId);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func, variadic _args) internal returns (bool) {
        address delegate = delegates["_shouldExecute"];
        if (delegate != address(0)) {
            return delegate.delegatecall("_shouldExecute", _issueId, _target, _func, _args);
        } else {
            uint issueVotes = votes[_issueId].length;
            return 3 * (issueVotes + 1) > 2 * admins.length;
        }
    }

    function createIssue(address _target, string _func, variadic _args) external returns (bool, variadic) {
        string issueId = _getIssueId(_target, _func, _args);
        if (whitelist[_target][_func][msg.sender]) {
            variadic ret = _executeIssue(issueId, _target, _func, _args);
            return (true, ret);
        } else {
            _createIssue(issueId, _target, _func, _args);
            return (false, issueId);
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

    function addWhitelist(address _target, string _func, address _user) internal {
        whitelist[_target][_func][_user] = true;
    }

    function removeWhitelist(address _target, string _func, address _user) internal {
        whitelist[_target][_func][_user] = false;
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