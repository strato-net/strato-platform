import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

interface IPool {
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function lpToken() external view returns (address);
    function addLiquidity(uint256 tokenBAmount, uint256 maxTokenAAmount, uint256 deadline) external returns (uint256);
}

// Seeds liquidity for the auction at TGE and forwards LP tokens to the lock vault.
// Summary:
// - Validates pool tokens against USDST/STRATO.
// - Approves pool to pull both assets.
// - Adds liquidity and transfers LP tokens to recipient vault.
contract record PoolLpSeeder is Ownable {
    address public pool;
    address public usdToken;
    address public stratoToken;
    address public auction;
    bool public initialized;

    // Owner is assigned on deployment (proxy-safe).
    constructor(address initialOwner) Ownable(initialOwner) { }

    // One-time configuration of pool + tokens; called by owner before auction.
    // Auction address is allowed to call `seedAndLock`.
    function initialize(address pool_, address usdToken_, address stratoToken_, address auction_) external onlyOwner {
        require(!initialized, "Already initialized");
        require(pool_ != address(0), "Invalid pool");
        require(usdToken_ != address(0), "Invalid USDST");
        require(stratoToken_ != address(0), "Invalid STRATO");
        require(auction_ != address(0), "Invalid auction");

        pool = pool_;
        usdToken = usdToken_;
        stratoToken = stratoToken_;
        auction = auction_;
        initialized = true;
    }

    // Called by the auction to add liquidity and forward LP tokens to the lock vault.
    function seedAndLock(uint usdAmount, uint stratoAmount, uint price, address lpTokenRecipient) external returns (address lpToken, uint lpTokensMinted) {
        require(initialized, "Not initialized");
        require(msg.sender == auction, "Not auction");
        require(usdAmount > 0 && stratoAmount > 0, "Invalid amounts");
        require(price > 0, "Invalid price");
        require(lpTokenRecipient != address(0), "Invalid recipient");

        IPool poolRef = IPool(pool);
        address tokenA = poolRef.tokenA();
        address tokenB = poolRef.tokenB();
        lpToken = poolRef.lpToken();

        require(
            (tokenA == usdToken && tokenB == stratoToken) || (tokenA == stratoToken && tokenB == usdToken),
            "Pool tokens mismatch"
        );

        uint tokenBAmount;
        uint maxTokenAAmount;
        // Ensure amounts align with pool token ordering.
        if (tokenB == usdToken) {
            tokenBAmount = usdAmount;
            maxTokenAAmount = stratoAmount;
        } else {
            tokenBAmount = stratoAmount;
            maxTokenAAmount = usdAmount;
        }

        IERC20(usdToken).approve(pool, usdAmount);
        IERC20(stratoToken).approve(pool, stratoAmount);

        lpTokensMinted = poolRef.addLiquidity(tokenBAmount, maxTokenAAmount, uint(block.timestamp));
        require(lpTokensMinted > 0, "LP mint failed");
        require(IERC20(lpToken).transfer(lpTokenRecipient, lpTokensMinted), "LP transfer failed");
        return (lpToken, lpTokensMinted);
    }
}
