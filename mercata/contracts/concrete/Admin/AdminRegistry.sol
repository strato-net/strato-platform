import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record AdminRegistry is Ownable {
    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;
    mapping (string => address[]) public record noVotes;
    mapping (string => mapping (address => uint)) public record noVotesMap;
    mapping (string => bool) public record currentIssues;

    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;

    mapping (address => mapping (string => uint)) public record votingThresholds;

    uint public defaultVotingThresholdBps = 6000; // 3/5

    event IssueCreated(address sender, address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address sender, address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address sender, address executor, string issueId, address target, string func, variadic args);

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

    function castVoteOnIssue(address _target, string _func, variadic _args) public returns (bool, variadic) {
        return castVoteOnIssue(_target, _func, _args, true);
    }

    function castVoteOnIssue(address _target, string _func, variadic _args, bool _voteYes) public returns (bool, variadic) {
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
            bool hasVotedYes = votesMap[issueId][sender] != 0;
            bool hasVotedNo = noVotesMap[issueId][sender] != 0;

            _createIssue(sender, issueId, _target, _func, _args);

            if (_voteYes) {
                if (hasVotedNo) {
                    _removeNoVote(issueId, sender);
                }
                if (!hasVotedYes) {
                    votes[issueId].push(sender);
                    votesMap[issueId][sender] = votes[issueId].length;
                    emit IssueVoted(msg.sender, sender, issueId, _target, _func, _args);
                }
            } else {
                if (hasVotedYes) {
                    _removeYesVote(issueId, sender);
                }
                if (!hasVotedNo) {
                    noVotes[issueId].push(sender);
                    noVotesMap[issueId][sender] = noVotes[issueId].length;
                    emit IssueVoted(msg.sender, sender, issueId, _target, _func, _args);
                }
            }

            if (_shouldExecute(issueId, _target, _func, _args)) {
                variadic ret = _executeIssue(sender, issueId, _target, _func, _args);
                return (true, ret);
            } else {
                return (false, issueId);
            }
        } else {
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
        uint yesVotes = votes[_issueId].length;
        uint noVotesCount = noVotes[_issueId].length;

        uint votingThresholdBps = votingThresholds[_target][_func];
        if (votingThresholdBps == 0) votingThresholdBps = defaultVotingThresholdBps;

        bool hasEnoughYes = 10000 * yesVotes >= votingThresholdBps * admins.length;
        bool hasEnoughNo = 10000 * noVotesCount >= votingThresholdBps * admins.length;
        
        return hasEnoughYes && !hasEnoughNo;
    }

    function _createIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal {
        if(votes[_issueId].length == 0 && noVotes[_issueId].length == 0) {
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

    function _removeYesVote(string _issueId, address _voter) internal {
        uint index = votesMap[_issueId][_voter];
        require(index > 0, "Not a yes vote");
        
        address last = votes[_issueId][votes[_issueId].length - 1];
        votes[_issueId][index - 1] = last;
        votesMap[_issueId][last] = index;
        votesMap[_issueId][_voter] = 0;
        votes[_issueId].length--;
    }

    function _removeNoVote(string _issueId, address _voter) internal {
        uint index = noVotesMap[_issueId][_voter];
        require(index > 0, "Not a no vote");
        
        address last = noVotes[_issueId][noVotes[_issueId].length - 1];
        noVotes[_issueId][index - 1] = last;
        noVotesMap[_issueId][last] = index;
        noVotesMap[_issueId][_voter] = 0;
        noVotes[_issueId].length--;
    }

    function _executeIssue(address _sender, string _issueId, address _target, string _func, variadic _args) internal returns (variadic) {
        variadic ret = _target.call(_func, _args);
        for (uint i = 0; i < votes[_issueId].length; i++) {
            votesMap[_issueId][votes[_issueId][i]] = 0;
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
        for (uint i = 0; i < noVotes[_issueId].length; i++) {
            noVotesMap[_issueId][noVotes[_issueId][i]] = 0;
            noVotes[_issueId][i] = address(0);
        }
        noVotes[_issueId].length = 0;
        delete currentIssues[_issueId];
        emit IssueExecuted(msg.sender, _sender, _issueId, _target, _func, _args);
        return ret;
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
