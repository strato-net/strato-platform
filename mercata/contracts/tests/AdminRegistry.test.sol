contract record AdminRegistryV1 {
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

    function castVoteOnIssue(address _target, string _func, variadic _args) external onlyAdmin("castVoteOnIssue") {
        string issueId = _getIssueId(_target, _func, _args);
        require(votesMap[issueId][msg.sender] == 0, "Cannot cast multiple votes for the same issue");

        try {
            _createIssue(issueId, _target, _func, _args);
        } catch {

        }

        uint issueVotes = votes[issueId].length;

        if (3 * (issueVotes + 1) > 2 * admins.length) { // execute issue
            _executeIssue(issueId, _target, _func, _args);
        } else {
            votes[issueId].push(msg.sender);
            votesMap[issueId][msg.sender] = votes[issueId].length;
            emit IssueVoted(msg.sender, issueId, _target, _func, _args);
        }
    }

    function createIssue(address _target, string _func, variadic _args) external returns (bool, string) {
        string issueId = _getIssueId(_target, _func, _args);
        if (whitelist[_target][_func][msg.sender]) {
            _executeIssue(issueId, _target, _func, _args);
            return (true, issueId);
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
        return keccak256(_target, _func, _args);
    }

    function _executeIssue(string _issueId, address _target, string _func, variadic _args) internal {
        _target.call(_func, _args);
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
        }
        delete votes[_issueId];
        emit IssueExecuted(msg.sender, _issueId, _target, _func, _args);
    }
}