import "../contracts/abstract/ERC20/access/Authorizable.sol";
import "../contracts/abstract/ERC20/access/Ownable.sol";
import "../contracts/abstract/ERC20/utils/StringUtils.sol";
import "../contracts/concrete/Proxy/Proxy.sol";

/*
Why do we make UserRegistry and User inherit from Proxy, rather than use the normal Proxy pattern?
Rationale: We want the UserRegistry and User contracts to adhere to certain requirements, and we want
to make it impossible to override these requirements.
Requirements:
1. Every username must map to one and only one User contract address
2. User contracts must be able to operate as reverse proxies for end users
*/

struct UserOperation {
    uint nonce;
    address to;       // 0 = create, 1 = create2, >1 = call
    bool failable;
    variadic callData; // create: [cName, src, ...args]; create2: [salt, cName, src, ...args]; call: [fName, ...args]
}

struct UserBatchOperation {
    string username;
    UserOperation[] operations;
    bytes signature; // serialized for [r: bytes32, s: bytes32, (pubkey: bytes | v: uint8), bytes extraData]
}

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

    function executeUserBatchOperations(UserBatchOperation[] _batchOps) public {
        for (uint i = 0; i < _batchOps.length; i++) {
            address userAddr = deriveUserAddress(_batchOps[i].username);
            try {
                User(userAddr).executeUserBatchOperation(
                    _batchOps[i].operations,
                    _batchOps[i].signature
                );
            } catch {
            }
        }
    }
}

contract record User is Proxy, Authorizable {
    using BytesUtils for bytes;

    string public username;

    address[] public record userAddresses;
    mapping (address => uint) private userAddressMap;
    uint public nonce;

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

    function executeUserBatchOperation(UserOperation[] _operations, bytes _signature) public {
        // Parse signature components
        uint8 curveType = uint8(_signature[0]);
        bytes32 r = bytes32(_signature.substring(1, 33));
        bytes32 s = bytes32(_signature.substring(33, 65));
        bytes extraData = _signature.substring(65, _signature.length);
        address signer;

        if (curveType == 0) { // secp256k1
            uint8 v = uint8(extraData[0]);
            uint8 protocol = uint8(extraData[1]);
            bytes32 h;
            if (protocol == 0) { // keccak256, SolidVM encoding
                h = keccak256(_operations);
            } else if (protocol == 1) { // keccak256, eth_personalSign
                h = keccak256(bytes(0x19) + bytes("Ethereum Signed Message:\n") + bytes(_operations));
            }
            signer = ecrecover(h, v, r, s);
        } else if (curveType == 1) { // secp256r1 (passkey)
            bytes pub = extraData.substring(0, 65);
            uint8 protocol = uint8(extraData[65]);
            bytes rest = extraData.substring(66, extraData.length);
            if (protocol == 0) { // sha256, WebAuthn passkey
                signer = address(bytes(keccak256(pub)).substring(0, 20));
                uint16 authDataLen = uint16(bytes32(rest.substring(0, 2)));
                uint authDataEnd = uint(authDataLen) + 2;
                bytes authenticationData = rest.substring(2, authDataEnd);
                uint16 clientDataJSONPreLen = uint16(bytes32(rest.substring(authDataEnd, authDataEnd + 2)));
                uint clientDataJSONPreEnd = authDataEnd + uint(clientDataJSONPreLen) + 2;
                bytes clientDataJSONPre = rest.substring(authDataEnd + 2, clientDataJSONPreEnd);
                uint16 clientDataJSONPostLen = uint16(bytes32(rest.substring(clientDataJSONPreEnd, clientDataJSONPreEnd + 2)));
                uint clientDataJSONPostEnd = clientDataJSONPreEnd + uint(clientDataJSONPostLen) + 2;
                bytes clientDataJSONPost = rest.substring(clientDataJSONPreEnd + 2, clientDataJSONPostEnd);
                bytes challenge = bytes(base64urlencode(bytes(_operations)));
                bytes clientDataJSON = clientDataJSONPre + challenge + clientDataJSONPost;
                bytes32 clientDataHash = sha256(clientDataJSON);
                bytes32 h = sha256(authenticationData + bytes(clientDataHash));
                bool verified = verifyP256(h, r, s, pub);
                require(verified, "Invalid passkey signature");
            }
        }

        require(userAddressMap[signer] > 0 || owner() == signer, "unauthorized signer");

        for (uint i = 0; i < _operations.length; i++) {
            _executeUserOperation(_operations[i]);
        }
    }

    function executeUserOperation(UserOperation _op) external returns (variadic) {
        address sender = _msgSender();
        require(userAddressMap[sender] > 0 || owner() == sender, "unauthorized signer");
        return _executeUserOperation(_op);
    }

    function _executeUserOperation(UserOperation _op) internal returns (variadic) {
        if (_op.failable) {
            try {
                return _unsafeExecuteUserOperation(_op);
            } catch {
                return false;
            }
        } else {
            return _unsafeExecuteUserOperation(_op);
        }
    }

    function _unsafeExecuteUserOperation(UserOperation _op) internal returns (variadic) {
        require(nonce == _op.nonce, "Incorrect UserOperation nonce");
        nonce++;
        if (_op.to == address(0)) { // create
            return create(_op.callData);
        } else if (_op.to == address(1)) { // create2
            return create2(_op.callData);
        } else { // call
            return _op.to.call(_op.callData);
        }
    }
}
