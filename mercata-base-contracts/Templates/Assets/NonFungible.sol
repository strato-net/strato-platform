abstract contract NonFungible is Asset{
    string private assetID;
    string private name;
    string private symbol;

    // Owner of each token
    mapping(uint256 => address) private owners;

    // Number of tokens owned by each address
    mapping(address => uint256) private balances;


    // Total supply of tokens
    uint256 private totalSupply;

    // Token ID incrementer
    uint256 private tokenIdCounter;

    // Event emitted when a token is transferred
    event Transfer(address indexed from, address indexed to, uint256 tokenId);

    // Event emitted when an approval is set or removed
    event Approval(address indexed owner, address indexed spender, uint256 tokenId, bool approved);

    constructor(string memory _assetID, string memory _name, string memory _symbol, uint256 _totalSupply) SellableAsset(){
        assetID = _assetID;
        name = _name;
        symbol = _symbol;
        totalSupply = _totalSupply;
    }

    // Function to get the token asset ID
    function getAssetID() public view returns (string memory) {
        return assetID;
    }

    // Function to get the token name
    function getName() public view returns (string memory) {
        return name;
    }

    // Function to get the token symbol
    function getSymbol() public view returns (string memory) {
        return symbol;
    }

    // Function to get the total supply of tokens
    function getTotalSupply() public view returns (uint256) {
        return totalSupply;
    }

    // Function to get the balance of tokens for a given address
    function getBalanceOf(address owner) public view returns (uint256) {
        return balances[owner];
    }

    // Function to get the owner of a specific token
    function getOwnerOf(uint256 tokenId) public view returns (address) {
        return owners[tokenId];
    }

    // Function to transfer a token from one address to another
    function transferFrom(address from, address to, uint256 tokenId) public {
        require(isOwner(msg.sender, tokenId), "Not authorized");
        require(from == getOwnerOf(tokenId), "Not the owner");
        require(to != address(0), "Cannot transfer to zero address");

        transfer(from, to, tokenId);
    }

    // Function to mint a new token and assign it to an address
    function mint(address to) public {
        require(to != address(0), "Cannot mint to zero address");
        uint256 tokenId = tokenIdCounter++;
        owners[tokenId] = to;
        balances[to]++;
        totalSupply++;
        emit Transfer(address(0), to, tokenId);
    }

    // Internal function to perform the actual transfer of a token
    function transfer(address from, address to, uint256 tokenId) internal {
        require(to != address(0), "Cannot transfer to zero address");
        require(to != address(this), "Cannot transfer to the contract itself");
        require(from == getOwnerOf(tokenId), "Not the owner");

        owners[tokenId] = to;
        balances[from]--;
        balances[to]++;
        emit Transfer(from, to, tokenId);
    }

    // Internal function to check if an address is approved or the owner of a token
    function isOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = getOwnerOf(tokenId);
        return (spender == owner);
    }
}