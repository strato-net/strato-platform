import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record AdminRegistry is Ownable {
    uint public constant MINIMUM_DELAY = 172800; // 2 days
    uint public constant GRACE_PERIOD = 1209600; // 14 days

    struct Timelock {
        uint queuedAt;
        uint executableAt;
        uint expiresAt;
    }

    address[] public record admins;
    
    mapping (address => uint) public record adminMap;
    
    mapping (string => address[]) public record votes; // votes[issueId] = [voter1, voter2, ...]
    
    mapping (string => mapping (address => uint)) public record votesMap; // votesMap[issueId][voter] = index of voter in votes[issueId]
    
    mapping (string => bool) public record currentIssues; // currentIssues[issueId] = true if issue is active, false otherwise
    
    mapping (string => Timelock) public record timelocks; // timelocks[issueId] = Timelock(queuedAt, executableAt, expiresAt)
    
    mapping (address => mapping (string => mapping (address => bool))) public record whitelist; 
    
    mapping (address => mapping (string => uint)) public record votingThresholds;

    uint public defaultVotingThresholdBps = 6000; // 3/5

    event IssueCreated(address sender, address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address sender, address voter, string issueId, address target, string func, variadic args);
    event IssueQueued(address sender, address queueExecutor, string issueId, address target, string func, uint executableAt, uint expiresAt, variadic args);
    event IssueExecuted(address sender, address executor, string issueId, address target, string func, variadic args);
    event IssueVoteWithdrawn(address sender, address voter, string issueId);
    event IssueDismissed(address sender, string issueId);

    bool public initialized = false;

    modifier onlyOnce() {
        require(!initialized, "AdminRegistry is already initialized");
        initialized = true;
        _;
    }

    constructor() Ownable(this) { }

    function initialize(address[] _initialAdmins) external onlyOnce {
        defaultVotingThresholdBps = 6000; // 3/5
        require(admins.length == 0, "AdminRegistry is already initialized");
        for (uint i = 0; i < _initialAdmins.length; i++) {
            require(_initialAdmins[i] != address(0), "Invalid admin address");
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

    function dismissIssue(string _issueId) external {
        require(currentIssues[_issueId], "Issue does not exist or is not active");
        require(timelocks[_issueId].executableAt == 0, "Cannot dismiss queued issue");
        require(votes[_issueId].length == 1, "Only issues with a single vote can be dismissed");
        require(votes[_issueId][0] == msg.sender, "Only the proposer can dismiss their issue");

        _clearIssue(_issueId);
        emit IssueDismissed(msg.sender, _issueId);
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
            require(timelocks[issueId].executableAt == 0, "Cannot vote on queued issue");
            bool hasVoted = votesMap[issueId][sender] != 0;

            _createIssue(sender, issueId, _target, _func, _args);

            if (!hasVoted) {
                votes[issueId].push(sender);
                votesMap[issueId][sender] = votes[issueId].length;
                emit IssueVoted(msg.sender, sender, issueId, _target, _func, _args);
            }

            if (_shouldExecute(issueId, _target, _func, _args)) {
                if (admins.length == 1) {
                    variadic ret = _executeIssue(sender, issueId, _target, _func, _args);
                    return (true, ret);
                }
                _queueIssue(sender, issueId, _target, _func, _args);
                return (false, issueId);
            } else {
                return (false, issueId);
            }
        } else {
            // Non-admin path: only execute if whitelisted
            address sender = msg.sender;
            address target = _target;
            require(whitelist[target][_func][sender] || whitelist[sender][_func][target], "Only an admin or a whitelisted account can call castVoteOnIssue");
            if (!whitelist[target][_func][sender] && whitelist[sender][_func][target]) {
                sender = _target;
                target = msg.sender;
            }
            string issueId = _getIssueId(target, _func, _args);
            variadic ret = _executeIssue(sender, issueId, target, _func, _args);
            return (true, ret);
        }
    }

    function _shouldExecute(string _issueId, address _target, string _func, variadic _args) internal returns (bool) {
        uint issueVotes = 0;
        for (uint i = 0; i < votes[_issueId].length; i++) {
            if (adminMap[votes[_issueId][i]] != 0) {
                issueVotes++;
            }
        }

        uint votingThresholdBps = votingThresholds[_target][_func];
        if (votingThresholdBps == 0) votingThresholdBps = defaultVotingThresholdBps;

        return 10000 * issueVotes >= votingThresholdBps * admins.length;
    }

    function _createIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal {
        if(votes[_issueId].length == 0) {
            currentIssues[_issueId] = true;
            emit IssueCreated(msg.sender, _sender, _issueId, _target, _func, _args);
        }
    }

    function executeIssue(address _target, string _func, variadic _args) external returns (variadic) {
        string issueId = _getIssueId(_target, _func, _args);
        Timelock storage timelock = timelocks[issueId];
        require(timelock.executableAt != 0, "Issue is not queued");
        require(block.timestamp >= timelock.executableAt, "Timelock delay has not elapsed");
        require(block.timestamp <= timelock.expiresAt, "Queued issue has expired");
        require(_shouldExecute(issueId, _target, _func, _args), "Voting threshold is no longer met");
        return _executeIssue(msg.sender, issueId, _target, _func, _args);
    }

    function withdrawVote(address _target, string _func, variadic _args) external {
        string issueId = _getIssueId(_target, _func, _args);
        require(currentIssues[issueId], "Issue does not exist or is not active");
        require(votesMap[issueId][msg.sender] != 0, "Caller has not voted on this issue");

        _removeVote(issueId, msg.sender);
        emit IssueVoteWithdrawn(msg.sender, msg.sender, issueId);

        if (votes[issueId].length == 0) {
            _clearIssue(issueId);
        } else if (timelocks[issueId].executableAt != 0 && !_shouldExecute(issueId, _target, _func, _args)) {
            _clearTimelock(issueId);
        }
    }

    function getIssueId(address _target, string _func, variadic _args) external returns (string) {
        return _getIssueId(_target, _func, _args);
    }

    function _getIssueId(address _target, string _func, variadic _args) internal returns (string) {
        return keccak256(_target, _func, _args);
    }

    function _queueIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal {
        require(timelocks[_issueId].executableAt == 0, "Issue is already queued");
        uint executableAt = block.timestamp + MINIMUM_DELAY;
        timelocks[_issueId] = Timelock(block.timestamp, executableAt, executableAt + GRACE_PERIOD);
        emit IssueQueued(msg.sender, _sender, _issueId, _target, _func, executableAt, timelocks[_issueId].expiresAt, _args);
    }

    function _executeIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        variadic ret = _target.call(_func, _args);
        _clearIssue(_issueId);
        emit IssueExecuted(msg.sender, _sender, _issueId, _target, _func, _args);
        return ret;
    }

    function _removeVote(string _issueId, address _voter) internal {
        uint voteIndex = votesMap[_issueId][_voter];
        require(voteIndex != 0, "Voter has not voted on this issue");

        uint index = voteIndex - 1;
        address swap = votes[_issueId][votes[_issueId].length - 1];
        votes[_issueId][index] = swap;
        votesMap[_issueId][swap] = index + 1;
        votesMap[_issueId][_voter] = 0;
        votes[_issueId][votes[_issueId].length - 1] = address(0);
        votes[_issueId].length -= 1;
    }

    function _clearIssue(string _issueId) internal {
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
        delete currentIssues[_issueId];
        _clearTimelock(_issueId);
    }

    function _clearTimelock(string _issueId) internal {
        timelocks[_issueId].queuedAt = 0;
        timelocks[_issueId].executableAt = 0;
        timelocks[_issueId].expiresAt = 0;
    }

    function _addAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        require(adminMap[_admin] == 0, "Account is already an admin");
        admins.push(_admin);
        adminMap[_admin] = admins.length;
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
    }

    function _swapAdmin(address _adminToReplace, address _admin) external onlyOwner {
        uint index = adminMap[_admin];
        require(index == 0, "Account is already an admin");
        index = adminMap[_adminToReplace];
        require(index > 0, "Caller is not an admin");
        address swap = admins[admins.length - 1];
        admins[index - 1] = _admin;
        adminMap[_admin] = index;
        adminMap[_adminToReplace] = 0;
    }

    function addWhitelist(address _target, string _func, address _user) external onlyOwner {
        if (_target == address(this)) {
            require(
                _func != "addWhitelist" &&
                _func != "removeWhitelist" &&
                _func != "_addAdmin" &&
                _func != "_clearIssue" &&
                _func != "_clearTimelock" &&
                _func != "_createIssue" &&
                _func != "_executeIssue" &&
                _func != "_removeAdmin" &&
                _func != "_removeVote" &&
                _func != "_queueIssue" &&
                _func != "_shouldExecute" &&
                _func != "_swapAdmin" &&
                _func != "executeIssue" &&
                _func != "setVotingThreshold" &&
                _func != "setDefaultVotingThresholdBps" &&
                _func != "withdrawVote" &&
                _func != "createContract" &&
                _func != "createSaltedContract",
                "Cannot whitelist internal governance functions"
            );
        }
        whitelist[_target][_func][_user] = true;
    }

    function removeWhitelist(address _target, string _func, address _user) external onlyOwner {
        whitelist[_target][_func][_user] = false;
    }

    function setVotingThreshold(address _target, string _func, uint _votingThresholdBps) external onlyOwner {
        require(_votingThresholdBps > 0, "Voting threshold must be greater than 0");
        require(_votingThresholdBps <= 10000, "Voting threshold must be less than 100%");
        votingThresholds[_target][_func] = _votingThresholdBps;
    }

    function setDefaultVotingThresholdBps(uint _defaultVotingThresholdBps) external onlyOwner {
        require(_defaultVotingThresholdBps > 0, "Default voting threshold must be greater than 0");
        require(_defaultVotingThresholdBps <= 10000, "Default voting threshold must be less than 100%");
        defaultVotingThresholdBps = _defaultVotingThresholdBps;
    }

    function createContract(string _contractName, string _contractSrc, variadic _args) external onlyOwner returns (address) {
        return create(_contractName, _contractSrc, _args);
    }

    function createSaltedContract(string _salt, string _contractName, string _contractSrc, variadic _args) external onlyOwner returns (address) {
        return create2(_salt, _contractName, _contractSrc, _args);
    }
}
