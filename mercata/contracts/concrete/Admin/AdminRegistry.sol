import "../../abstract/ERC20/access/Authorizable.sol";

contract record AdminRegistry {
    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;
    mapping (string => bool) public record currentIssues;

    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;

    mapping (address => mapping (string => uint)) public record votingThresholds;

    event IssueCreated(address sender, address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address sender, address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address sender, address executor, string issueId, address target, string func, variadic args);

    bool public initialized = false;

    modifier onlyOnce() {
        require(!initialized, "AdminRegistry is already initialized");
        initialized = true;
        _;
    }

    constructor() { }

    function initialize(address[] _initialAdmins) external onlyOnce {
        require(admins.length == 0, "AdminRegistry is already initialized");
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

    function swapAdmin(address _adminToReplace, address _newAdmin) external {
        castVoteOnIssue(this, "_swapAdmin", _adminToReplace, _newAdmin);
    }

    function isAdminAddress(address _admin) external returns (bool) {
        return adminMap[_admin] > 0;
    }

    function castVoteOnIssue(address _target, string _func, variadic _args) public returns (bool, variadic) {
        if (adminMap[msg.sender] != 0 || adminMap[_target] != 0) {
            address sender = msg.sender;
            if (adminMap[msg.sender] == 0) {
                if (_target != tx.origin) {
                    bool authorizationGranted = false;
                    try {
                        authorizationGranted = Authorizable(_target).isAuthorized(msg.sender);
                    } catch {

                    }
                    require(authorizationGranted, "Cannot forge a vote on behalf of an admin without their consent");
                }
                sender = _target;
                _target = msg.sender;
            }
            string issueId = _getIssueId(_target, _func, _args);
            bool hasVoted = votesMap[issueId][sender] != 0;

            _createIssue(sender, issueId, _target, _func, _args);

            if (!hasVoted) {
                votes[issueId].push(sender);
                votesMap[issueId][sender] = votes[issueId].length;
                emit IssueVoted(msg.sender, sender, issueId, _target, _func, _args);
            }

            if (_shouldExecute(issueId, _target, _func, _args)) {
                variadic ret = _executeIssue(sender, issueId, _target, _func, _args);
                return (true, ret);
            } else {
                return (false, issueId);
            }
        } else {
            try {
                if ( _target == this && (_func == "addWhitelist" || _func == "removeWhitelist") && address(_args[0]) == msg.sender) {
                    string issueId = _getIssueId(_target, _func, _args);
                    variadic ret = _executeIssue(msg.sender, issueId, _target, _func, _args);
                    return (true, ret);
                }
            } catch {

            }
            address sender = msg.sender;
            address target = _target;
            if (!whitelist[target][_func][sender] && whitelist[sender][_func][target]) {
                sender = _target;
                target = msg.sender;
            }
            string issueId = _getIssueId(target, _func, _args);
            if (whitelist[target][_func][sender]) {
                variadic ret = _executeIssue(sender, issueId, target, _func, _args);
                return (true, ret);
            } else {
                _createIssue(sender, issueId, target, _func, _args);
            }
            return (false, issueId);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func, variadic _args) internal returns (bool) {
        uint issueVotes = votes[_issueId].length;
        uint votingThresholdBps = votingThresholds[_target][_func];
        if (votingThresholdBps > 0) {
            return 10000 * issueVotes >= votingThresholdBps * admins.length;
        } else {
            return 3 * issueVotes >= 2 * admins.length;
        }
    }

    function _createIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal {
        if(votes[_issueId].length == 0) {
            currentIssues[_issueId] = true;
            emit IssueCreated(msg.sender, _sender, _issueId, _target, _func, _args);
        }
    }

    function getIssueId(address _target, string _func, variadic _args) external returns (string) {
        return _getIssueId(_target, _func, _args);
    }

    function _getIssueId(address _target, string _func, variadic _args) internal returns (string) {
        return keccak256(_target, _func, _args);
    }

    function _executeIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        variadic ret = _target.call(_func, _args);
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
        }
        delete votes[_issueId];
        delete currentIssues[_issueId];
        emit IssueExecuted(msg.sender, _sender, _issueId, _target, _func, _args);
        return ret;
    }

    function _addAdmin(address _admin) internal {
        require(adminMap[_admin] == 0, "Account is already an admin");
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

    function _swapAdmin(address _adminToReplace, address _admin) internal {
        uint index = adminMap[_admin];
        require(index == 0, "Account is already an admin");
        index = adminMap[_adminToReplace];
        require(index > 0, "Caller is not an admin");
        address swap = admins[admins.length - 1];
        admins[index - 1] = _admin;
        adminMap[_admin] = index;
        adminMap[_adminToReplace] = 0;
    }

    function addWhitelist(address _target, string _func, address _user) internal {
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
                _func != "createContract" &&
                _func != "createSaltedContract",
                "Cannot whitelist internal governance functions"
            );
        }
        whitelist[_target][_func][_user] = true;
    }

    function removeWhitelist(address _target, string _func, address _user) internal {
        whitelist[_target][_func][_user] = false;
    }

    function setVotingThreshold(address _target, string _func, uint _votingThresholdBps) internal {
        require(_votingThresholdBps <= 10000, "Voting threshold must be less than 100%");
        votingThresholds[_target][_func] = _votingThresholdBps;
    }

    function createContract(string _contractName, string _contractSrc, variadic _args) internal returns (address) {
        return create(_contractName, _contractSrc, _args);
    }

    function createSaltedContract(string _salt, string _contractName, string _contractSrc, variadic _args) internal returns (address) {
        return create2(_salt, _contractName, _contractSrc, _args);
    }
}
