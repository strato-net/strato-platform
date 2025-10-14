import "../Tokens/AdminRegistry.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record TransactionParameters is Ownable {
    // Current transaction size limit in bytes
    uint public record txSizeLimit;

    // Admin registry for permission checks
    AdminRegistry public record adminRegistry;

    // Event emitted when transaction size limit changes
    event TransactionSizeLimitChanged(uint previousLimit, uint newLimit, uint blockNumber, uint timestamp);

    bool public initialized = false;

    constructor(address _owner) Ownable(_owner) { }

    // Initialize the contract with default transaction size limit and admin registry
    function initialize(uint _initialLimit, address _adminRegistry) external onlyOwner {
        require(!initialized, "TransactionParameters is already initialized");
        require(_initialLimit > 0, "Transaction size limit must be greater than 0");
        require(_adminRegistry != address(0), "AdminRegistry address cannot be zero");
        
        txSizeLimit = _initialLimit;
        adminRegistry = AdminRegistry(_adminRegistry);
        initialized = true;
        
        // Emit initial event to establish baseline in event log
        emit TransactionSizeLimitChanged(0, _initialLimit, block.number, block.timestamp);
    }

    modifier onlyAdmin() {
        require(adminRegistry.isAdminAddress(msg.sender), "Only admins can call this function");
        _;
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

