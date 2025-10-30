import "../contracts/abstract/ERC20/access/Authorizable.sol";
import "../contracts/abstract/ERC20/access/Ownable.sol";
import "../contracts/concrete/Proxy/Proxy.sol";

/*
Why do we make UserRegistry and User inherit from Proxy, rather than use the normal Proxy pattern?
Rationale: We want the UserRegistry and User contracts to adhere to certain requirements, and we want
to make it impossible to override these requirements.
Requirements:
1. Every username must map to one and only one User contract address
2. User contracts must be able to operate as reverse proxies for end users
*/

contract record UserRegistry is Proxy {
    constructor(address _logicContract, address _initialOwner) Proxy(_logicContract, _initialOwner) { 
    }
        
    function createUser(string _username) public returns (address) {
        return createUserFor(_username, _msgSender());
    }
        
    function createUserFor(string _username, address _initialOwner) public returns (address) {
        address sender = _msgSender();
        require(canCreateUser(_username, _initialOwner),
            "User creation failed: " +
            string(sender) +
            " cannot create user " +
            _username +
            " for " +
            string(_initialOwner));
        // We need the constructor arguments to be static so that
        // the CREATE2 address only depends on the _username salt,
        // allowing anyone to derive the address for a given username
        User newUser = new User{salt: _username}(_username);
        initializeUser(_username, _initialOwner, address(newUser));
        return address(newUser);
    }
        
    function deriveUserAddress(string _username) public returns (address) {
        return this.derive(_username, "User", _username);
    }

    function canCreateUser(string _username, address _initialOwner) public returns (bool) {
        if (logicContract != address(0)) {
            return logicContract.delegatecall("canCreateUser", _username, _initialOwner);
        } else {
            return true; // By default we let anyone create a User
        }
    }

    function initializeUser(string _username, address _initialOwner, address _newUser) internal {
        if (logicContract != address(0)) {
            logicContract.delegatecall("initializeUser", _username, _initialOwner, _newUser);
        } else {
            User(_newUser).transferOwnership(_initialOwner);
        }
    }
}

contract record User is Proxy, Authorizable {
    string public username;
    
    address[] public record userAddresses;
    mapping (address => uint) private userAddressMap; 

    constructor(string _username) Proxy(address(0), msg.sender) {
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