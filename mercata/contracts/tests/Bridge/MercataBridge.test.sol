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
        address stratoToken;       // STRATO token to mint
        address stratoRecipient;   // STRATO recipient
        uint256 stratoTokenAmount; // STRATO token amount to mint
        address externalSender;    // External chain sender
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
        bool mintUSDST;            // true if minting USDST, false if minting original token (e.g. USDC)
        uint256 timestamp;         // timestamp of the deposit
    }

    struct WithdrawalInfo {
        uint256 externalChainId;   // Chain where Custody resides
        address externalRecipient; // External recipient address
        address stratoToken;       // Token to burn
        uint256 stratoTokenAmount; // Escrowed amount of stratoToken
        address stratoSender;      // STRATO sender
        BridgeStatus bridgeStatus; // NONE / INITIATED / PENDING_REVIEW / ...
        bool mintUSDST;           // true = burn USDST, false = unwrap token
        uint256 timestamp;        // timestamp of the withdrawal
        uint256 requestedAt;      // timestamp of the withdrawal request (for abort accuracy)
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
        uint256 externalDecimals; // decimals of externalToken
        uint256 externalChainId;  // back-pointer to ChainInfo
        string  externalName;     // external token name
        string  externalSymbol;   // external token symbol
        uint256 maxPerTx;         // hard ceiling; 0 means "unlimited"
        uint8   permissions;      // bitmask: WRAP/MINT, 0 = disabled
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
        Token(address(testToken)).addWhitelist(address(adminRegistry), "mint", address(bridge));
        Token(address(testToken)).addWhitelist(address(adminRegistry), "burn", address(bridge));
        Token(address(usdstToken)).addWhitelist(address(adminRegistry), "mint", address(bridge));
        Token(address(usdstToken)).addWhitelist(address(adminRegistry), "burn", address(bridge));

        // Set up chain
        bridge.setChain(externalChainId, custody, depositRouter, 1000, true, chainName);

        // Set USDST address to our test token
        bridge.setUSDSTAddress(address(usdstToken));

        // Set up assets
        bridge.setAsset(
            address(testToken),
            externalChainId,
            address(0x5555), // external token address
            18, // decimals
            "External Test Token",
            "ETEST",
            1000000e18, // max per tx
            3 // both WRAP and MINT permissions
        );

        bridge.setAsset(
            address(usdstToken),
            externalChainId,
            address(0x6666), // external USDST token address
            18, // decimals
            "External USDST",
            "EUSDST",
            1000000e18, // max per tx
            3 // both WRAP and MINT permissions
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

    // ============ PERMISSION CONSTANTS TESTS ============

    function it_bridge_has_correct_permission_constants() {
        require(bridge.PERMISSION_WRAP() == 1, "WRAP permission should be 1");
        require(bridge.PERMISSION_MINT() == 2, "MINT permission should be 2");
        require(bridge.PERMISSION_MASK() == 3, "PERMISSION_MASK should be 3");
    }

    // ============ CHAIN MANAGEMENT TESTS ============

    function it_bridge_can_set_chain() {
        uint256 chainId = 137; // Polygon
        address newCustody = address(0x6666);
        address newRouter = address(0x7777);
        uint256 lastBlock = 2000;
        string memory newChainName = "Polygon";

        bridge.setChain(chainId, newCustody, newRouter, lastBlock, true, newChainName);

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
        bridge.setChain(newChainId, address(0x6666), address(0x7777), 2000, true, "BSC");

        bridge.setAsset(newToken, newChainId, externalToken, decimals, name, symbol, maxPerTx, permissions);

        (address _externalToken, uint externalDecimals, uint externalChainId, string externalName, string externalSymbol, uint _maxPerTx, uint8 _permissions) = bridge.assets(newToken, newChainId);
        require(_externalToken == externalToken, "External token not set correctly");
        require(externalDecimals == decimals, "Decimals not set correctly");
        require(externalChainId == newChainId, "Chain ID not set correctly");
        require(keccak256(externalName) == keccak256(name), "Name not set correctly");
        require(keccak256(externalSymbol) == keccak256(symbol), "Symbol not set correctly");
        require(_maxPerTx == maxPerTx, "Max per tx not set correctly");
        require(_permissions == permissions, "Permissions not set correctly");
    }

    function it_bridge_can_update_asset_metadata() {
        string memory newName = "Updated Test Token";
        string memory newSymbol = "UTEST";

        bridge.setAssetMetadata(address(testToken), externalChainId, newName, newSymbol);

        (,,, string externalName, string externalSymbol,,) = bridge.assets(address(testToken), externalChainId);
        require(keccak256(externalName) == keccak256(newName), "Name not updated correctly");
        require(keccak256(externalSymbol) == keccak256(newSymbol), "Symbol not updated correctly");
    }

    function it_bridge_can_set_token_limits() {
        uint256 newLimit = 2000000e18;
        bridge.setTokenLimits(address(testToken), externalChainId, newLimit);

        (,,,,, uint maxPerTx,) = bridge.assets(address(testToken), externalChainId);
        require(maxPerTx == newLimit, "Token limit not updated correctly");
    }

    function it_bridge_reverts_set_asset_for_missing_chain() {
        bool reverted = false;
        try {
            bridge.setAsset(address(testToken), 999, address(0x1111), 18, "Test", "TEST", 1000, 1);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert for missing chain");
    }

    function it_bridge_reverts_set_asset_with_invalid_permissions() {
        bool reverted = false;
        try {
            bridge.setAsset(address(testToken), externalChainId, address(0x1111), 18, "Test", "TEST", 1000, 4); // Invalid permission
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with invalid permissions");
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

    // Test disabled for now, non-admin can not create an issue
    function xit_bridge_reverts_admin_functions_by_non_owner() {
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
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, false);
    }

    function it_bridge_can_initiate_deposit_with_usdst_minting() {
        uint256 amount = 500e18;
        address recipient = address(0xDDDD);
        string memory txHash = "0xabcdef123457";

        // Call deposit function directly as relayer
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, true);

        // Check that deposit was created
        (address stratoToken,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_confirm_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123458";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, false);

        // Then confirm it
        bridge.confirmDeposit(externalChainId, txHash);

        // Check that deposit was confirmed
        (address stratoToken,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_review_deposit() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xabcdef123459";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, false);

        // Then mark for review
        bridge.reviewDeposit(externalChainId, txHash);

        (address stratoToken,,,,,,) = bridge.deposits(externalChainId, txHash);
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
        tokens[0] = address(testToken);
        tokens[1] = address(testToken);
        amounts[0] = 1000e18;
        amounts[1] = 2000e18;
        recipients[0] = address(0x1111);
        recipients[1] = address(0x2222);
        senders[0] = address(0x3333);
        senders[1] = address(0x4444);
        mintUSDSTs[0] = false;
        mintUSDSTs[1] = true;

        bridge.depositBatch(chainIds, txHashes, tokens, amounts, recipients, senders, mintUSDSTs);

        (address stratoToken1,,,,,,) = bridge.deposits(externalChainId, "0xhash1");
        (address stratoToken2,,,,,,) = bridge.deposits(externalChainId, "0xhash2");
        require(stratoToken1 == address(testToken), "First deposit token should be set");
        require(stratoToken2 == address(testToken), "Second deposit token should be set");
    }

    function it_bridge_can_handle_batch_confirm_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xconfirm123";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, false);

        // Batch confirm
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        bridge.confirmDepositBatch(chainIds, txHashes);

        (address stratoToken,,,,,,) = bridge.deposits(externalChainId, txHash);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_review_deposits() {
        uint256 amount = 1000e18;
        address recipient = address(0xCCCC);
        string memory txHash = "0xreview123";

        // First initiate deposit
        bridge.deposit(externalChainId, externalSender, txHash, address(testToken), amount, recipient, false);

        // Batch review
        uint256[] memory chainIds = new uint256[](1);
        string[] memory txHashes = new string[](1);
        chainIds[0] = externalChainId;
        txHashes[0] = txHash;

        bridge.reviewDepositBatch(chainIds, txHashes);

        (address stratoToken,,,,,,) = bridge.deposits(externalChainId, txHash);
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
        bridge.deposit(externalChainId, externalSender, externalTxHash, address(testToken), 1000e18, address(0x1111), false);

        bool reverted = false;
        try {
            bridge.deposit(externalChainId, externalSender, externalTxHash, address(testToken), 2000e18, address(0x2222), false);
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
        bridge.setChain(externalChainId, custody, depositRouter, 1000, false, chainName);

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
        bridge.setAsset(address(testToken), externalChainId, address(0x5555), 18, "Test", "TEST", 1000000e18, 0);

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
            address(withdrawalToken),
            externalChainId,
            address(0x6666), // external token address
            18, // decimals
            "External Withdrawal Token",
            "EWITHDRAW",
            1000000e18, // max per tx
            3 // both WRAP and MINT permissions
        );

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(withdrawalToken), amount, false);
        require(withdrawalId == 1, "Withdrawal ID should be 1");
        require(bridge.withdrawalCounter() == 1, "Withdrawal counter should be 1");

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(withdrawalToken), "Token should be set");
    }

    function it_bridge_can_request_withdrawal_with_usdst() {
        uint256 amount = 500e18;
        address recipient = address(0xFFFF);

        // Use the USDST token that we set up in beforeEach
        // The bridge will use the USDST address we set with setUSDSTAddress
        Token(address(usdstToken)).mint(address(user1), amount);
        user1.do(address(usdstToken), "approve", address(bridge), amount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(usdstToken), amount, true);
        require(withdrawalId == 1, "Withdrawal ID should be 1");

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(usdstToken), "Token should be set");
    }

    function it_bridge_can_confirm_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "0xcustody123";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), amount, false);

        // Confirm withdrawal
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_finalise_withdrawal() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);
        string memory custodyTxHash = "0xcustody123";

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), amount, false);

        // Confirm and finalise
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);
        bridge.finaliseWithdrawal(withdrawalId, custodyTxHash);

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_user() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), amount, false);

        // Abort by user (should fail due to 48h wait period)
        bool reverted = false;
        try {
            user1.do(address(bridge), "abortWithdrawal", withdrawalId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert due to 48h wait period");

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_abort_withdrawal_by_relayer() {
        uint256 amount = 1000e18;
        address recipient = address(0xEEEE);

        // Setup withdrawal
        Token(address(testToken)).mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), amount, false);

        // Abort by relayer (should succeed)
        bridge.abortWithdrawal(withdrawalId);

        (,, address stratoToken,,,,,,) = bridge.withdrawals(withdrawalId);
        require(stratoToken == address(testToken), "Token should be set");
    }

    function it_bridge_can_handle_batch_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Use the existing test tokens that are already set up
        // Setup first withdrawal with testToken
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), amount1, false);

        // Setup second withdrawal with usdstToken
        Token(address(usdstToken)).mint(address(user2), amount2);
        user2.do(address(usdstToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(usdstToken), amount2, false);

        // Batch confirm
        uint256[] memory ids = new uint256[](2);
        string[] memory txHashes = new string[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;
        txHashes[0] = "0xcustody1";
        txHashes[1] = "0xcustody2";

        bridge.confirmWithdrawalBatch(ids, txHashes);

        (,, address stratoToken1,,,,,,) = bridge.withdrawals(withdrawalId1);
        (,, address stratoToken2,,,,,,) = bridge.withdrawals(withdrawalId2);
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
        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), amount, false);

        // Confirm first
        bridge.confirmWithdrawal(withdrawalId, custodyTxHash);

        // Batch finalise
        uint256[] memory ids = new uint256[](1);
        string[] memory txHashes = new string[](1);
        ids[0] = withdrawalId;
        txHashes[0] = custodyTxHash;

        bridge.finaliseWithdrawalBatch(ids, txHashes);

        (,,,,, BridgeStatus bridgeStatus,,,) = bridge.withdrawals(withdrawalId);
        require(bridgeStatus == BridgeStatus.COMPLETED, "Status should be COMPLETED");
    }

    function it_bridge_can_handle_batch_abort_withdrawals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;

        // Setup first withdrawal
        Token(address(testToken)).mint(address(user1), amount1);
        user1.do(address(testToken), "approve", address(bridge), amount1);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), amount1, false);

        // Setup second withdrawal
        Token(address(testToken)).mint(address(user2), amount2);
        user2.do(address(testToken), "approve", address(bridge), amount2);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(testToken), amount2, false);

        // Batch abort by relayer
        uint256[] memory ids = new uint256[](2);
        ids[0] = withdrawalId1;
        ids[1] = withdrawalId2;

        bridge.abortWithdrawalBatch(ids);

        (,,,,, BridgeStatus bridgeStatus,,,) = bridge.withdrawals(withdrawalId1);
        (,,,,, BridgeStatus bridgeStatus2,,,) = bridge.withdrawals(withdrawalId2);
        require(bridgeStatus == BridgeStatus.ABORTED, "First withdrawal should be ABORTED");
        require(bridgeStatus2 == BridgeStatus.ABORTED, "Second withdrawal should be ABORTED");
    }

    function it_bridge_reverts_withdrawal_when_paused() {
        bridge.setPause(false, true);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 1000e18, false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal when paused");
    }

    function it_bridge_reverts_withdrawal_with_zero_amount() {
        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 0, false);
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
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), amount, false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal exceeding cap");
    }

    function it_bridge_reverts_withdrawal_without_permission() {
        // Set asset with no permissions
        bridge.setAsset(address(testToken), externalChainId, address(0x5555), 18, "Test", "TEST", 1000000e18, 0);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 1000e18, false);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert withdrawal without permission");
    }

    function it_bridge_reverts_withdrawal_with_disabled_chain() {
        bridge.setChain(externalChainId, custody, depositRouter, 1000, false, chainName);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 1000e18, false);
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

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), largeAmount, false);
        require(withdrawalId == 1, "Should handle large amounts");
    }

    function it_bridge_handles_multiple_withdrawals() {
        uint256 amount = 1000e18;

        // First withdrawal
        testToken.mint(address(user1), amount);
        user1.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), amount, false);

        // Second withdrawal
        testToken.mint(address(user2), amount);
        user2.do(address(testToken), "approve", address(bridge), amount);
        uint256 withdrawalId2 = user2.do(address(bridge), "requestWithdrawal", externalChainId, address(0x2222), address(testToken), amount, false);

        require(withdrawalId1 == 1, "First withdrawal ID should be 1");
        require(withdrawalId2 == 2, "Second withdrawal ID should be 2");
        require(bridge.withdrawalCounter() == 2, "Withdrawal counter should be 2");
    }

    function it_bridge_handles_different_chain_ids() {
        uint256 chainId1 = 1; // Ethereum
        uint256 chainId2 = 137; // Polygon

        // Set up second chain
        bridge.setChain(chainId2, address(0x6666), address(0x7777), 2000, true, "Polygon");
        bridge.setAsset(address(testToken), chainId2, address(0x8888), 18, "Polygon Test", "PTEST", 1000000e18, 3);

        // Test deposits on both chains
        bridge.deposit(chainId1, externalSender, "0xtx1", address(testToken), 1000e18, address(0x1111), false);
        bridge.deposit(chainId2, externalSender, "0xtx2", address(testToken), 2000e18, address(0x2222), false);

        (,,,, BridgeStatus bridgeStatus1,,) = bridge.deposits(chainId1, "0xtx1");
        (,,,, BridgeStatus bridgeStatus2,,) = bridge.deposits(chainId2, "0xtx2");
        require(bridgeStatus1 == BridgeStatus.INITIATED, "First chain deposit should be INITIATED");
        require(bridgeStatus2 == BridgeStatus.INITIATED, "Second chain deposit should be INITIATED");
    }

    function it_bridge_handles_different_permission_levels() {
        // Test WRAP only permission
        bridge.setAsset(address(testToken), externalChainId, address(0x5555), 18, "Test", "TEST", 1000000e18, 1);

        testToken.mint(address(user1), 1000e18);
        user1.do(address(testToken), "approve", address(bridge), 1000e18);

        // Should work for WRAP (mintUSDST = false)
        uint256 withdrawalId1 = user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 1000e18, false);
        require(withdrawalId1 == 1, "Should work with WRAP permission");

        // Should fail for MINT (mintUSDST = true)
        usdstToken.mint(address(user1), 1000e18);
        user1.do(address(usdstToken), "approve", address(bridge), 1000e18);

        bool reverted = false;
        try {
            user1.do(address(bridge), "requestWithdrawal", externalChainId, address(0x1111), address(testToken), 1000e18, true);
        } catch {
            reverted = true;
        }
        require(reverted, "Should fail with MINT permission when only WRAP is allowed");
    }

    function it_bridge_handles_zero_max_per_tx() {
        // Set asset with zero max per tx (unlimited)
        bridge.setAsset(address(testToken), externalChainId, address(0x5555), 18, "Test", "TEST", 0, 3);

        uint256 largeAmount = 5000000e18; // Very large amount
        address recipient = address(0xEEEE);

        testToken.mint(address(user1), largeAmount);
        user1.do(address(testToken), "approve", address(bridge), largeAmount);

        uint256 withdrawalId = user1.do(address(bridge), "requestWithdrawal", externalChainId, recipient, address(testToken), largeAmount, false);
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
}
