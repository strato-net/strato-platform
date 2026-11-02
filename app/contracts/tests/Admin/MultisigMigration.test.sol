import "../../abstract/ERC20/utils/Context.sol";
import "../../concrete/Admin/Multisig.sol";

// What a multisig User wallet made before Multisig existed runs (ms2, efa89067...): the User
// shell, whose onlyOwner falls back to a vote, over the AdminRegistry logic at 52c1abf4.
// Copied from the deployed sources with the contracts renamed.

abstract contract LegacyAuthorizable {
    mapping (address => mapping (address => uint)) public record authorizations;

    bool internal bypassAuthorizations = false;

    function _authorize(address _target, address _account, uint _authorizations) internal {
        authorizations[_target][_account] += _authorizations;
    }

    function isAuthorized(address _account) external returns (bool) {
        if (bypassAuthorizations) {
            return true;
        } else {
            uint numAuthorizations = authorizations[msg.sender][_account];
            if (numAuthorizations > 0) {
                authorizations[msg.sender][_account]--;
                return true;
            } else {
                return false;
            }
        }
    }
}

abstract contract LegacyOwnable is Context {
    address private _owner;

    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    modifier onlyOwner() {
        try {
            _checkOwner();
            _;
        } catch {
            address myOwner = owner();
            LegacyAdminRegistry admin = LegacyAdminRegistry(myOwner);
            address sender = _msgSender();
            if (myOwner == this) {
                sender = this;
            }
            (bool didExecute, variadic ret) = admin.castVoteOnIssue(sender, msg.sig, msg.data);
            return ret;
        }
    }

    function owner() public view virtual returns (address) {
        return _owner;
    }

    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            require(owner() == _msgSender(), string(owner()) + " does not match sender " + string(_msgSender()));
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

contract record LegacyProxy is LegacyOwnable {
    address logicContract;

    constructor(address _logicContract, address _initialOwner) LegacyOwnable(_initialOwner) {
        logicContract = _logicContract;
    }

    function setLogicContract(address _logicContract) onlyOwner {
        logicContract = _logicContract;
    }

    fallback(variadic args) external returns (variadic) {
        return logicContract.delegatecall(msg.sig, args);
    }
}

contract record LegacyUser is LegacyProxy, LegacyAuthorizable {
    string public username;

    address[] public record userAddresses;
    mapping (address => uint) private userAddressMap;

    constructor(string _username) LegacyProxy(address(0), msg.sender) {
        username = _username;
    }

    function _checkOwner() internal view override {
        address sender = _msgSender();
        if (owner() != sender) {
            require(userAddressMap[sender] > 0, string(sender) + " is not an authorized user account");
        }
    }

    function _transferOwnership(address newOwner) internal override {
        for (uint i = 0; i < userAddresses.length; i++) {
            address a = userAddresses[i];
            userAddressMap[a] = 0;
            userAddresses[i] = address(0);
        }
        userAddresses.length = 0;
        userAddresses.push(newOwner);
        userAddressMap[newOwner] = 1;
        super._transferOwnership(newOwner);
    }

    function addUserAddress(address _userAddress) public onlyOwner {
        userAddresses.push(_userAddress);
        userAddressMap[_userAddress] = userAddresses.length;
    }

    function revokeUserAddress(address _userAddress) public onlyOwner {
        uint i = userAddressMap[_userAddress];
        if (i > 0) {
            address last = userAddresses[userAddresses.length - 1];
            userAddresses[i - 1] = last;
            userAddressMap[last] = i;
            userAddressMap[_userAddress] = 0;
            userAddresses.length--;
        }
    }

    function revokeAllUserAddresses() public onlyOwner {
        _transferOwnership(_msgSender());
    }

    function createContract(string contractName, string contractSrc, variadic args) public onlyOwner {
        create(contractName, contractSrc, args);
    }

    function createSaltedContract(string salt, string contractName, string contractSrc, variadic args) public onlyOwner {
        create2(salt, contractName, contractSrc, args);
    }

    function callContract(address contractToCall, string functionName, variadic args) public returns (variadic) onlyOwner {
        variadic result = address(contractToCall).call(functionName, args);
        return result;
    }
}

contract record LegacyAdminRegistry is LegacyOwnable {
    address[] public record admins;
    mapping (address => uint) public record adminMap;

    mapping (string => address[]) public record votes;
    mapping (string => mapping (address => uint)) public record votesMap;
    mapping (string => bool) public record currentIssues;

    mapping (address => mapping (string => mapping (address => bool))) public record whitelist;

    mapping (address => mapping (string => uint)) public record votingThresholds;

    uint public defaultVotingThresholdBps = 6000;

    event IssueCreated(address sender, address creator, string issueId, address target, string func, variadic args);
    event IssueVoted(address sender, address voter, string issueId, address target, string func, variadic args);
    event IssueExecuted(address sender, address executor, string issueId, address target, string func, variadic args);
    event IssueDismissed(address sender, string issueId);

    bool public initialized = false;

    modifier onlyOnce() {
        require(!initialized, "AdminRegistry is already initialized");
        initialized = true;
        _;
    }

    constructor() LegacyOwnable(this) { }

    function initialize(address[] _initialAdmins) external onlyOnce {
        defaultVotingThresholdBps = 6000;
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
        if (adminMap[msg.sender] != 0 || adminMap[_target] != 0) {
            address sender = msg.sender;
            if (adminMap[msg.sender] == 0) {
                if (_target != tx.origin) {
                    bool authorizationGranted = false;
                    try {
                        authorizationGranted = LegacyAuthorizable(_target).isAuthorized(msg.sender);
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
        uint issueVotes = votes[_issueId].length;

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
            votes[_issueId][i] = address(0);
        }
        votes[_issueId].length = 0;
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

contract Signer {
    function invoke(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract MockToken {
    mapping (address => uint) public balanceOf;

    constructor(address holder) {
        balanceOf[holder] = 1000;
    }

    function transfer(address to, uint amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient funds");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Describe_MultisigMigration {
    LegacyUser wallet;
    Multisig ms;
    MockToken token;
    Signer a;
    Signer b;
    Signer c;
    Signer outsider;

    function beforeEach() {
        a = new Signer();
        b = new Signer();
        c = new Signer();
        outsider = new Signer();
        wallet = new LegacyUser("ms2");
        wallet.setLogicContract(address(new LegacyAdminRegistry()));
        LegacyAdminRegistry(address(wallet)).initialize([address(a), address(b), address(c)]);
        wallet.transferOwnership(address(wallet));
        token = new MockToken(address(wallet));
        ms = Multisig(address(wallet));
    }

    function vote(Signer who, address target, string func, variadic args) internal returns (bool) {
        (bool executed, variadic ret) = who.invoke(address(wallet), "castVoteOnIssue", target, func, args);
        return executed;
    }

    function rejects(Signer who, address target, string func, variadic args) internal returns (bool) {
        bool reverted = false;
        try {
            who.invoke(target, func, args);
        } catch {
            reverted = true;
        }
        return reverted;
    }

    // Two of the three signers vote, under the old logic, to switch to Multisig
    function switchToMultisig() internal {
        address logic = address(new Multisig());
        vote(a, address(wallet), "setLogicContract", logic);
        require(vote(b, address(wallet), "setLogicContract", logic), "switch did not execute");
    }

    function it_keeps_signers_threshold_and_funds() {
        switchToMultisig();
        require(ms.isAdminAddress(address(a)) && ms.isAdminAddress(address(b)) && ms.isAdminAddress(address(c)), "signers lost");
        require(!ms.isAdminAddress(address(outsider)), "outsider became a signer");
        require(ms.defaultVotingThresholdBps() == 6000 && ms.initialized(), "configuration lost");
        require(wallet.owner() == address(wallet), "owner changed");
        require(rejects(outsider, address(wallet), "initialize", [address(outsider)]), "outsider reinitialized");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
        require(!vote(a, address(token), "transfer", address(outsider), 1000), "one vote executed");
        require(vote(b, address(token), "transfer", address(outsider), 1000), "two signers did not execute");
        require(token.balanceOf(address(outsider)) == 1000, "transfer did not land");
    }

    function it_drops_votes_cast_under_the_old_logic() {
        vote(a, address(token), "transfer", address(outsider), 1000);
        switchToMultisig();
        require(!vote(b, address(token), "transfer", address(outsider), 1000), "old vote counted");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
        require(vote(c, address(token), "transfer", address(outsider), 1000), "fresh votes did not execute");
    }

    function it_stops_honoring_old_whitelist_entries() {
        vote(a, address(wallet), "addWhitelist", address(token), "transfer", address(outsider));
        vote(b, address(wallet), "addWhitelist", address(token), "transfer", address(outsider));
        require(LegacyAdminRegistry(address(wallet)).whitelist(address(token), "transfer", address(outsider)), "whitelist not granted");
        switchToMultisig();
        require(rejects(outsider, address(wallet), "castVoteOnIssue", address(token), "transfer", address(outsider), 1000), "whitelisted call executed");
        require(token.balanceOf(address(wallet)) == 1000, "funds moved");
    }

    function it_gives_the_owner_fallback_no_vote() {
        switchToMultisig();
        require(rejects(a, address(wallet), "callContract", address(token), "transfer", address(a), 1000), "signer spent directly");
        require(rejects(outsider, address(wallet), "transferOwnership", address(outsider)), "outsider took ownership");
        require(rejects(outsider, address(wallet), "setLogicContract", address(outsider)), "outsider upgraded");
        require(token.balanceOf(address(wallet)) == 1000 && wallet.owner() == address(wallet), "fallback acted");
    }

    function it_gives_a_failing_owner_call_no_vote() {
        switchToMultisig();
        // The call reverts inside onlyOwner, whose catch then asks the wallet to vote as itself
        vote(a, address(wallet), "transferOwnership", address(0));
        vote(b, address(wallet), "transferOwnership", address(0));
        require(rejects(c, address(wallet), "castVoteOnIssue", address(wallet), "transferOwnership", address(0)), "failing call succeeded");
        require(wallet.owner() == address(wallet), "owner changed");
        vote(a, address(token), "transfer", address(outsider), 1000);
        require(vote(b, address(token), "transfer", address(outsider), 1000), "lock was left set");
    }
}
