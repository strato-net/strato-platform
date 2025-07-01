import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title AdminRegistry
 * @notice Centralized registry of trusted admin accounts used for access control across system contracts.
 */
contract AdminRegistry is Ownable {
    mapping(address => bool) public isAdmin;
    
    event AdminAdded(address admin);
    event AdminRemoved(address admin);
    
    /**
     * @notice Initializes the registry and sets the initial owner and admin.
     * @param _owner The address to be set as the contract owner and initial admin.
     */
    constructor(address _owner) {
        require(_owner != address(0), "AdminRegistry: owner is zero address");
        _transferOwnership(_owner);
        isAdmin[_owner] = true;
        emit AdminAdded(_owner);
    }
    
    /**
     * @notice Adds an admin account. Only callable by the contract owner.
     * @param admin The address to grant admin access to.
     */
    function addAdmin(address admin) external onlyOwner {
        require(admin != address(0), "AdminRegistry: cannot add zero address");
        require(!isAdmin[admin], "AdminRegistry: already admin");
        isAdmin[admin] = true;
        emit AdminAdded(admin);
    }
    
    /**
     * @notice Removes an admin account. Only callable by the contract owner.
     * @param admin The address to remove from the admin list.
     */
    function removeAdmin(address admin) external onlyOwner {
        require(isAdmin[admin], "AdminRegistry: not an admin");
        isAdmin[admin] = false;
        emit AdminRemoved(admin);
    }

    /**
     * @notice Checks if an address is an admin.
     * @param admin The address to check.
     * @return True if the address is an admin, false otherwise.
     */
    function isAdminAddress(address admin) external view returns (bool) {
        return isAdmin[admin];
    }
}