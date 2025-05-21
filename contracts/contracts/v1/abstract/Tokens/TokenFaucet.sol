import "../ERC20/ERC20.sol";

struct TokenFaucetInfo {
    string tokenName;
    address tokenAddress;
    uint tokenAmount;
}

contract record TokenFaucet {
    address public owner;
    bool public isActive;
    address[] public callers;

    mapping (string => TokenFaucetInfo) public record tokens;
    string[] public tokenNames;

    constructor(TokenFaucetInfo[] _tokens) {
        owner = msg.sender;
        _setTokens(_tokens);
        isActive = true;
    }

    modifier onlyOwner(string func) {
        require(msg.sender == owner, "Only the owner can call " + func);
        _;
    }

    function updateTokens(TokenFaucetInfo[] _tokens) external onlyOwner("updateTokens") {
        _setTokens(_tokens);
    }

    function setActivationStatus(bool _isActive) external onlyOwner("setActivationStatus") {
        isActive = _isActive;
    }

    function transferOwnership(address _newOwner) external onlyOwner("transferOwnership") {
        owner = _newOwner;
    }

    function faucet() public {
        callers.push(msg.sender);
        for (uint i = 0; i < tokenNames.length; i++) {
            string _tokenName = tokenNames[i];
            ERC20 token = ERC20(address(tokens[_tokenName].tokenAddress));
            uint amount = tokens[_tokenName].tokenAmount;
            try {
                token.transfer(msg.sender, amount * 1e18);
            } catch {
                // https://www.youtube.com/watch?v=NGWWkEJzWeI
            }
        }
    }

    function _setTokens(TokenFaucetInfo[] _tokens) internal {
        for (uint i = 0; i < tokenNames.length; i++) {
            string _tokenName = tokenNames[i];
            tokens[_tokenName] = TokenFaucetInfo("", address(0), 0);
            tokenNames[i] = "";
        }
        tokenNames.length = 0;
        
        for (uint j = 0; j < _tokens.length; j++) {
            string _tokenName = _tokens[j].tokenName;
            tokens[_tokenName].tokenName = string(_tokens[j].tokenName);
            tokens[_tokenName].tokenAddress = address(_tokens[j].tokenAddress);
            tokens[_tokenName].tokenAmount = uint(_tokens[j].tokenAmount);
            tokenNames.push(_tokenName);
        }
    }
}