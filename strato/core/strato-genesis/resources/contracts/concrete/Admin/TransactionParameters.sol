contract record TransactionParameters {
    // Current transaction size limit in bytes
    uint public record txSizeLimit;

    // Admin registry address for permission checks
    address public record adminRegistry;

    // Event emitted when transaction size limit changes
    event TransactionSizeLimitChanged(uint previousLimit, uint newLimit, uint blockNumber, uint timestamp);

    bool public initialized = false;

    modifier onlyOnce() {
        require(!initialized, "TransactionParameters is already initialized");
        initialized = true;
        _;
    }

    modifier onlyAdmin() {
        require(adminRegistry != address(0), "AdminRegistry not set");
        bool isAdmin = adminRegistry.call("isAdminAddress", msg.sender);
        require(isAdmin, "Only admins can call this function");
        _;
    }

    constructor() { }

    // Initialize the contract with default transaction size limit
    // This will be called during genesis block creation
    function initialize(uint _initialLimit, address _adminRegistry) external onlyOnce {
        require(_initialLimit > 0, "Transaction size limit must be greater than 0");
        require(_adminRegistry != address(0), "AdminRegistry address cannot be zero");
        
        txSizeLimit = _initialLimit;
        adminRegistry = _adminRegistry;
        
        // Emit initial event to establish baseline in event log
        emit TransactionSizeLimitChanged(0, _initialLimit, block.number, block.timestamp);
    }

    // Update the transaction size limit (admin only)
    function setTxSizeLimit(uint _newLimit) external onlyAdmin {
        require(_newLimit > 0, "Transaction size limit must be greater than 0");
        require(_newLimit != txSizeLimit, "New limit must be different from current limit");
        
        uint previousLimit = txSizeLimit;
        txSizeLimit = _newLimit;
        
        emit TransactionSizeLimitChanged(previousLimit, _newLimit, block.number, block.timestamp);
    }

    // Read-only function to get current limit
    function getTxSizeLimit() external returns (uint) {
        return txSizeLimit;
    }
}

