

enum IssuerStatus {
    NULL,
    UNAUTHORIZED,
    PENDING_REVIEW,
    AUTHORIZED
}

contract record UserRegistry {
    constructor() { 
        // create the first issuer approver
        string _commonName = getUserCert(msg.sender)["commonName"];
        User newUser = new User{salt: _commonName}(_commonName);
        newUser.setIsAdmin(true);
    }
        
    function createUser(string _commonName) public returns (address) {
        User newUser = new User{salt: _commonName}(_commonName);
        return address(newUser);
    }

    modifier cameFromAdmin() { // note to self: update this logic once governance tokens are established
        string _commonName = getUserCert(msg.sender)["commonName"];
        User user = User(this.derive(_commonName, _commonName));
        bool isActiveAdmin;
        try {
            isActiveAdmin = user.isAdmin();
        } catch {
            isActiveAdmin = false;
        }
        require (isActiveAdmin, "Only an admin can call this function");
        _;
    }

    function setIsAdmin(string _commonName, bool b) cameFromAdmin {
        User user = User( this.derive(_commonName, _commonName) );
        user.setIsAdmin(b);
    }

    function authorizeIssuer(string _commonName) cameFromAdmin {
        User user = User( this.derive(_commonName, _commonName) );
        user.authorizeIssuer();
    }

    function deauthorizeIssuer(string _commonName) cameFromAdmin {
        User user = User( this.derive(_commonName, _commonName) );
        user.deauthorizeIssuer();
    }
}

contract record User {
    address private owner;
    string public userName;
    IssuerStatus public issuerStatus;
    bool public isAdmin;

    constructor(string _userName) {
        userName = _userName;
        issuerStatus = IssuerStatus.UNAUTHORIZED;
        owner = tx.origin;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    modifier authenticated() {
        // Only the user that this contract is associated with, can use this function.
        require(authenticate(), "You don't have permission to use this function! " + string(msg.sender) + " != " + string(owner));
        _;
    }

    function createContract(string contractName, string contractSrc, variadic args) public authenticated {
        create(contractName, contractSrc, args);
    }

    function createSaltedContract(string salt, string contractName, string contractSrc, variadic args) public authenticated {
        create2(salt, contractName, contractSrc, args);
    }

    function callContract(address contractToCall, string functionName, variadic args) public returns (variadic) authenticated {
        variadic result = address(contractToCall).call(functionName, args);
        return result;
    }

    // Checks if the caller is indeed the user the wallet belongs to.
    function authenticate() internal returns (bool) {
        return msg.sender == owner;
    }

    function requestReview() public authenticated {
        require(issuerStatus != IssuerStatus.AUTHORIZED, "You are already an authorized issuer");
        issuerStatus = IssuerStatus.PENDING_REVIEW;
    }
    
    function authorizeIssuer() public onlyOwner {
        issuerStatus = IssuerStatus.AUTHORIZED;
    }

    function deauthorizeIssuer() public onlyOwner {
        issuerStatus = IssuerStatus.UNAUTHORIZED;
    }

    function setIsAdmin(bool b) onlyOwner {
        isAdmin = b;
    }
}