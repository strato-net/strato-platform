import "../../concrete/Bridge/MercataBridge.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../../concrete/Lending/LendingRegistry.sol";
import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Metals/MetalForge.sol";


contract TestERC20 is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}

contract TestUSDST is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_MercataBridge is Authorizable {
    using BridgeTypes for *;
    using StringUtils for string;

    Mercata mercata;
    MercataBridge bridge;
    TokenFactory tokenFactory;
    AdminRegistry adminRegistry;
    LendingRegistry lendingRegistry;
    TestERC20 testToken;
    TestUSDST usdstToken;
    TestERC20 mUSDST;
    MetalForge metalForge;
    PriceOracle oracle;
    FeeCollector feeCollector;
    TestERC20 goldToken;
    User user1;
    User user2;
    User relayer;
    address owner;
    uint256 externalChainId;
    string externalTxHash;
    address externalSender;
    address externalRecipient;
    address custody;
    address depositRouter;
    string chainName;

    function beforeAll() {
        bypassAuthorizations = true;
        owner = address(this);
        user1 = new User();
        user2 = new User();
        relayer = new User();
        externalChainId = 1; // Ethereum mainnet
        externalTxHash = "0x1234567890abcdef";
        externalSender = address(0x1111);
        externalRecipient = address(0x2222);
        custody = address(0x3333);
        depositRouter = address(0x4444);
        chainName = "Ethereum";
    }

    function beforeEach() {
        mercata = new Mercata();
        adminRegistry = mercata.adminRegistry();
        lendingRegistry = mercata.lendingRegistry();
        tokenFactory = mercata.tokenFactory();
        bridge = mercata.mercataBridge();

        // Whitelist relayer for all functions
        adminRegistry.addWhitelist(address(bridge), "setLastProcessedBlock", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "deposit", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "depositBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "confirmDeposit", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "confirmDepositBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "reviewDeposit", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "reviewDepositBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "confirmWithdrawal", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "confirmWithdrawalBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "finaliseWithdrawal", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "finaliseWithdrawalBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "abortWithdrawal", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "abortWithdrawalBatch", address(relayer));
        adminRegistry.addWhitelist(address(bridge), "requestDepositAction", address(relayer));

        // Create test tokens through token factory with AdminRegistry as owner
        testToken = TestERC20(tokenFactory.createTokenWithInitialOwner("Test Token", "TEST", [], [], [], "TEST", 0, 18, address(adminRegistry)));
        usdstToken = TestUSDST(tokenFactory.createTokenWithInitialOwner("USDST", "USDST", [], [], [], "USDST", 0, 18, address(adminRegistry)));
        mUSDST = TestERC20(tokenFactory.createTokenWithInitialOwner("mUSDST", "mUSDST", [], [], [], "mUSDST", 0, 18, address(adminRegistry)));

        // Set tokens to ACTIVE status
        Token(address(testToken)).setStatus(2); // ACTIVE
        Token(address(usdstToken)).setStatus(2); // ACTIVE
        Token(address(mUSDST)).setStatus(2); // ACTIVE

        // AdminRegistry is already the owner of tokens, no need to transfer

        // Whitelist bridge for mint and burn functions
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(testToken), "mint", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(testToken), "burn", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(usdstToken), "mint", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(usdstToken), "burn", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(mUSDST), "mint", address(mercata.liquidityPool()));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(mUSDST), "burn", address(mercata.liquidityPool()));

        // Set up chain
        bridge.setChain(chainName, custody, true, externalChainId, 1000, depositRouter);

        // Set USDST address to our test token
        bridge.setUSDSTAddress(address(usdstToken));

        // Set up assets
        bridge.setAsset(
            true,
            externalChainId,
            18, // decimals
            "External Test Token",
            "ETEST",
            address(0x5555),
            1000000e18,
            address(testToken)
        );

        bridge.setAsset(
            true,
            externalChainId,
            18, // decimals
            "External USDST",
            "EUSDST",
            address(0x6666), // external USDST token address
            1000000e18, // max per tx
            address(usdstToken) // strato token
        );

        mercata.poolConfigurator().setBorrowableAsset(address(usdstToken));
        mercata.poolConfigurator().setMToken(address(mUSDST));

        // MetalForge setup for autoForge tests
        oracle = new PriceOracle(address(this));
        oracle.initialize();
        feeCollector = new FeeCollector(address(this));

        goldToken = TestERC20(tokenFactory.createTokenWithInitialOwner("Gold", "GOLDST", [], [], [], "GOLDST", 0, 18, address(adminRegistry)));
        Token(address(goldToken)).setStatus(2);

        metalForge = new MetalForge(address(this));
        metalForge.initialize(address(oracle), address(0xDEAD), address(feeCollector), address(usdstToken));

        oracle.setAssetPrice(address(goldToken), 2000e18);
        metalForge.setMetalConfig(address(goldToken), true, 1000000e18);
        metalForge.setPayTokenConfig(address(usdstToken), true, 0);

        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(goldToken), "mint", address(metalForge));

        bridge.setMetalForge(address(metalForge));
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_bridge_sets_initial_state() {
        require(address(bridge.tokenFactory()) == address(tokenFactory), "Token factory not set");
        require(!bridge.depositsPaused(), "Deposits should not be paused initially");
        require(!bridge.withdrawalsPaused(), "Withdrawals should not be paused initially");
        require(bridge.withdrawalCounter() == 0, "Withdrawal counter should start at 0");
    }

    function it_bridge_reverts_with_zero_addresses() {
        bool reverted = false;
        try {
            new MercataBridge(owner).initialize(address(0), address(lendingRegistry));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with zero token factory");

        reverted = false;
        try {
            new MercataBridge(owner).initialize(address(tokenFactory), address(0));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with zero lending registry");
    }

    // ============ CHAIN MANAGEMENT TESTS ============

    function it_bridge_can_set_chain() {
        uint256 chainId = 137; // Polygon
        address newCustody = address(0x6666);
        address newRouter = address(0x7777);
        uint256 lastBlock = 2000;
        string memory newChainName = "Polygon";

        bridge.setChain(newChainName, newCustody, true, chainId, lastBlock, newRouter);

        // Check chain was set correctly
        (string chainName, address custody, address depositRouter, bool enabled, uint lastProcessedBlock) = bridge.chains(chainId);
        require(custody == newCustody, "Custody not set correctly");
        require(depositRouter == newRouter, "Router not set correctly");
        require(lastProcessedBlock == lastBlock, "Last processed block not set correctly");
        require(enabled, "Chain should be enabled");
        require(keccak256(chainName) == keccak256(newChainName), "Chain name not set correctly");
    }

    function it_bridge_can_update_last_processed_block() {
        uint256 newBlock = 1500;
        relayer.do(address(bridge), "setLastProcessedBlock", externalChainId, newBlock);

        (,,,, uint lastProcessedBlock) = bridge.chains(externalChainId);
        uint256 setLastBlock = lastProcessedBlock;
        require(setLastBlock == newBlock, "Last processed block not updated");
    }

    function it_bridge_reverts_set_last_processed_block_by_non_relayer() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "setLastProcessedBlock", externalChainId, 1500);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when called by non-relayer");
    }

    // ============ ASSET MANAGEMENT TESTS ============

    function it_bridge_can_set_asset() {
        address newToken = address(0x8888);
        uint256 newChainId = 56; // BSC
        address externalToken = address(0x9999);
        uint256 decimals = 6;
        string memory name = "BSC Test Token";
        string memory symbol = "BTEST";
        uint256 maxPerWithdrawal = 500000e6;
        uint8 permissions = 1; // WRAP only

        // First set up the chain
        bridge.setChain("BSC", address(0x6666), true, newChainId, 2000, address(0x7777));

        bridge.setAsset(true, newChainId, decimals, name, symbol, externalToken, maxPerWithdrawal, newToken);

        (bool enabled, uint externalChainId, uint externalDecimals, string externalName, string externalSymbol, address _externalToken, uint _maxPerWithdrawal, address _stratoToken) = bridge.assets(externalToken, newChainId);
        require(_externalToken == externalToken, "External token not set correctly");
        require(externalDecimals == decimals, "Decimals not set correctly");
        require(externalChainId == newChainId, "Chain ID not set correctly");
        require(keccak256(externalName) == keccak256(name), "Name not set correctly");
        require(keccak256(externalSymbol) == keccak256(symbol), "Symbol not set correctly");
        require(_maxPerWithdrawal == maxPerWithdrawal, "Max per withdrawal not set correctly");
        require(_stratoToken == newToken, "Strato token not set correctly");
    }

    function it_bridge_can_update_asset_metadata() {
        string memory newName = "Updated Test Token";
        string memory newSymbol = "UTEST";

        bridge.setAssetMetadata(externalChainId, newName, newSymbol, address(0x5555));

        (,,, string externalName, string externalSymbol,,,) = bridge.assets(address(0x5555), externalChainId);
        require(keccak256(externalName) == keccak256(newName), "Name not updated correctly");
        require(keccak256(externalSymbol) == keccak256(newSymbol), "Symbol not updated correctly");
    }

    function it_bridge_can_set_token_limits() {
        uint256 newLimit = 2000000e18;
        bridge.setWithdrawalLimits(externalChainId, address(0x5555), newLimit);

        (,,,,,, uint maxPerWithdrawal,) = bridge.assets(address(0x5555), externalChainId);
        require(maxPerWithdrawal == newLimit, "Token limit not updated correctly");
    }

    function it_bridge_reverts_set_asset_for_missing_chain() {
        bool reverted = false;
        try {
            bridge.setAsset(true, 999, 18, "Test", "TEST", address(0x1111), 1000, address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert for missing chain");
    }

    // ============ ADMIN FUNCTIONS TESTS ============

    function it_bridge_can_set_token_factory() {
        TokenFactory newFactory = new TokenFactory(owner);
        bridge.setTokenFactory(address(newFactory));
        require(address(bridge.tokenFactory()) == address(newFactory), "Token factory not updated");
    }

    function it_bridge_can_set_pause() {
        bridge.setPause(true, false);
        require(bridge.depositsPaused(), "Deposits should be paused");
        require(!bridge.withdrawalsPaused(), "Withdrawals should not be paused");

        bridge.setPause(false, true);
        require(!bridge.depositsPaused(), "Deposits should not be paused");
        require(bridge.withdrawalsPaused(), "Withdrawals should be paused");
    }

    function it_bridge_can_set_usdst_address() {
        address newUSDST = address(0xBBBB);
        bridge.setUSDSTAddress(newUSDST);
        require(bridge.USDST_ADDRESS() == newUSDST, "USDST address not updated");
    }

    function it_bridge_reverts_admin_functions_by_non_owner() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "setRelayer", address(0x1111));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert setRelayer by non-owner");

        reverted = false;
        try {
            user1.do(address(bridge), "setPause", true, true);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert setPause by non-owner");
    }

    // ============ DEPOSIT FLOW TESTS ============

    function it_bridge_can_initiate_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123456";

        // Just call the function without any assertions to see if it works
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount,  txHash, recipient, address(testToken));
    }

    function it_bridge_can_initiate_deposit_with_usdst_minting() {
        uint256 amount = 500e18;
        address recipient = address(0xDDDD);
        string memory txHash = "0xabcdef123457";

        // Call deposit function directly as relayer
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        // Check that deposit was created
        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(usdstToken), "Token should be set");
    }

    function it_bridge_can_confirm_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123458";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Then confirm it
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Check that deposit was confirmed
        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_review_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123459";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Then mark for review
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash);

        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_deposits() {
        uint256[] memory chainIds = new uint256[](2);
        string[] memory txHashes = new string[](2);
        address[] memory tokens = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        address[] memory recipients = new address[](2);
        address[] memory senders = new address[](2);
        address[] memory targetStratoTokens = new address[](2);

        chainIds[0] = externalChainId;
        chainIds[1] = externalChainId;
        txHashes[0] = "0xa1b2c3d4e5f6";
        txHashes[1] = "0xf6e5d4c3b2a1";
        tokens[0] = address(0x5555); // external token address
        tokens[1] = address(0x6666); // external USDST token address
        amounts[0] = 1000e18;
        amounts[1] = 2000e18;
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        senders[0] = address(0x3333);
        senders[1] = address(0x4444);
        targetStratoTokens[0] = address(testToken);
        targetStratoTokens[1] = address(usdstToken);

        relayer.do(address(bridge), "depositBatch", chainIds, senders, tokens, amounts, txHashes, recipients, targetStratoTokens);

        (,,,,, address stratoToken1,,) = bridge.deposits(externalChainId, txHashes[0].normalizeHex());
        (,,,,, address stratoToken2,,) = bridge.deposits(externalChainId, txHashes[1].normalizeHex());
        require(stratoToken1 == address(testToken), "First deposit token should be set");
        require(stratoToken2 == address(usdstToken), "Second deposit token should be set");
    }

    function it_bridge_can_handle_batch_confirm_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xc0af1b123456";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Batch confirm
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        relayer.do(address(bridge), "confirmDepositBatch", chainIds, txHashes);

        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_review_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xe3113a123456";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Batch review
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        relayer.do(address(bridge), "reviewDepositBatch", chainIds, txHashes);

        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_reverts_deposit_by_non_relayer() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, externalTxHash, address(0x1111), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit by non-relayer");
    }

    function it_bridge_reverts_deposit_when_paused() {
        bridge.setPause(true, false);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, externalTxHash, address(0x1111), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit when paused");
    }

    function it_bridge_reverts_deposit_with_duplicate_key() {
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, externalTxHash, address(0x1111), address(testToken));

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 2000e18, externalTxHash, address(0x2222), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert duplicate deposit key");
    }

    function it_bridge_reverts_deposit_with_zero_amount() {
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 0, externalTxHash, address(0x1111), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit with zero amount");
    }

    function it_bridge_reverts_deposit_with_disabled_chain() {
        bridge.setChain(chainName, custody, false, externalChainId, 1000, depositRouter);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, externalTxHash, address(0x1111), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit with disabled chain");
    }

    function it_bridge_reverts_deposit_without_permission() {
        // Non-default route should fail until explicitly enabled
        bridge.setAsset(true, externalChainId, 18, "Test", "TEST", address(0x5555), 1000000e18, address(testToken));

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, externalTxHash, address(0x1111), address(usdstToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when route is not enabled");
    }

    // ============ WITHDRAWAL FLOW TESTS ============

    function it_bridge_can_request_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Create a separate token for withdrawal testing through token factory
        TestERC20 withdrawalToken = TestERC20(tokenFactory.createToken("Withdrawal Token", "WITHDRAW", [], [], [], "WITHDRAW", 0, 18));
        Token(address(withdrawalToken)).setStatus(2); // ACTIVE
        withdrawalToken.mint(address(user1), amount);
        user1.do(address(withdrawalToken), "approve", address(bridge), amount);

        // Set up asset for withdrawal token
        bridge.setAsset(
            true,
            externalChainId,
            18, // decimals
            "External Withdrawal Token",
            "EWITHDRAW",
            address(0x6666), // external token address
            1000000e18, // max per tx
            address(withdrawalToken) // strato token
        );

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x6666), address(withdrawalToken), amount);
        require(withdrawalId == 1, "Withdrawal ID should be 1");
        require(bridge.withdrawalCounter() == 1, "Withdrawal counter should be 1");

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(withdrawalToken), "Token should be set");
    }

    function it_bridge_can_request_withdrawal_with_usdst() {
        uint256 amount = 500e18;
        address recipient = address(0xFFFF);

        // Use the USDST token that we set up in beforeEach
        // The bridge will use the USDST address we set with setUSDSTAddress
        Token(address(usdstToken)).mint(address(user1), amount);
        user1.do(address(usdstToken), "approve", address(bridge), amount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x6666), address(usdstToken), amount);
        require(withdrawalId == 1, "Withdrawal ID should be 1");

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(usdstToken), "Token should be set");
    }

    function it_bridge_can_confirm_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "deadbeef";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Confirm withdrawal
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_finalise_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "deadbeef";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Confirm and finalise
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);
        bridge.finaliseWithdrawal(withdrawalId);

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_user() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Abort by user (should fail due to 48h wait period)
        bool reverted = false;
        try {
            user1.do(address(bridge), "abortWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert due to 48h wait period");

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_relayer() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Abort by relayer (should succeed)
        relayer.do(address(bridge), "abortWithdrawal", withdrawalId);

        (,,,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Use the existing test tokens that are already set up
        // Setup first withdrawal with testToken
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), amount1);

        // Setup second withdrawal with usdstToken
        Token(address(usdstToken)).mint(address(user2), amount2);
        user2.do(address(usdstToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x6666), address(usdstToken), amount2);

        // Batch confirm
        uint256[] memory ids = new uint256[](2);
        string[] memory txHashes = new string[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;
        txHashes[0] = "deadbeef";
        txHashes[1] = "deadbeef";

        relayer.do(address(bridge), "confirmWithdrawalBatch", ids, txHashes);

        (,,,,,,,, address stratoToken1,,) = bridge.withdrawals(withdrawalId1);
        (,,,,,,,, address stratoToken2,,) = bridge.withdrawals(withdrawalId2);
        require(stratoToken1 == address(testToken), "First withdrawal token should be set");
        require(stratoToken2 == address(usdstToken), "Second withdrawal token should be set");
    }

    function it_bridge_can_handle_batch_finalise_withdrawals() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "deadbeef";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Confirm first
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        // Batch finalise
        uint256[] memory ids = new uint256[](1);
        string[] memory txHashes = new string[](1);
        ids[0] = withdrawalId;
        txHashes[0] = custodyTxHash;

        relayer.do(address(bridge), "finaliseWithdrawalBatch", ids);

        (BridgeStatus bridgeStatus,,,,,,,,,,) = bridge.withdrawals(withdrawalId);
        require(bridgeStatus == BridgeStatus.COMPLETED, "Status should be COMPLETED");
    }

    function it_bridge_can_handle_batch_abort_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Setup first withdrawal
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), amount1);

        // Setup second withdrawal
        Token(address(testToken)).mint(address(user2), amount2);
        user2.do(address(testToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x5555), address(testToken), amount2);

        // Batch abort by relayer
        uint256[] memory ids = new uint256[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;

        relayer.do(address(bridge), "abortWithdrawalBatch", ids);

        (BridgeStatus bridgeStatus,,,,,,,,,,) = bridge.withdrawals(withdrawalId1);
        (BridgeStatus bridgeStatus2,,,,,,,,,,) = bridge.withdrawals(withdrawalId2);
        require(bridgeStatus == BridgeStatus.ABORTED, "First withdrawal should be ABORTED");
        require(bridgeStatus2 == BridgeStatus.ABORTED, "Second withdrawal should be ABORTED");
    }

    function it_bridge_reverts_withdrawal_when_paused() {
        bridge.setPause(false, true);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal when paused");
    }

    function it_bridge_reverts_withdrawal_with_zero_amount() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal with zero amount");
    }

    function it_bridge_reverts_withdrawal_exceeding_cap() {
        uint256 amount = 2000000e18; // Exceeds maxPerWithdrawal of 1000000e18

        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal exceeding cap");
    }

    function it_bridge_reverts_withdrawal_with_disabled_chain() {
        bridge.setChain(chainName, custody, false, externalChainId, 1000, depositRouter);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal with disabled chain");
    }

    // ============ EDGE CASES ============

    function it_bridge_handles_large_amounts() {
        uint256 largeAmount = 1000000e18;
        address recipient = address(0xEEEE);

        testToken.mint(address(user1), largeAmount);
        user1.do(address(testToken), "approve", address(bridge), largeAmount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), largeAmount);
        require(withdrawalId == 1, "Should handle large amounts");
    }

    function it_bridge_handles_multiple_withdrawals() {
        uint256 amount = 1000e18;

        // First withdrawal
        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), amount);

        // Second withdrawal
        testToken.mint(address(user2), amount);
        user2.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x5555), address(testToken), amount);

        require(withdrawalId1 == 1, "First withdrawal ID should be 1");
        require(withdrawalId2 == 2, "Second withdrawal ID should be 2");
        require(bridge.withdrawalCounter() == 2, "Withdrawal counter should be 2");
    }

    function it_bridge_handles_different_chain_ids() {
        uint256 chainId1 = 1; // Ethereum
        uint256 chainId2 = 137; // Polygon

        // Set up second chain
        bridge.setChain("Polygon", address(0x6666), true, chainId2, 2000, address(0x7777));
        bridge.setAsset(true, chainId2, 18, "Polygon Test", "PTEST", address(0x8888), 1000000e18, address(testToken));

        // Test deposits on both chains
        relayer.do(address(bridge), "deposit", chainId1, externalSender, address(0x5555), 1000e18, "0x1a2b3c4d5e6f", address(0x1111), address(testToken));
        relayer.do(address(bridge), "deposit", chainId2, externalSender, address(0x8888), 2000e18, "0xf6e5d4c3b2a1", address(0x2222), address(testToken));

        (BridgeStatus bridgeStatus1,,,,,,,) = bridge.deposits(chainId1, "0x1a2b3c4d5e6f".normalizeHex());
        (BridgeStatus bridgeStatus2,,,,,,,) = bridge.deposits(chainId2, "0xf6e5d4c3b2a1".normalizeHex());
        require(bridgeStatus1 == BridgeStatus.INITIATED, "First chain deposit should be INITIATED");
        require(bridgeStatus2 == BridgeStatus.INITIATED, "Second chain deposit should be INITIATED");
    }

    function it_bridge_default_route_deposit_works_without_explicit_route_enable() {
        string memory txHash = "0xdecaf001";
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, txHash, address(0x1111), address(testToken));
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.INITIATED, "Default route deposit should succeed");
    }

    function it_bridge_non_default_route_deposit_requires_explicit_route_enable() {
        string memory txHash = "0xdecaf002";
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, txHash, address(0x1111), address(usdstToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Non-default route should revert before enabling");

        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), true);
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, txHash, address(0x1111), address(usdstToken));
        (,,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(stratoToken == address(usdstToken), "Route should mint enabled non-default token");
    }

    function it_bridge_non_default_route_disable_blocks_deposit_again() {
        string memory txHash = "0xdecaf003";
        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), true);
        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), false);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), 1000e18, txHash, address(0x1111), address(usdstToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Disabled explicit route should be blocked");
    }

    function it_bridge_batch_deposit_with_mixed_route_targets_records_selected_strato_token() {
        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), true);

        uint256[] memory chainIds = new uint256[](2);
        address[] memory senders = new address[](2);
        address[] memory tokens = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        string[] memory txHashes = new string[](2);
        address[] memory recipients = new address[](2);
        address[] memory targetStratoTokens = new address[](2);

        chainIds[0] = externalChainId;
        chainIds[1] = externalChainId;
        senders[0] = externalSender;
        senders[1] = externalSender;
        tokens[0] = address(0x5555);
        tokens[1] = address(0x5555);
        amounts[0] = 1000e18;
        amounts[1] = 2000e18;
        txHashes[0] = "0xdecaf004";
        txHashes[1] = "0xdecaf005";
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        targetStratoTokens[0] = address(testToken);
        targetStratoTokens[1] = address(usdstToken);

        relayer.do(address(bridge), "depositBatch", chainIds, senders, tokens, amounts, txHashes, recipients, targetStratoTokens);

        (,,,,, address stratoToken1,,) = bridge.deposits(externalChainId, txHashes[0].normalizeHex());
        (,,,,, address stratoToken2,,) = bridge.deposits(externalChainId, txHashes[1].normalizeHex());
        require(stratoToken1 == address(testToken), "First route should use default token");
        require(stratoToken2 == address(usdstToken), "Second route should use explicit token");
    }

    function it_bridge_default_route_withdrawal_works_without_explicit_route_enable() {
        uint256 amount = 1000e18;
        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(testToken), amount);
        require(withdrawalId == 1, "Default route withdrawal should succeed");
    }

    function it_bridge_non_default_route_withdrawal_requires_explicit_route_enable() {
        uint256 amount = 1000e18;
        usdstToken.mint(address(user1), amount);
        user1.do(address(usdstToken), "approve", address(bridge), amount);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(usdstToken), amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-default route withdrawal should revert before enabling");

        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), true);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(usdstToken), amount);
        require(withdrawalId == 1, "Enabled non-default route withdrawal should succeed");
    }

    function it_bridge_non_default_route_withdrawal_is_blocked_after_disable() {
        uint256 amount = 1000e18;
        usdstToken.mint(address(user1), amount);
        user1.do(address(usdstToken), "approve", address(bridge), amount);

        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), true);
        bridge.setAssetRoute(address(0x5555), externalChainId, address(usdstToken), false);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), address(usdstToken), amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Disabled non-default withdrawal route should be blocked");
    }

    function it_bridge_handles_zero_max_per_tx() {
        // Set asset with zero max per tx (unlimited)
        bridge.setAsset(true, externalChainId, 18, "Test", "TEST", address(0x5555), 0, address(testToken));

        uint256 largeAmount = 5000000e18; // Very large amount
        address recipient = address(0xEEEE);

        testToken.mint(address(user1), largeAmount);
        user1.do(address(testToken), "approve", address(bridge), largeAmount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), largeAmount);
        require(withdrawalId == 1, "Should handle unlimited amounts with zero max per tx");
    }

    function it_bridge_handles_withdrawal_abort_delay() {
        // Test that withdrawal abort delay is set correctly
        require(bridge.WITHDRAWAL_ABORT_DELAY() == 172800, "Withdrawal abort delay should be 48 hours");
    }

    function it_bridge_handles_usdst_address() {
        // Test that USDST address is set correctly
        require(bridge.USDST_ADDRESS() != address(0), "USDST address should be set");
    }

    function it_bridge_reverts_deposit_with_inactive_token() {
        // Create an inactive token
        TestERC20 inactiveToken = TestERC20(tokenFactory.createToken("Inactive Token", "INACTIVE", [], [], [], "INACTIVE", 0, 18));
        // Don't set status to ACTIVE (keep it inactive)

        // Set up asset for inactive token
        bridge.setAsset(
            true,
            externalChainId,
            18,
            "Inactive External Token",
            "IEXT",
            address(0x7777),
            1000000e18,
            address(inactiveToken)
        );

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x7777), 1000e18, "1n4ct1v3", address(0x1111), address(inactiveToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with inactive token");
    }

    function it_bridge_handles_batch_deposit_with_empty_arrays() {
        uint256[] memory chainIds = new uint256[](0);
        address[] memory senders = new address[](0);
        address[] memory tokens = new address[](0);
        string[] memory txHashes = new string[](0);
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        address[] memory targetStratoTokens = new address[](0);

        // Empty batch should succeed (no-op)
        bool reverted = false;
        try {
            relayer.do(address(bridge), "depositBatch", chainIds, senders, tokens, amounts, txHashes, recipients, targetStratoTokens);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert empty batch");
    }

    function it_bridge_handles_batch_withdrawal_with_empty_arrays() {
        uint256[] memory ids = new uint256[](0);
        string[] memory txHashes = new string[](0);

        // Empty batch should succeed (no-op)
        bool reverted = false;
        try {
            relayer.do(address(bridge), "confirmWithdrawalBatch", ids, txHashes);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert empty batch");
    }

    function it_bridge_reverts_confirm_deposit_in_wrong_state() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xab0cdefa1e3f";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Try to confirm twice (should fail on second attempt)
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert confirming deposit in wrong state");
    }

    function it_bridge_reverts_finalise_withdrawal_in_wrong_state() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Try to finalise without confirming first
        bool reverted = false;
        try {
            relayer.do(address(bridge), "finaliseWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert finalising withdrawal in wrong state");
    }

    function it_bridge_reverts_abort_withdrawal_in_wrong_state() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Confirm and finalise withdrawal
        relayer.do(address(bridge), "confirmWithdrawal", withdrawalId, "deadbeef");
        relayer.do(address(bridge), "finaliseWithdrawal", withdrawalId);

        // Try to abort completed withdrawal
        bool reverted = false;
        try {
            relayer.do(address(bridge), "abortWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert aborting completed withdrawal");
    }

    function it_bridge_handles_withdrawal_abort_by_different_user() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal with user1
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), address(testToken), amount);

        // Try to abort with different user
        bool reverted = false;
        try {
            user2.do(address(bridge), "abortWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert aborting withdrawal by different user");
    }

    // ============ BLOCK ROLLBACK SECURITY TESTS ============

    function it_bridge_reverts_set_last_processed_block_rollback() {
        uint256 initialBlock = 1000;
        relayer.do(address(bridge), "setLastProcessedBlock", externalChainId, initialBlock);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "setLastProcessedBlock", externalChainId, 500); // Rollback attempt
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert rollback attempt");
    }

    function it_bridge_allows_monotonic_block_updates() {
        uint256 initialBlock = 1000;
        relayer.do(address(bridge), "setLastProcessedBlock", externalChainId, initialBlock);

        // Should succeed - monotonic increase
        relayer.do(address(bridge), "setLastProcessedBlock", externalChainId, 1500);

        (,,,, uint256 currentBlock) = bridge.chains(externalChainId);
        require(currentBlock == 1500, "Block should be updated");
    }

    function it_bridge_allows_same_block_update() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);

        // Should succeed - same block (no-op)
        bridge.setLastProcessedBlock(externalChainId, 1000);

        (,,,, uint256 currentBlock) = bridge.chains(externalChainId);
        require(currentBlock == 1000, "Block should remain the same");
    }

    function it_bridge_emergency_override_allows_rollback() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);

        // Emergency override should allow rollback
        bridge.emergencySetLastProcessedBlock(externalChainId, 500);

        (,,,, uint256 currentBlock) = bridge.chains(externalChainId);
        require(currentBlock == 500, "Emergency rollback should succeed");
    }

    function it_bridge_emergency_override_requires_owner() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);

        bool reverted = false;
        try {
            user1.do(address(bridge), "emergencySetLastProcessedBlock", externalChainId, 500);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert emergency override by non-owner");
    }

    // ============ ZERO ADDRESS VALIDATION TESTS ============

    function it_bridge_reverts_deposit_with_zero_recipient() {
        uint256 amount = 1000e18;
        string memory txHash = "z3r0r3c1p13nt";

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, address(0), address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with zero recipient");
    }

    function it_bridge_allows_deposit_with_valid_recipient() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0x1a11d3ec1e13";

        // Should succeed with valid recipient
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Verify deposit was created
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.INITIATED, "Deposit should be initiated");
    }

    // ============ HASH NORMALIZATION SECURITY TESTS ============

    function it_bridge_prevents_case_variation_replay_attack() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);

        // First deposit with lowercase hash
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, "0xabcdef1234", recipient, address(testToken));

        // Attempt replay with uppercase hash (should fail)
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, "0xABCDEF1234", recipient, address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent case variation replay");
    }

    function it_bridge_normalizes_transaction_hashes() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);

        // Deposit with mixed case hash
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, "0xAbCdEf1234", recipient, address(testToken));

        // Verify stored as lowercase
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, "0xabcdef1234".normalizeHex());
        require(status == BridgeStatus.INITIATED, "Should normalize to lowercase");
    }

    function it_prevents_multiple_case_variations() {
        uint256 depositAmount = 500000e6;
        address recipient = address(0xCCCC);
        string memory variant1 = "0xabc123";
        string memory variant2 = "0xABC123";
        string memory variant3 = "0xAbC123";
        string memory variant4 = "0xaBc123";

        // First deposit should succeed
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), depositAmount, variant1, recipient, address(testToken));
        relayer.do(address(bridge), "confirmDeposit", externalChainId, variant1);

        // Subsequent deposits with case variations should fail due to normalization
        bool reverted2 = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), depositAmount, variant2, recipient, address(testToken));
        } catch {
            reverted2 = true;
        }
        require(reverted2, "Should prevent case variation replay");

        bool reverted3 = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), depositAmount, variant3, recipient, address(testToken));
        } catch {
            reverted3 = true;
        }
        require(reverted3, "Should prevent case variation replay");

        bool reverted4 = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), depositAmount, variant4, recipient, address(testToken));
        } catch {
            reverted4 = true;
        }
        require(reverted4, "Should prevent case variation replay");

        // Only one deposit should have succeeded
        require(IERC20(address(testToken)).balanceOf(recipient) == depositAmount, "Only one mint should succeed");
    }

    function it_prevents_case_variation_replay_attack() {
        uint256 depositAmount = 500000e6;
        address victim = address(0xCCCC);
        string memory txHashLower = "0xabc123";
        string memory txHashUpper = "0xABC123";

        require(IERC20(address(testToken)).balanceOf(victim) == 0, "Victim starts with 0 balance");

        // First deposit with lowercase hash
        relayer.do(address(bridge), "deposit",
            externalChainId,
            externalSender,
            address(0x5555),
            depositAmount,
            txHashLower,
            victim,
            address(testToken)
        );
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHashLower);

        require(IERC20(address(testToken)).balanceOf(victim) == depositAmount, "First mint successful");

        // Second deposit with uppercase hash should fail due to normalization
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit",
                externalChainId,
                externalSender,
                address(0x5555),
                depositAmount,
                txHashUpper,
                victim,
                address(testToken)
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent case variation replay attack");

        // Balance should remain the same (no duplicate mint)
        require(IERC20(address(testToken)).balanceOf(victim) == depositAmount, "No duplicate mint should occur");
    }

    function it_normalizes_0x_and_non_0x_hashes() {
        uint256 depositAmount = 500000e6;
        address recipient = address(0xAAAA);
        string memory hashWith0x = "0xdef456";
        string memory hashWithout0x = "def456";

        require(hashWith0x.normalizeHex() == hashWithout0x.normalizeHex(), "Hash with 0x prefix should be normalized to hash without 0x prefix");

        // First deposit with 0x prefix
        relayer.do(address(bridge), "deposit",
            externalChainId,
            externalSender,
            address(0x5555),
            depositAmount,
            hashWith0x,
            recipient,
            address(testToken)
        );
        relayer.do(address(bridge), "confirmDeposit", externalChainId, hashWith0x);

        require(IERC20(address(testToken)).balanceOf(recipient) == depositAmount, "First deposit should succeed");

        // Second deposit without 0x prefix should fail due to normalization (same hash)
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit",
                externalChainId,
                externalSender,
                address(0x5555),
                depositAmount,
                hashWithout0x,
                recipient,
                address(testToken)
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent duplicate deposit with different 0x format");

        // Balance should remain the same (no duplicate mint)
        require(IERC20(address(testToken)).balanceOf(recipient) == depositAmount, "No duplicate mint should occur");

        // Verify deposit exists and is completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, hashWith0x.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
    }

    function it_bridge_can_confirm_deposit_in_pending_review() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0x1234567890abcdef";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Mark for review
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash);

        // Confirm the reviewed deposit
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
        require(IERC20(address(testToken)).balanceOf(recipient) == amount, "Tokens should be minted");
    }

    function it_bridge_can_abort_deposit_in_pending_review() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef1234567890";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Mark for review
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash);

        // Abort the reviewed deposit
        bridge.abortDeposit(externalChainId, txHash);

        // Verify deposit was aborted
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.ABORTED, "Deposit should be aborted");
        require(IERC20(address(testToken)).balanceOf(recipient) == 0, "No tokens should be minted");
    }

    function it_bridge_abort_requires_owner() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xfedcba0987654321";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Mark for review
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash);

        // Try to abort as non-owner (should fail)
        bool reverted = false;
        try {
            user1.do(address(bridge), "abortDeposit", externalChainId, txHash);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to abort");
    }

    function it_bridge_abort_only_works_on_pending_review() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0x9876543210fedcba";

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash, recipient, address(testToken));

        // Try to abort deposit in INITIATED state (should fail)
        bool reverted = false;
        try {
            relayer.do(address(bridge), "abortDeposit", externalChainId, txHash);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when trying to abort deposit in INITIATED state");
    }

    function it_bridge_can_handle_batch_abort_deposits() {
        uint256 amount = 1000e18;
        address recipient1 = address(0xAAAA);
        address recipient2 = address(0xBBBB);
        string memory txHash1 = "0x1111111111111111";
        string memory txHash2 = "0x2222222222222222";

        // First initiate deposits
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash1, recipient1, address(testToken));
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x5555), amount, txHash2, recipient2, address(testToken));

        // Mark both for review
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash1);
        relayer.do(address(bridge), "reviewDeposit", externalChainId, txHash2);

        // Batch abort both deposits
        uint256[] memory chainIds = new uint256[](2);
        string[] memory txHashes = new string[](2);
        chainIds[0] = externalChainId;
        chainIds[1] = externalChainId;
        txHashes[0] = txHash1;
        txHashes[1] = txHash2;

        bridge.abortDepositBatch(chainIds, txHashes);

        // Verify both deposits were aborted
        (BridgeStatus status1,,,,,,,) = bridge.deposits(externalChainId, txHash1.normalizeHex());
        (BridgeStatus status2,,,,,,,) = bridge.deposits(externalChainId, txHash2.normalizeHex());
        require(status1 == BridgeStatus.ABORTED, "First deposit should be aborted");
        require(status2 == BridgeStatus.ABORTED, "Second deposit should be aborted");
        require(IERC20(address(testToken)).balanceOf(recipient1) == 0, "No tokens should be minted for first deposit");
        require(IERC20(address(testToken)).balanceOf(recipient2) == 0, "No tokens should be minted for second deposit");
    }

    function it_bridge_deposit_decimal_conversion_works_correctly() {
        // Test decimal conversion from 6-decimal USDC to 18-decimal STRATO tokens
        // 1e6 USDC (6 decimals) should convert to 1e18 STRATO tokens (18 decimals)

        // Set up asset with 6 decimals (like USDC)
        uint256 usdcDecimals = 6;
        string memory usdcName = "USD Coin";
        string memory usdcSymbol = "USDC";
        address usdcToken = address(0x1111);
        uint256 maxPerWithdrawal = 0; // unlimited
        address usdcStratoToken = address(testToken);

        bridge.setAsset(true, externalChainId, usdcDecimals, usdcName, usdcSymbol, usdcToken, maxPerWithdrawal, usdcStratoToken);

        // Test conversion: 1e6 USDC should become 1e18 STRATO tokens
        uint256 externalTokenAmount = 1e6; // 1 USDC in 6-decimal format
        uint256 expectedStratoAmount = 1e18; // 1 STRATO token in 18-decimal format

        relayer.do(address(bridge), "deposit", externalChainId, address(0x2222), usdcToken, externalTokenAmount, "0x123", address(0x3333), usdcStratoToken);

        // Check the deposit was recorded with correct conversion
        (,,,,,, uint256 recordedStratoAmount,) = bridge.deposits(externalChainId, "0x123".normalizeHex());
        require(recordedStratoAmount == expectedStratoAmount, "Decimal conversion failed");

        // Test another conversion: 2.5e6 USDC should become 2.5e18 STRATO tokens
        uint256 externalTokenAmount2 = 25e5; // 2.5 USDC in 6-decimal format
        uint256 expectedStratoAmount2 = 25e17; // 2.5 STRATO tokens in 18-decimal format

        relayer.do(address(bridge), "deposit", externalChainId, address(0x4444), usdcToken, externalTokenAmount2, "0x456", address(0x5555), usdcStratoToken);

        // Check the second deposit was recorded with correct conversion
        (,,,,,, uint256 recordedStratoAmount2,) = bridge.deposits(externalChainId, "0x456".normalizeHex());
        require(recordedStratoAmount2 == expectedStratoAmount2, "Decimal conversion failed for 2.5 USDC");
    }

    function it_bridge_deposit_same_decimal_conversion_works_correctly() {
        // Test decimal conversion when external token has same decimals as STRATO (18 decimals)
        // 1e18 external tokens should convert to 1e18 STRATO tokens (no conversion needed)

        // Set up asset with 18 decimals (same as STRATO)
        uint256 tokenDecimals = 18;
        string memory tokenName = "Ethereum Token";
        string memory tokenSymbol = "ETH";
        address ethToken = address(0x2222);
        uint256 maxPerWithdrawal = 0; // unlimited
        address ethStratoToken = address(testToken);

        bridge.setAsset(true, externalChainId, tokenDecimals, tokenName, tokenSymbol, ethToken, maxPerWithdrawal, ethStratoToken);

        // Test conversion: 1e18 ETH should become 1e18 STRATO tokens (1:1 ratio)
        uint256 externalTokenAmount = 1e18; // 1 ETH in 18-decimal format
        uint256 expectedStratoAmount = 1e18; // 1 STRATO token in 18-decimal format

        relayer.do(address(bridge), "deposit", externalChainId, address(0x3333), ethToken, externalTokenAmount, "0x789", address(0x4444), ethStratoToken);

        // Check the deposit was recorded with correct conversion (1:1 ratio)
        (,,,,,, uint256 recordedStratoAmount,) = bridge.deposits(externalChainId, "0x789".normalizeHex());
        require(recordedStratoAmount == expectedStratoAmount, "Same decimal conversion failed");

        // Test another conversion: 2.5e18 ETH should become 2.5e18 STRATO tokens
        uint256 externalTokenAmount2 = 25e17; // 2.5 ETH in 18-decimal format
        uint256 expectedStratoAmount2 = 25e17; // 2.5 STRATO tokens in 18-decimal format

        relayer.do(address(bridge), "deposit", externalChainId, address(0x5555), ethToken, externalTokenAmount2, "0xabc", address(0x6666), ethStratoToken);

        // Check the second deposit was recorded with correct conversion (1:1 ratio)
        (,,,,,, uint256 recordedStratoAmount2,) = bridge.deposits(externalChainId, "0xabc".normalizeHex());
        require(recordedStratoAmount2 == expectedStratoAmount2, "Same decimal conversion failed for 2.5 ETH");

        // Test fractional conversion: 0.1e18 ETH should become 0.1e18 STRATO tokens
        uint256 externalTokenAmount3 = 1e17; // 0.1 ETH in 18-decimal format
        uint256 expectedStratoAmount3 = 1e17; // 0.1 STRATO tokens in 18-decimal format

        relayer.do(address(bridge), "deposit", externalChainId, address(0x7777), ethToken, externalTokenAmount3, "0xdef", address(0x8888), ethStratoToken);

        // Check the third deposit was recorded with correct conversion (1:1 ratio)
        (,,,,,, uint256 recordedStratoAmount3,) = bridge.deposits(externalChainId, "0xdef".normalizeHex());
        require(recordedStratoAmount3 == expectedStratoAmount3, "Same decimal conversion failed for 0.1 ETH");
    }

    function it_bridge_withdrawal_decimal_conversion_rounds_down() {
        // Test that withdrawal conversion rounds down when precision is lost
        // Set up asset with 6 decimals (like USDC)
        uint256 tokenDecimals = 6;
        string memory tokenName = "USD Coin";
        string memory tokenSymbol = "USDC";
        address usdcToken = address(0x6666);
        uint256 maxPerWithdrawal = 0; // unlimited
        address usdcStratoToken = address(testToken);

        bridge.setAsset(true, externalChainId, tokenDecimals, tokenName, tokenSymbol, usdcToken, maxPerWithdrawal, usdcStratoToken);

        // Test withdrawal conversion: 1.999999 STRATO tokens should become 1.999999 USDC (rounds down)
        // 1.999999e18 STRATO tokens / 10^(18-6) = 1.999999e18 / 10^12 = 1999999 -> rounds down to 1999999
        uint256 stratoTokenAmount = 1999999e12; // 1.999999 STRATO tokens in 18-decimal format
        uint256 expectedExternalAmount = 1999999; // 1.999999 USDC in 6-decimal format (no rounding needed)

        // First mint some tokens to the user
        testToken.mint(address(this), stratoTokenAmount);
        testToken.approve(address(bridge), stratoTokenAmount);

        uint256 withdrawalId = bridge.requestWithdrawal(externalChainId, address(0x7777), usdcToken, usdcStratoToken, stratoTokenAmount);

        // Check the withdrawal was recorded with correct conversion
        (,,,,, uint256 recordedExternalAmount,,,,,) = bridge.withdrawals(withdrawalId);
        require(recordedExternalAmount == expectedExternalAmount, "USDC withdrawal conversion failed");

        // Test rounding down scenario: 1.999999999 STRATO tokens should become 1.999999 USDC (rounds down)
        uint256 stratoTokenAmount2 = 1999999999e9; // 1.999999999 STRATO tokens in 18-decimal format
        uint256 expectedExternalAmount2 = 1999999; // 1.999999 USDC in 6-decimal format (rounded down)

        // Mint more tokens
        testToken.mint(address(this), stratoTokenAmount2);
        testToken.approve(address(bridge), stratoTokenAmount2);

        uint256 withdrawalId2 = bridge.requestWithdrawal(externalChainId, address(0x8888), usdcToken, usdcStratoToken, stratoTokenAmount2);

        // Check the second withdrawal was recorded with correct conversion (should round down)
        (,,,,, uint256 recordedExternalAmount2,,,,,) = bridge.withdrawals(withdrawalId2);
        require(recordedExternalAmount2 == expectedExternalAmount2, "USDC rounding down failed");

        // Test edge case: very small STRATO amount that should round down to 0
        uint256 tinyStratoAmount = 1e11; // 0.0000001 STRATO tokens in 18-decimal format
        uint256 expectedTinyExternalAmount = 0; // 1.000000 USDC in 6-decimal format (rounded down to 0)

        // Mint tiny amount
        testToken.mint(address(this), tinyStratoAmount);
        testToken.approve(address(bridge), tinyStratoAmount);

        bool reverted = false;
        try {
            uint256 withdrawalId3 = bridge.requestWithdrawal(externalChainId, address(0x9999), usdcToken, usdcStratoToken, tinyStratoAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when tiny withdrawal is recorded with correct conversion (should round down to 0)");

        // Test another rounding down scenario: 2.000001 STRATO tokens should become 2.000000 USDC (rounds down)
        uint256 stratoTokenAmount4 = 2000001e12; // 2.000001 STRATO tokens in 18-decimal format
        uint256 expectedExternalAmount4 = 2000001; // 2.000000 USDC in 6-decimal format (rounded down)

        // Mint more tokens
        testToken.mint(address(this), stratoTokenAmount4);
        testToken.approve(address(bridge), stratoTokenAmount4);

        uint256 withdrawalId4 = bridge.requestWithdrawal(externalChainId, address(0xaaaa), usdcToken, usdcStratoToken, stratoTokenAmount4);

        // Check the fourth withdrawal was recorded with correct conversion (should round down)
        (,,,,, uint256 recordedExternalAmount4,,,,,) = bridge.withdrawals(withdrawalId4);
        require(recordedExternalAmount4 == expectedExternalAmount4, "USDC precision loss rounding down failed");
    }

    function it_bridge_autosave_and_withdrawal_successful() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("example transaction hash");

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(1), address(0));

        // Confirm the deposit with auto save
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
        require(IERC20(address(mUSDST)).balanceOf(recipient) == amount, "Tokens should be minted");

        User(recipient).do(address(mercata.lendingPool()), "withdrawLiquidityAll");
        require(IERC20(address(usdstToken)).balanceOf(recipient) == amount, "mUSDST should be exchangable");
    }

    function it_bridge_autosave_before_deposit_initialized_succeeds() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("example transaction hash");

        // autoSave request before the bridge service picks up the deposit
        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(1), address(0));

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        // Confirm the deposit with auto save
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
        require(IERC20(address(mUSDST)).balanceOf(recipient) == amount, "Tokens should be minted");

        User(recipient).do(address(mercata.lendingPool()), "withdrawLiquidityAll");
        require(IERC20(address(usdstToken)).balanceOf(recipient) == amount, "mUSDST should be exchangable");
    }

    function it_bridge_autosave_reversion_causes_mint_to_recipient() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("example transaction hash");

        // First initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(1), address(0));

        // Confirm the deposit with auto save, which will fail due to disabled minting of mUSDST
        adminRegistry.castVoteOnIssue(address(adminRegistry), "removeWhitelist", address(mUSDST), "mint", address(mercata.liquidityPool()));
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed — falls back to minting USDST directly
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
        require(IERC20(address(usdstToken)).balanceOf(recipient) == amount, "Tokens should be minted");
    }

    // ============ AUTO FORGE TESTS ============

    function it_bridge_autoforge_successful() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("autoforge transaction hash");

        // Initiate deposit of USDST
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        // Request auto-forge into gold (action=2)
        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(2), address(goldToken));

        // Confirm the deposit — should auto-forge USDST into GOLDST
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");

        // With gold price at 2000e18 and 0% fee: 1000 USDST should yield 0.5 GOLDST
        uint256 expectedGold = (amount * 1e18) / 2000e18;
        require(IERC20(address(goldToken)).balanceOf(recipient) == expectedGold, "Recipient should have received GOLDST");
        require(IERC20(address(usdstToken)).balanceOf(recipient) == 0, "Recipient should not have USDST");
    }

    function it_bridge_autoforge_before_deposit_initialized_succeeds() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("autoforge early transaction hash");

        // Request auto-forge before deposit is initiated
        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(2), address(goldToken));

        // Initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        // Confirm the deposit
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");

        uint256 expectedGold = (amount * 1e18) / 2000e18;
        require(IERC20(address(goldToken)).balanceOf(recipient) == expectedGold, "Recipient should have received GOLDST");
    }

    function it_bridge_autoforge_reversion_causes_mint_to_recipient() {
        uint256 amount = 1000e18;
        address recipient = address(new User());
        string memory txHash = keccak256("autoforge revert transaction hash");

        // Initiate deposit
        relayer.do(address(bridge), "deposit", externalChainId, externalSender, address(0x6666), amount, txHash, recipient, address(usdstToken));

        // Request auto-forge
        relayer.do(address(bridge), "requestDepositAction", recipient, externalChainId, txHash, uint(2), address(goldToken));

        // Break MetalForge by removing gold mint whitelist
        adminRegistry.castVoteOnIssue(address(adminRegistry), "removeWhitelist", address(goldToken), "mint", address(metalForge));

        // Confirm the deposit — auto-forge will fail, should fall back to minting USDST
        relayer.do(address(bridge), "confirmDeposit", externalChainId, txHash);

        // Verify deposit was completed — falls back to minting USDST directly
        (BridgeStatus status,,,,,,,) = bridge.deposits(externalChainId, txHash.normalizeHex());
        require(status == BridgeStatus.COMPLETED, "Deposit should be completed");
        require(IERC20(address(usdstToken)).balanceOf(recipient) == amount, "Recipient should have received USDST as fallback");
        require(IERC20(address(goldToken)).balanceOf(recipient) == 0, "Recipient should not have GOLDST");
    }

}
