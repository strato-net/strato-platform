import "./BaseCodeCollection.sol";

contract record BatchAdmin_AAVE_aTokens_1 {
    MercataBridge mercataBridge = MercataBridge(address(0x1008));
    AdminRegistry adminRegistry = AdminRegistry(address(0x100c));


    Token aWETH   = Token(address(0x6d40952f0895d21d2bf20cd088f0eb9a1574583f));
    Token aweETH  = Token(address(0x6f247ad55cb444e3e8db0fe225aea2cf1ed62fe1));
    Token awstETH = Token(address(0x2c33aa5f8bbfe3c15e356a5e87464310db12376e));
    Token aWBTC   = Token(address(0x5f46258f73c405a58331c1a19e54add394637b06));
    Token aUSDC   = Token(address(0x465c7e3061bc239df88c37d315be52f5487959ec));
    Token aUSDT   = Token(address(0x7d2a2b963e1fa273b60f9b7891392903de5e66b8));

    // Ethereum address for the actual aToken  
    address reference_aWETH   = address(0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8);
    address reference_aweETH  = address(0xbdfa7b7893081b35fb54027489e2bc7a38275129);
    address reference_awstETH = address(0x0b925ed163218f6662a35e0f0371ac234f9e9371);
    address reference_aWBTC   = address(0x5ee5bf7ae06d1be5997a1a72006fe6c607ec6de8);
    address reference_aUSDC   = address(0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c);
    address reference_aUSDT   = address(0x23878914efe38d27c4d67ab83ed1b93a74d4086a);

    // Sepolia address for our mock aTokens (TODO)
    address extern_aWETH   = address(0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8);
    address extern_aweETH  = address(0xbdfa7b7893081b35fb54027489e2bc7a38275129);
    address extern_awstETH = address(0x0b925ed163218f6662a35e0f0371ac234f9e9371);
    address extern_aWBTC   = address(0x5ee5bf7ae06d1be5997a1a72006fe6c607ec6de8);
    address extern_aUSDC   = address(0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c);
    address extern_aUSDT   = address(0x23878914efe38d27c4d67ab83ed1b93a74d4086a);

    constructor() {}

    function entrypoint() public {

        // Whitelist the bridge to mint and burn the aTokens
        adminRegistry.addWhitelist(address(aWETH),   "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(aWETH),   "burn", address(mercataBridge));
        adminRegistry.addWhitelist(address(aweETH),  "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(aweETH),  "burn", address(mercataBridge));
        adminRegistry.addWhitelist(address(awstETH), "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(awstETH), "burn", address(mercataBridge));
        adminRegistry.addWhitelist(address(aWBTC),   "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(aWBTC),   "burn", address(mercataBridge));
        adminRegistry.addWhitelist(address(aUSDC),   "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(aUSDC),   "burn", address(mercataBridge));
        adminRegistry.addWhitelist(address(aUSDT),   "mint", address(mercataBridge));
        adminRegistry.addWhitelist(address(aUSDT),   "burn", address(mercataBridge));

        // Configure the assets in the STRATO-side MercataBridge
        mercataBridge.setAsset(
            true,
            11155111,
            18,
            "Aave Ethereum WETH",
            "aEthWETH",
            extern_aWETH,
            0,
            address(aWETH)
        );
        mercataBridge.setAsset(
            true,
            11155111,
            18,
            "Aave Ethereum weETH",
            "aEthweETH",
            extern_aweETH,
            0,
            address(aweETH)
        );
        mercataBridge.setAsset(
            true,
            11155111,
            18,
            "Aave Ethereum wstETH",
            "aEthwstETH",
            extern_awstETH,
            0,
            address(awstETH)
        );
        mercataBridge.setAsset(
            true,
            11155111,
            8,
            "Aave Ethereum WBTC",
            "aEthWBTC",
            extern_aWBTC,
            0,
            address(aWBTC)
        );
        mercataBridge.setAsset(
            true,
            11155111,
            6,
            "Aave Ethereum USDC",
            "aEthUSDC",
            extern_aUSDC,
            0,
            address(aUSDC)
        );
        mercataBridge.setAsset(
            true,
            11155111,
            6,
            "Aave Ethereum USDT",
            "aEthUSDT",
            extern_aUSDT,
            0,
            address(aUSDT)
        );

        runTests();
    }

    function runTests() internal {
        require(awstETH.status() == TokenStatus.ACTIVE, "awstETH status is not ACTIVE");
        require(aweETH.status()  == TokenStatus.ACTIVE, "aweETH status is not ACTIVE");
        require(aWBTC.status()   == TokenStatus.ACTIVE, "aWBTC status is not ACTIVE");
        require(aWETH.status()   == TokenStatus.ACTIVE, "aWETH status is not ACTIVE");
        require(aUSDC.status()   == TokenStatus.ACTIVE, "aUSDC status is not ACTIVE");
        require(aUSDT.status()   == TokenStatus.ACTIVE, "aUSDT status is not ACTIVE");
    }

    function dryRun() external {
        entrypoint();
        require(false, "test successful; reverting as this is a dry run");
    }
}
