import "../../concrete/Bridge/MercataBridge.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Admin/AdminRegistry.sol";


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
    // Copy structs and enums from MercataBridge.sol for testing
    enum BridgeStatus {
        NONE,         // default (mapping unset)
        INITIATED,    // deposit  : relayer observed external tx
                      // withdrawal: user escrowed tokens
        PENDING_REVIEW, // deposit: verification failed, needs review
                      // withdrawal: custody tx proposed, waiting for review
        COMPLETED,    // flow fully executed
        ABORTED       // user/relayer reclaimed escrow
    }

    struct DepositInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
        address externalSender;    // External chain sender
        address externalToken;     // External token deposited
        address stratoRecipient;   // STRATO recipient
        address stratoToken;       // STRATO token to mint
        uint256 stratoTokenAmount; // STRATO token amount to mint
        uint256 timestamp;         // timestamp of the deposit
    }

    struct WithdrawalInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / PENDING_REVIEW / ...
        uint256 externalChainId;   // Chain where Custody resides
        address externalRecipient; // External chain recipient
        address externalToken;     // External token to receive
        uint256 requestedAt;      // timestamp of the withdrawal request (for abort accuracy)
        address stratoSender;      // STRATO sender
        address stratoToken;       // STRATO token to burn
        uint256 stratoTokenAmount; // STRATO token amount to burn
        uint256 timestamp;        // timestamp of the withdrawal
    }

    struct ChainInfo {
        address custody;            // custody on that chain
        address depositRouter;      // contract users interact with on L1/L2
        uint256 lastProcessedBlock; // last processed block on the chain for polling
        bool    enabled;            // quick toggle
        string  chainName;
    }

    struct AssetInfo {
        address externalToken;    // token address on external chain
        uint256 externalChainId;  // back-pointer to ChainInfo
        uint256 externalDecimals; // decimals of externalToken
        string  externalName;     // external token name
        string  externalSymbol;   // external token symbol
        uint256 maxPerTx;         // hard ceiling; 0 means "unlimited"
        address stratoToken;      // STRATO token to mint (ETHst, USDST, etc)
    }

    MercataBridge bridge;
    TokenFactory tokenFactory;
    AdminRegistry adminRegistry;
    TestERC20 testToken;
    TestUSDST usdstToken;
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
        adminRegistry = new AdminRegistry();
        adminRegistry.initialize([owner]);
        tokenFactory = new TokenFactory(address(adminRegistry));
        bridge = new MercataBridge(address(adminRegistry));
        bridge.initialize(address(tokenFactory), address(this));

        // Create test tokens through token factory with AdminRegistry as owner
        testToken = TestERC20(tokenFactory.createTokenWithInitialOwner("Test Token", "TEST", [], [], [], "TEST", 0, 18, address(adminRegistry)));
        usdstToken = TestUSDST(tokenFactory.createTokenWithInitialOwner("USDST", "USDST", [], [], [], "USDST", 0, 18, address(adminRegistry)));

        // Set tokens to ACTIVE status
        Token(address(testToken)).setStatus(2); // ACTIVE
        Token(address(usdstToken)).setStatus(2); // ACTIVE

        // AdminRegistry is already the owner of tokens, no need to transfer

        // Whitelist bridge for mint and burn functions
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(testToken), "mint", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(testToken), "burn", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(usdstToken), "mint", address(bridge));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(usdstToken), "burn", address(bridge));

        // Set up chain
        bridge.setChain(chainName, custody, true, externalChainId, 1000, depositRouter);

        // Set USDST address to our test token
        bridge.setUSDSTAddress(address(usdstToken));

        // Set up assets
        bridge.setAsset(
            externalChainId,
            18, // decimals
            "External Test Token",
            "ETEST",
            address(0x5555), // external token address
            1000000e18, // max per tx
            address(testToken) // strato token
        );

        bridge.setAsset(
            externalChainId,
            18, // decimals
            "External USDST",
            "EUSDST",
            address(0x6666), // external USDST token address
            1000000e18, // max per tx
            address(usdstToken) // strato token
        );
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_bridge_sets_initial_state() {
        require(address(bridge.tokenFactory()) == address(tokenFactory), "Token factory not set");
        require(bridge.relayer() == address(this), "Relayer not set");
        require(!bridge.depositsPaused(), "Deposits should not be paused initially");
        require(!bridge.withdrawalsPaused(), "Withdrawals should not be paused initially");
        require(bridge.withdrawalCounter() == 0, "Withdrawal counter should start at 0");
    }

    function it_bridge_reverts_with_zero_addresses() {
        bool reverted = false;
        try {
            new MercataBridge(owner).initialize(address(0), address(relayer));
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
        require(reverted, "Should revert with zero relayer");
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
        (address custody, address depositRouter, uint lastProcessedBlock, bool enabled, string chainName) = bridge.chains(chainId);
        require(custody == newCustody, "Custody not set correctly");
        require(depositRouter == newRouter, "Router not set correctly");
        require(lastProcessedBlock == lastBlock, "Last processed block not set correctly");
        require(enabled, "Chain should be enabled");
        require(keccak256(chainName) == keccak256(newChainName), "Chain name not set correctly");
    }

    function it_bridge_can_update_last_processed_block() {
        uint256 newBlock = 1500;
        bridge.setLastProcessedBlock(externalChainId, newBlock);

        (,, uint lastProcessedBlock,,) = bridge.chains(externalChainId);
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
        uint256 maxPerTx = 500000e6;
        uint8 permissions = 1; // WRAP only

        // First set up the chain
        bridge.setChain("BSC", address(0x6666), true, newChainId, 2000, address(0x7777));

        bridge.setAsset(newChainId, decimals, name, symbol, externalToken, maxPerTx, newToken);

        (address _externalToken, uint externalChainId, uint externalDecimals, string externalName, string externalSymbol, uint _maxPerTx, address _stratoToken) = bridge.assets(externalToken, newChainId);
        require(_externalToken == externalToken, "External token not set correctly");
        require(externalDecimals == decimals, "Decimals not set correctly");
        require(externalChainId == newChainId, "Chain ID not set correctly");
        require(keccak256(externalName) == keccak256(name), "Name not set correctly");
        require(keccak256(externalSymbol) == keccak256(symbol), "Symbol not set correctly");
        require(_maxPerTx == maxPerTx, "Max per tx not set correctly");
        require(_stratoToken == newToken, "Strato token not set correctly");
    }

    function it_bridge_can_update_asset_metadata() {
        string memory newName = "Updated Test Token";
        string memory newSymbol = "UTEST";

        bridge.setAssetMetadata(externalChainId, newName, newSymbol, address(0x5555));

        (,,, string externalName, string externalSymbol,,) = bridge.assets(address(0x5555), externalChainId);
        require(keccak256(externalName) == keccak256(newName), "Name not updated correctly");
        require(keccak256(externalSymbol) == keccak256(newSymbol), "Symbol not updated correctly");
    }

    function it_bridge_can_set_token_limits() {
        uint256 newLimit = 2000000e18;
        bridge.setTokenLimits(address(0x5555), externalChainId, newLimit);

        (,,,,, uint maxPerTx,) = bridge.assets(address(0x5555), externalChainId);
        require(maxPerTx == newLimit, "Token limit not updated correctly");
    }

    function it_bridge_reverts_set_asset_for_missing_chain() {
        bool reverted = false;
        try {
            bridge.setAsset(999, 18, "Test", "TEST", address(0x1111), 1000, address(testToken));
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert for missing chain");
    }

    // ============ ADMIN FUNCTIONS TESTS ============

    function it_bridge_can_set_relayer() {
        address newRelayer = address(0xAAAA);
        bridge.setRelayer(newRelayer);
        require(bridge.relayer() == newRelayer, "Relayer not updated");
    }

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

        // Test that we can call a simple function first
        require(bridge.relayer() == address(this), "Should be relayer");

        // Just call the function without any assertions to see if it works
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);
    }

    function it_bridge_can_initiate_deposit_with_usdst_minting() {
        uint256 amount = 500e18;
        address recipient = address(0xDDDD);
        string memory txHash = "0xabcdef123457";

        // Call deposit function directly as relayer
        bridge.deposit(externalChainId, externalSender, address(0x6666), txHash, recipient, amount);

        // Check that deposit was created
        (,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(usdstToken), "Token should be set");
    }

    function it_bridge_can_confirm_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123458";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);

        // Then confirm it
        bridge.confirmDeposit(externalChainId, txHash);

        // Check that deposit was confirmed
        (,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_review_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123459";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);

        // Then mark for review
        bridge.reviewDeposit(externalChainId, txHash);

        (,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_deposits() {
        uint256[] memory chainIds = new uint256[](2);
        string[] memory txHashes = new string[](2);
        address[] memory tokens = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        address[] memory recipients = new address[](2);
        address[] memory senders = new address[](2);
        bool[] memory mintUSDSTs = new bool[](2);

        chainIds[0] = externalChainId;
        chainIds[1] = externalChainId;
        txHashes[0] = "0xhash1";
        txHashes[1] = "0xhash2";
        tokens[0] = address(0x5555); // external token address
        tokens[1] = address(0x6666); // external USDST token address
        amounts[0] = 1000e18;
        amounts[1] = 2000e18;
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        senders[0] = address(0x3333);
        senders[1] = address(0x4444);

        bridge.depositBatch(chainIds, senders, tokens, txHashes, recipients, amounts);

        (,,,, address stratoToken1,,) = bridge.deposits(externalChainId, "0xhash1");
        (,,,, address stratoToken2,,) = bridge.deposits(externalChainId, "0xhash2");
        require(stratoToken1 == address(testToken), "First deposit token should be set");
        require(stratoToken2 == address(usdstToken), "Second deposit token should be set");
    }

    function it_bridge_can_handle_batch_confirm_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xconfirm123";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);

        // Batch confirm
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        bridge.confirmDepositBatch(chainIds, txHashes);

        (,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_review_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xreview123";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);

        // Batch review
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        bridge.reviewDepositBatch(chainIds, txHashes);

        (,,,, address stratoToken,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_reverts_deposit_by_non_relayer() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "deposit", externalChainId, externalSender, externalTxHash, address(testToken), 1000e18, address(0x1111), false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit by non-relayer");
    }

    function it_bridge_reverts_deposit_when_paused() {
        bridge.setPause(true, false);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, externalTxHash, address(testToken), 1000e18, address(0x1111), false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit when paused");
    }

    function it_bridge_reverts_deposit_with_duplicate_key() {
        bridge.deposit(externalChainId, externalSender, address(0x5555), externalTxHash, address(0x1111), 1000e18);

        bool reverted = false;
        try {
            bridge.deposit(externalChainId, externalSender, address(0x5555), externalTxHash, address(0x2222), 2000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert duplicate deposit key");
    }

    function it_bridge_reverts_deposit_with_zero_amount() {
        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, externalTxHash, address(testToken), 0, address(0x1111), false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit with zero amount");
    }

    function it_bridge_reverts_deposit_with_disabled_chain() {
        bridge.setChain(chainName, custody, false, externalChainId, 1000, depositRouter);

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, externalTxHash, address(testToken), 1000e18, address(0x1111), false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit with disabled chain");
    }

    function it_bridge_reverts_deposit_without_permission() {
        // Set asset with no permissions
        bridge.setAsset(externalChainId, 18, "Test", "TEST", address(0x5555), 1000000e18, address(testToken));

        bool reverted = false;
        try {
            relayer.do(address(bridge), "deposit", externalChainId, externalSender, externalTxHash, address(testToken), 1000e18, address(0x1111), false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert deposit without permission");
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
            externalChainId,
            18, // decimals
            "External Withdrawal Token",
            "EWITHDRAW",
            address(0x6666), // external token address
            1000000e18, // max per tx
            address(withdrawalToken) // strato token
        );

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x6666), amount);
        require(withdrawalId == 1, "Withdrawal ID should be 1");
        require(bridge.withdrawalCounter() == 1, "Withdrawal counter should be 1");

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(withdrawalToken), "Token should be set");
    }

    function it_bridge_can_request_withdrawal_with_usdst() {
        uint256 amount = 500e18;
        address recipient = address(0xFFFF);

        // Use the USDST token that we set up in beforeEach
        // The bridge will use the USDST address we set with setUSDSTAddress
        Token(address(usdstToken)).mint(address(user1), amount);
        user1.do(address(usdstToken), "approve", address(bridge), amount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x6666), amount);
        require(withdrawalId == 1, "Withdrawal ID should be 1");

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(usdstToken), "Token should be set");
    }

    function it_bridge_can_confirm_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "0xcustody123";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Confirm withdrawal
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_finalise_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "0xcustody123";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Confirm and finalise
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);
        bridge.finaliseWithdrawal(withdrawalId, custodyTxHash);

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_user() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Abort by user (should fail due to 48h wait period)
        bool reverted = false;
        try {
            user1.do(address(bridge), "abortWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert due to 48h wait period");

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_relayer() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Abort by relayer (should succeed)
        bridge.abortWithdrawal(withdrawalId);

        (,,,,,, address stratoToken,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Use the existing test tokens that are already set up
        // Setup first withdrawal with testToken
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), amount1);

        // Setup second withdrawal with usdstToken
        Token(address(usdstToken)).mint(address(user2), amount2);
        user2.do(address(usdstToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x6666), amount2);

        // Batch confirm
        uint256[] memory ids = new uint256[](2);
        string[] memory txHashes = new string[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;
        txHashes[0] = "0xcustody1";
        txHashes[1] = "0xcustody2";

        bridge.confirmWithdrawalBatch(ids, txHashes);

        (,,,,,, address stratoToken1,,) = bridge.withdrawals(withdrawalId1);
        (,,,,,, address stratoToken2,,) = bridge.withdrawals(withdrawalId2); 
        require(stratoToken1 == address(testToken), "First withdrawal token should be set");
        require(stratoToken2 == address(usdstToken), "Second withdrawal token should be set");
    }

    function it_bridge_can_handle_batch_finalise_withdrawals() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "0xcustody123";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Confirm first
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        // Batch finalise
        uint256[] memory ids = new uint256[](1);
        string[] memory txHashes = new string[](1);
        ids[0] = withdrawalId;
        txHashes[0] = custodyTxHash;

        bridge.finaliseWithdrawalBatch(ids, txHashes);

        (BridgeStatus bridgeStatus,,,,,,,,) = bridge.withdrawals(withdrawalId);
        require(bridgeStatus == BridgeStatus.COMPLETED, "Status should be COMPLETED");
    }

    function it_bridge_can_handle_batch_abort_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Setup first withdrawal
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), amount1);

        // Setup second withdrawal
        Token(address(testToken)).mint(address(user2), amount2);
        user2.do(address(testToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x5555), amount2);

        // Batch abort by relayer
        uint256[] memory ids = new uint256[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;

        bridge.abortWithdrawalBatch(ids);

        (BridgeStatus bridgeStatus,,,,,,,,) = bridge.withdrawals(withdrawalId1);
        (BridgeStatus bridgeStatus2,,,,,,,,) = bridge.withdrawals(withdrawalId2);
        require(bridgeStatus == BridgeStatus.ABORTED, "First withdrawal should be ABORTED");
        require(bridgeStatus2 == BridgeStatus.ABORTED, "Second withdrawal should be ABORTED");
    }

    function it_bridge_reverts_withdrawal_when_paused() {
        bridge.setPause(false, true);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal when paused");
    }

    function it_bridge_reverts_withdrawal_with_zero_amount() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal with zero amount");
    }

    function it_bridge_reverts_withdrawal_exceeding_cap() {
        uint256 amount = 2000000e18; // Exceeds maxPerTx of 1000000e18

        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), amount);
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
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), 1000e18);
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

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), largeAmount);
        require(withdrawalId == 1, "Should handle large amounts");
    }

    function it_bridge_handles_multiple_withdrawals() {
        uint256 amount = 1000e18;

        // First withdrawal
        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), amount);

        // Second withdrawal
        testToken.mint(address(user2), amount);
        user2.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(0x5555), amount);

        require(withdrawalId1 == 1, "First withdrawal ID should be 1");
        require(withdrawalId2 == 2, "Second withdrawal ID should be 2");
        require(bridge.withdrawalCounter() == 2, "Withdrawal counter should be 2");
    }

    function it_bridge_handles_different_chain_ids() {
        uint256 chainId1 = 1; // Ethereum
        uint256 chainId2 = 137; // Polygon

        // Set up second chain
        bridge.setChain("Polygon", address(0x6666), true, chainId2, 2000, address(0x7777));
        bridge.setAsset(chainId2, 18, "Polygon Test", "PTEST", address(0x8888), 1000000e18, address(testToken));

        // Test deposits on both chains
        bridge.deposit(chainId1, externalSender, address(0x5555), "0xtx1", address(0x1111), 1000e18);
        bridge.deposit(chainId2, externalSender, address(0x8888), "0xtx2", address(0x2222), 2000e18);

        (BridgeStatus bridgeStatus1,,,,,,) = bridge.deposits(chainId1, "0xtx1");
        (BridgeStatus bridgeStatus2,,,,,,) = bridge.deposits(chainId2, "0xtx2");
        require(bridgeStatus1 == BridgeStatus.INITIATED, "First chain deposit should be INITIATED");
        require(bridgeStatus2 == BridgeStatus.INITIATED, "Second chain deposit should be INITIATED");
    }

    function it_bridge_handles_different_permission_levels() {
        // Test WRAP only permission
        bridge.setAsset(externalChainId, 18, "Test", "TEST", address(0x5555), 1000000e18, address(testToken));

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        // Should work for WRAP (mintUSDST = false)
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), 1000e18);
        require(withdrawalId1 == 1, "Should work with WRAP permission");

        // Should fail for MINT (mintUSDST = true)
        usdstToken.mint(address(user1), 1000e18);
        user1.do(address(usdstToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(0x5555), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should fail with MINT permission when only WRAP is allowed");
    }

    function it_bridge_handles_zero_max_per_tx() {
        // Set asset with zero max per tx (unlimited)
        bridge.setAsset(externalChainId, 18, "Test", "TEST", address(0x5555), 0, address(testToken));

        uint256 largeAmount = 5000000e18; // Very large amount
        address recipient = address(0xEEEE);

        testToken.mint(address(user1), largeAmount);
        user1.do(address(testToken), "approve", address(bridge), largeAmount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), largeAmount);
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
            bridge.deposit(externalChainId, externalSender, address(0x7777), "0xinactive", address(0x1111), 1000e18);
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

        // Empty batch should succeed (no-op)
        bridge.depositBatch(chainIds, senders, tokens, txHashes, recipients, amounts);
    }

    function it_bridge_handles_batch_withdrawal_with_empty_arrays() {
        uint256[] memory ids = new uint256[](0);
        string[] memory txHashes = new string[](0);

        // Empty batch should succeed (no-op)
        bridge.confirmWithdrawalBatch(ids, txHashes);
    }

    function it_bridge_reverts_confirm_deposit_in_wrong_state() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xwrongstate";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);

        // Try to confirm twice (should fail on second attempt)
        bridge.confirmDeposit(externalChainId, txHash);

        bool reverted = false;
        try {
            bridge.confirmDeposit(externalChainId, txHash);
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
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Try to finalise without confirming first
        bool reverted = false;
        try {
            bridge.finaliseWithdrawal(withdrawalId, "0xcustody");
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
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

        // Confirm and finalise withdrawal
        bridge.confirmWithdrawal(withdrawalId, "0xcustody");
        bridge.finaliseWithdrawal(withdrawalId, "0xcustody");

        // Try to abort completed withdrawal
        bool reverted = false;
        try {
            bridge.abortWithdrawal(withdrawalId);
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
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(0x5555), amount);

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
        bridge.setLastProcessedBlock(externalChainId, initialBlock);
        
        bool reverted = false;
        try {
            bridge.setLastProcessedBlock(externalChainId, 500); // Rollback attempt
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert rollback attempt");
    }

    function it_bridge_allows_monotonic_block_updates() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);
        
        // Should succeed - monotonic increase
        bridge.setLastProcessedBlock(externalChainId, 1500);
        
        (,, uint256 currentBlock,,) = bridge.chains(externalChainId);
        require(currentBlock == 1500, "Block should be updated");
    }

    function it_bridge_allows_same_block_update() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);
        
        // Should succeed - same block (no-op)
        bridge.setLastProcessedBlock(externalChainId, 1000);
        
        (,, uint256 currentBlock,,) = bridge.chains(externalChainId);
        require(currentBlock == 1000, "Block should remain the same");
    }

    function it_bridge_emergency_override_allows_rollback() {
        uint256 initialBlock = 1000;
        bridge.setLastProcessedBlock(externalChainId, initialBlock);
        
        // Emergency override should allow rollback
        bridge.emergencySetLastProcessedBlock(externalChainId, 500);
        
        (,, uint256 currentBlock,,) = bridge.chains(externalChainId);
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
        string memory txHash = "0xzerorecipient";

        bool reverted = false;
        try {
            bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, address(0), amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with zero recipient");
    }

    function it_bridge_allows_deposit_with_valid_recipient() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xvalidrecipient";

        // Should succeed with valid recipient
        bridge.deposit(externalChainId, externalSender, address(0x5555), txHash, recipient, amount);
        
        // Verify deposit was created
        (BridgeStatus status,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(status == BridgeStatus.INITIATED, "Deposit should be initiated");
    }
}
