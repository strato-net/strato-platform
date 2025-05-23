// SPDX-License-Identifier: MIT
/**
 * @title TokenAccess
 * @notice Manages minter and burner roles.
 */
contract TokenAccess {
    address public admin;
    enum Role { NONE, MINTER, BURNER }
    mapping(address => bool) private record minters;
    mapping(address => bool) private record burners;

    event MinterAdded(address indexed accountAddress);
    event MinterRemoved(address indexed accountAddress);
    event BurnerAdded(address indexed accountAddress);
    event BurnerRemoved(address indexed accountAddress);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "TokenAccess: caller is not admin");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "TokenAccess: admin is zero address");
        admin = _admin;
        minters[_admin] = true;
        burners[_admin] = true;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "TokenAccess: new admin is zero address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function addMinter(address accountAddress) external onlyAdmin {
        require(!minters[accountAddress], "TokenAccess: already a minter");
        minters[accountAddress] = true;
        emit MinterAdded(accountAddress);
    }

    function removeMinter(address accountAddress) external onlyAdmin {
        require(minters[accountAddress], "TokenAccess: not a minter");
        minters[accountAddress] = false;
        emit MinterRemoved(accountAddress);
    }

    function isMinter(address accountAddress) external view returns (bool) {
        return minters[accountAddress];
    }

    function addBurner(address accountAddress) external onlyAdmin {
        require(!burners[accountAddress], "TokenAccess: already a burner");
        burners[accountAddress] = true;
        emit BurnerAdded(accountAddress);
    }

    function removeBurner(address accountAddress) external onlyAdmin {
        require(burners[accountAddress], "TokenAccess: not a burner");
        burners[accountAddress] = false;
        emit BurnerRemoved(accountAddress);
    }

    function isBurner(address accountAddress) external view returns (bool) {
        return burners[accountAddress];
    }

    function hasRole(uint8 role, address accountAddress) external view returns (bool) {
        if (Role(role) == Role.MINTER) {
            return minters[accountAddress];
        } else if (Role(role) == Role.BURNER) {
            return burners[accountAddress];
        }
        return false;
    }
}