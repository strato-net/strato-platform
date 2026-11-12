/**
 * @title MultisigLogic
 * @notice M-of-N governance executed in a dedicated MultisigWallet's storage.
 * @dev SolidVM delegatecall storage is keyed by variable name. The multisig-prefixed
 * shell fields below intentionally match MultisigWallet and are read-only here.
 */
contract record MultisigLogic {
    uint public constant MIN_SIGNERS = 3;
    uint public constant MAX_TRANSACTION_TIMELOCK = 2592000; // 30 days
    uint public constant ISSUE_APPROVAL_LIFETIME = 2592000; // 30 days
    uint public constant ISSUE_EXECUTION_WINDOW = 604800; // 7 days
    uint public constant NOMINATION_LIFETIME = 2592000; // 30 days

    struct Issue {
        address creator;
        address target;
        string functionName;
        string argumentTypesHash;
        string argumentsHash;
        uint epoch;
        uint nonce;
        uint createdAt;
        uint executableAt;
        uint expiresAt;
        uint approvals;
        bool active;
    }

    struct Nomination {
        uint requiredApprovals;
        uint epoch;
        uint expiresAt;
        bool exists;
    }

    // Shell-owned fields. Logic reads them but mutates them only through shell calls.
    address public multisigFactory;
    uint public multisigEpoch;

    address[] public record signers;
    mapping (address => uint) public record signerMap;
    uint public requiredApprovals;
    uint public transactionTimelock;
    uint public nextIssueNonce;
    bool public multisigInitialized;
    bool private multisigExecuting;

    mapping (string => Issue) public record issues;
    mapping (string => mapping (address => bool)) public record issueApprovals;

    mapping (address => Nomination) public record nominations;
    mapping (address => address[]) public record nominationSigners;
    address private openNominee;

    event IssueCreated(address creator, string issueId, uint nonce, uint epoch, address target, string functionName, string[] argumentTypes, uint approvalExpiresAt, variadic arguments);
    event IssueCreatedNoArgs(address creator, string issueId, uint nonce, uint epoch, address target, string functionName, uint approvalExpiresAt);
    event IssueApproved(address signer, string issueId, uint approvals);
    event IssueApprovalRevoked(address signer, string issueId, uint approvals);
    event IssueQueued(string issueId, uint executableAt, uint expiresAt);
    event IssueCancelled(string issueId);
    event IssueExecuted(address executor, string issueId, address target, string functionName, variadic arguments);
    event IssueExecutedNoArgs(address executor, string issueId, address target, string functionName);
    event IssueDismissed(address creator, string issueId);

    event ConfigurationChanged(uint epoch, address[] signers, uint requiredApprovals);
    event ConfigurationNominated(address nominee, uint epoch, uint expiresAt, address[] signers, uint requiredApprovals);
    event NominationRevoked(address nominee);
    event TransactionTimelockChanged(uint delay, uint epoch);

    modifier onlySigner() {
        require(signerMap[msg.sender] > 0, "Only a signer may call");
        _;
    }

    modifier onlyWallet() {
        require(msg.sender == address(this), "Only the wallet may call");
        _;
    }

    modifier notExecuting() {
        require(!multisigExecuting, "An issue is executing");
        _;
    }

    constructor() {}

    function initialize(address[] _signers, uint _requiredApprovals, uint _transactionTimelock) external {
        require(!multisigInitialized, "Already initialized");
        require(msg.sender == multisigFactory, "Only the factory may initialize");
        _validateConfiguration(_signers, _requiredApprovals);
        require(_transactionTimelock <= MAX_TRANSACTION_TIMELOCK, "Timelock exceeds maximum");

        multisigInitialized = true;
        requiredApprovals = _requiredApprovals;
        transactionTimelock = _transactionTimelock;
        nextIssueNonce = 1;
        for (uint i = 0; i < _signers.length; i++) {
            signers.push(_signers[i]);
            signerMap[_signers[i]] = signers.length;
        }
    }

    function proposeIssue(address _target, string _functionName, string[] _argumentTypes, variadic _arguments) external onlySigner notExecuting returns (string) {
        require(_target != address(0), "Invalid target");
        address proposer = msg.sender;
        uint nonce = nextIssueNonce++;
        string argumentsHash = _canonicalArgumentsHash(_argumentTypes, _arguments);
        string argumentTypesHash = keccak256(_argumentTypes);
        string issueId = keccak256(address(this), multisigEpoch, nonce, _target, _functionName, _argumentTypes, argumentsHash);
        Issue storage issue = issues[issueId];
        issue.creator = proposer;
        issue.target = _target;
        issue.functionName = _functionName;
        issue.argumentTypesHash = argumentTypesHash;
        issue.argumentsHash = argumentsHash;
        issue.epoch = multisigEpoch;
        issue.nonce = nonce;
        issue.createdAt = block.timestamp;
        issue.expiresAt = block.timestamp + ISSUE_APPROVAL_LIFETIME;
        issue.active = true;
        emit IssueCreated(proposer, issueId, nonce, multisigEpoch, _target, _functionName, _argumentTypes, issue.expiresAt, _arguments);
        _approveIssue(issueId, _target, _functionName, _argumentTypes, proposer, _arguments);
        return issueId;
    }

    function proposeIssueNoArgs(address _target, string _functionName) external onlySigner notExecuting returns (string) {
        require(_target != address(0), "Invalid target");
        uint nonce = nextIssueNonce++;
        string noArgumentsHash = keccak256("NO_ARGUMENTS");
        string issueId = keccak256(address(this), multisigEpoch, nonce, _target, _functionName, noArgumentsHash);
        Issue storage issue = issues[issueId];
        issue.creator = msg.sender;
        issue.target = _target;
        issue.functionName = _functionName;
        issue.argumentTypesHash = noArgumentsHash;
        issue.argumentsHash = noArgumentsHash;
        issue.epoch = multisigEpoch;
        issue.nonce = nonce;
        issue.createdAt = block.timestamp;
        issue.expiresAt = block.timestamp + ISSUE_APPROVAL_LIFETIME;
        issue.active = true;
        emit IssueCreatedNoArgs(msg.sender, issueId, nonce, multisigEpoch, _target, _functionName, issue.expiresAt);
        _approveIssueNoArgs(issueId, _target, _functionName);
        return issueId;
    }

    function approveIssue(string _issueId, address _target, string _functionName, string[] _argumentTypes, variadic _arguments) external onlySigner notExecuting returns (bool) {
        address approver = msg.sender;
        return _approveIssue(_issueId, _target, _functionName, _argumentTypes, approver, _arguments);
    }

    function approveIssueNoArgs(string _issueId, address _target, string _functionName) external onlySigner notExecuting returns (bool) {
        return _approveIssueNoArgs(_issueId, _target, _functionName);
    }

    function revokeIssueApproval(string _issueId) external onlySigner notExecuting {
        Issue storage issue = issues[_issueId];
        _requireLiveIssue(issue);
        require(issue.executableAt == 0, "Queued approval cannot be revoked");
        require(issueApprovals[_issueId][msg.sender], "Approval does not exist");
        issueApprovals[_issueId][msg.sender] = false;
        issue.approvals--;
        emit IssueApprovalRevoked(msg.sender, _issueId, issue.approvals);
    }

    function dismissIssue(string _issueId) external notExecuting {
        Issue storage issue = issues[_issueId];
        _requireLiveIssue(issue);
        require(issue.creator == msg.sender, "Only the creator may dismiss");
        require(issue.executableAt == 0, "Queued issue cannot be dismissed");
        require(
            issue.approvals == 0 || (issue.approvals == 1 && issueApprovals[_issueId][msg.sender]),
            "Other signers have approved"
        );
        issue.active = false;
        emit IssueDismissed(msg.sender, _issueId);
    }

    function cancelIssue(string _issueId) external onlyWallet {
        Issue storage issue = issues[_issueId];
        _requireLiveIssue(issue);
        require(issue.executableAt > 0, "Issue is not queued");
        issue.active = false;
        emit IssueCancelled(_issueId);
    }

    function executeIssue(string _issueId, address _target, string _functionName, string[] _argumentTypes, variadic _arguments) external onlySigner notExecuting returns (variadic) {
        Issue storage issue = issues[_issueId];
        address executor = msg.sender;
        _requirePayload(issue, _target, _functionName, _argumentTypes, _arguments);
        require(issue.executableAt > 0, "Issue is not queued");
        require(block.timestamp >= issue.executableAt, "Timelock has not elapsed");
        require(block.timestamp <= issue.expiresAt, "Issue has expired");
        return _executeIssue(_issueId, issue, _target, _functionName, executor, _arguments);
    }

    function executeIssueNoArgs(string _issueId, address _target, string _functionName) external onlySigner notExecuting returns (variadic) {
        Issue storage issue = issues[_issueId];
        _requireNoArgsPayload(issue, _target, _functionName);
        require(issue.executableAt > 0, "Issue is not queued");
        require(block.timestamp >= issue.executableAt, "Timelock has not elapsed");
        require(block.timestamp <= issue.expiresAt, "Issue has expired");
        issue.active = false;
        multisigExecuting = true;
        variadic result = _target.call(_functionName);
        multisigExecuting = false;
        emit IssueExecutedNoArgs(msg.sender, _issueId, _target, _functionName);
        return result;
    }

    function nominateConfiguration(address _nominee, address[] _resultingSigners, uint _requiredApprovals) external onlyWallet {
        require(_nominee != address(0), "Invalid nominee");
        require(signerMap[_nominee] == 0, "Nominee is already a signer");
        _validateConfiguration(_resultingSigners, _requiredApprovals);

        bool containsNominee = false;
        uint newAccounts = 0;
        for (uint i = 0; i < _resultingSigners.length; i++) {
            if (_resultingSigners[i] == _nominee) containsNominee = true;
            if (signerMap[_resultingSigners[i]] == 0) newAccounts++;
        }
        require(containsNominee && newAccounts == 1, "Configuration must add only the nominee");

        _clearNominations();
        Nomination storage nomination = nominations[_nominee];
        nomination.requiredApprovals = _requiredApprovals;
        nomination.epoch = multisigEpoch;
        nomination.expiresAt = block.timestamp + NOMINATION_LIFETIME;
        nomination.exists = true;
        for (uint j = 0; j < _resultingSigners.length; j++) {
            nominationSigners[_nominee].push(_resultingSigners[j]);
        }
        openNominee = _nominee;
        emit ConfigurationNominated(_nominee, multisigEpoch, nomination.expiresAt, _resultingSigners, _requiredApprovals);
    }

    function acceptNomination() external notExecuting {
        Nomination storage nomination = nominations[msg.sender];
        require(nomination.exists, "No nomination");
        require(nomination.epoch == multisigEpoch, "Nomination is stale");
        require(block.timestamp <= nomination.expiresAt, "Nomination has expired");
        _applyConfiguration(nominationSigners[msg.sender], nomination.requiredApprovals);
    }

    function revokeNomination(address _nominee) external onlyWallet {
        require(nominations[_nominee].exists, "No nomination");
        _deleteNomination(_nominee);
        emit NominationRevoked(_nominee);
    }

    function applyConfiguration(address[] _resultingSigners, uint _requiredApprovals) external onlyWallet {
        for (uint i = 0; i < _resultingSigners.length; i++) {
            require(signerMap[_resultingSigners[i]] > 0, "New signer requires nomination");
        }
        _applyConfiguration(_resultingSigners, _requiredApprovals);
    }

    function setTransactionTimelock(uint _delay) external onlyWallet {
        require(_delay <= MAX_TRANSACTION_TIMELOCK, "Timelock exceeds maximum");
        transactionTimelock = _delay;
        address(this).call("advanceConfiguration");
        _clearNominations();
        emit TransactionTimelockChanged(_delay, multisigEpoch);
    }

    function _approveIssue(string _issueId, address _target, string _functionName, string[] _argumentTypes, address _approver, variadic _arguments) internal returns (bool) {
        Issue storage issue = issues[_issueId];
        _requirePayload(issue, _target, _functionName, _argumentTypes, _arguments);
        require(issue.executableAt == 0, "Issue is already queued");
        require(!issueApprovals[_issueId][_approver], "Signer already approved");

        issueApprovals[_issueId][_approver] = true;
        issue.approvals++;
        emit IssueApproved(_approver, _issueId, issue.approvals);

        if (issue.approvals >= requiredApprovals) {
            if (_target == address(this) && (_functionName == "cancelUpgrade" || _functionName == "cancelIssue")) {
                _executeIssue(_issueId, issue, _target, _functionName, _approver, _arguments);
                return true;
            }
            issue.executableAt = block.timestamp + transactionTimelock;
            issue.expiresAt = issue.executableAt + ISSUE_EXECUTION_WINDOW;
            emit IssueQueued(_issueId, issue.executableAt, issue.expiresAt);
            if (transactionTimelock == 0) {
                _executeIssue(_issueId, issue, _target, _functionName, _approver, _arguments);
                return true;
            }
        }
        return false;
    }

    function _approveIssueNoArgs(string _issueId, address _target, string _functionName) internal returns (bool) {
        Issue storage issue = issues[_issueId];
        _requireNoArgsPayload(issue, _target, _functionName);
        require(issue.executableAt == 0, "Issue is already queued");
        require(!issueApprovals[_issueId][msg.sender], "Signer already approved");
        issueApprovals[_issueId][msg.sender] = true;
        issue.approvals++;
        emit IssueApproved(msg.sender, _issueId, issue.approvals);

        if (issue.approvals >= requiredApprovals) {
            if (_target == address(this) && _functionName == "cancelUpgrade") {
                issue.active = false;
                multisigExecuting = true;
                variadic cancelResult = _target.call(_functionName);
                multisigExecuting = false;
                emit IssueExecutedNoArgs(msg.sender, _issueId, _target, _functionName);
                return true;
            }
            issue.executableAt = block.timestamp + transactionTimelock;
            issue.expiresAt = issue.executableAt + ISSUE_EXECUTION_WINDOW;
            emit IssueQueued(_issueId, issue.executableAt, issue.expiresAt);
            if (transactionTimelock == 0) {
                issue.active = false;
                multisigExecuting = true;
                variadic result = _target.call(_functionName);
                multisigExecuting = false;
                emit IssueExecutedNoArgs(msg.sender, _issueId, _target, _functionName);
                return true;
            }
        }
        return false;
    }

    function _executeIssue(string _issueId, Issue storage _issue, address _target, string _functionName, address _executor, variadic _arguments) internal returns (variadic) {
        _issue.active = false;
        multisigExecuting = true;
        variadic result = _target.call(_functionName, _arguments);
        multisigExecuting = false;
        emit IssueExecuted(_executor, _issueId, _target, _functionName, _arguments);
        return result;
    }

    function _requireLiveIssue(Issue storage _issue) internal {
        require(_issue.active, "Issue is not active");
        require(_issue.epoch == multisigEpoch, "Issue is stale");
        require(block.timestamp <= _issue.expiresAt, "Issue has expired");
    }

    function _requirePayload(Issue storage _issue, address _target, string _functionName, string[] _argumentTypes, variadic _arguments) internal {
        _requireLiveIssue(_issue);
        require(_issue.target == _target, "Target does not match");
        require(_issue.functionName == _functionName, "Function does not match");
        require(_issue.argumentTypesHash == keccak256(_argumentTypes), "Argument types do not match");
        require(_issue.argumentsHash == _canonicalArgumentsHash(_argumentTypes, _arguments), "Arguments do not match");
    }

    function _requireNoArgsPayload(Issue storage _issue, address _target, string _functionName) internal {
        _requireLiveIssue(_issue);
        require(_issue.target == _target, "Target does not match");
        require(_issue.functionName == _functionName, "Function does not match");
        require(_issue.argumentTypesHash == keccak256("NO_ARGUMENTS"), "Issue has arguments");
        require(_issue.argumentsHash == keccak256("NO_ARGUMENTS"), "Issue has arguments");
    }

    function _requireExactArgumentCount(uint _count, variadic _arguments) internal {
        // Entry points capture the signer before this wallet self-call because the
        // delegated SolidVM frame observes the wallet as msg.sender after it returns.
        bool hasExtraArgument = false;
        try address(this).call("argumentAt", _count, _arguments) {
            hasExtraArgument = true;
        } catch {}
        require(!hasExtraArgument, "Argument count does not match types");
    }

    function _canonicalArgumentsHash(string[] _argumentTypes, variadic _arguments) internal returns (string) {
        _requireExactArgumentCount(_argumentTypes.length, _arguments);
        string result = keccak256(_argumentTypes, _arguments);
        for (uint i = 0; i < _argumentTypes.length; i++) {
            bytes typeName = bytes(_argumentTypes[i]);
            require(typeName.length > 0, "Argument type is required");
            bool isArray = typeName[typeName.length - 1] == bytes("]")[0];
            if (isArray) {
                result = keccak256(result, _argumentTypes[i]);
                if (_argumentTypes[i] == "address[]" || _argumentTypes[i] == "account[]") {
                    address[] addressValues = _arguments[i];
                    for (uint addressIndex = 0; addressIndex < addressValues.length; addressIndex++) {
                        result = keccak256(result, address(addressValues[addressIndex]));
                    }
                } else if (_argumentTypes[i] == "uint[]" || _argumentTypes[i] == "uint256[]") {
                    uint[] uintValues = _arguments[i];
                    for (uint uintIndex = 0; uintIndex < uintValues.length; uintIndex++) {
                        result = keccak256(result, uintValues[uintIndex]);
                    }
                } else if (_argumentTypes[i] == "int[]" || _argumentTypes[i] == "int256[]") {
                    int[] intValues = _arguments[i];
                    for (uint intIndex = 0; intIndex < intValues.length; intIndex++) {
                        result = keccak256(result, intValues[intIndex]);
                    }
                } else if (_argumentTypes[i] == "bool[]") {
                    bool[] boolValues = _arguments[i];
                    for (uint boolIndex = 0; boolIndex < boolValues.length; boolIndex++) {
                        result = keccak256(result, boolValues[boolIndex]);
                    }
                } else if (_argumentTypes[i] == "string[]") {
                    string[] stringValues = _arguments[i];
                    for (uint stringIndex = 0; stringIndex < stringValues.length; stringIndex++) {
                        result = keccak256(result, stringValues[stringIndex]);
                    }
                } else if (_argumentTypes[i] == "bytes[]") {
                    bytes[] bytesValues = _arguments[i];
                    for (uint bytesIndex = 0; bytesIndex < bytesValues.length; bytesIndex++) {
                        result = keccak256(result, bytesValues[bytesIndex]);
                    }
                } else {
                    revert("Unsupported array argument type");
                }
            } else if (_argumentTypes[i] == "bool") {
                result = keccak256(result, bool(_arguments[i]));
            } else if (_argumentTypes[i] == "string") {
                result = keccak256(result, string(_arguments[i]));
            } else if (typeName[0] == bytes("u")[0]) {
                result = keccak256(result, uint(_arguments[i]));
            } else if (typeName[0] == bytes("i")[0]) {
                result = keccak256(result, int(_arguments[i]));
            } else if (typeName[0] == bytes("b")[0]) {
                result = keccak256(result, bytes(_arguments[i]));
            } else {
                // address, account and contract-typed arguments all commit to the
                // concrete address rather than SolidVM's non-injective contract hash.
                result = keccak256(result, address(_arguments[i]));
            }
        }
        return result;
    }

    function _applyConfiguration(address[] _resultingSigners, uint _requiredApprovals) internal {
        _validateConfiguration(_resultingSigners, _requiredApprovals);
        for (uint i = 0; i < signers.length; i++) {
            signerMap[signers[i]] = 0;
            signers[i] = address(0);
        }
        signers.length = 0;
        for (uint j = 0; j < _resultingSigners.length; j++) {
            signers.push(_resultingSigners[j]);
            signerMap[_resultingSigners[j]] = signers.length;
        }
        requiredApprovals = _requiredApprovals;
        address(this).call("advanceConfiguration");
        _clearNominations();
        emit ConfigurationChanged(multisigEpoch, _resultingSigners, _requiredApprovals);
    }

    function _validateConfiguration(address[] _signers, uint _requiredApprovals) internal {
        require(_signers.length >= MIN_SIGNERS, "At least three signers are required");
        require(_requiredApprovals >= 2 && _requiredApprovals < _signers.length, "Required approvals must satisfy 2 <= M < N");
        for (uint i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "Invalid signer");
            require(_signers[i] != address(this), "Wallet cannot sign for itself");
            for (uint j = i + 1; j < _signers.length; j++) {
                require(_signers[i] != _signers[j], "Duplicate signer");
            }
        }
    }

    function _clearNominations() internal {
        if (openNominee != address(0)) {
            _deleteNomination(openNominee);
        }
    }

    function _deleteNomination(address _nominee) internal {
        for (uint i = 0; i < nominationSigners[_nominee].length; i++) {
            nominationSigners[_nominee][i] = address(0);
        }
        nominationSigners[_nominee].length = 0;
        nominations[_nominee].requiredApprovals = 0;
        nominations[_nominee].epoch = 0;
        nominations[_nominee].expiresAt = 0;
        nominations[_nominee].exists = false;
        if (openNominee == _nominee) openNominee = address(0);
    }
}
