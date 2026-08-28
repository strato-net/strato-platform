import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Admin/FeeCollector.sol";
import "../../concrete/Bridge/ExternalAssetBridge.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../../concrete/Metals/MetalForge.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../libraries/Bridge/ExternalBridgeTypes.sol";

contract ExternalBridgeUser {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_ExternalAssetBridge is Authorizable {
    using ExternalBridgeTypes for *;

    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    ExternalAssetBridge bridge;
    Token stratoToken;
    Token metalToken;
    SaveUSDSTVault saveVault;
    MetalForge metalForge;
    ExternalBridgeUser user;
    ExternalBridgeUser relayer;

    uint256 externalChainId;
    address externalToken;
    address externalRecipient;
    address externalVault;
    address depositRouter;

    function beforeAll() {
        bypassAuthorizations = true;
        externalChainId = 1;
        externalToken = address(0x5555);
        externalRecipient = address(0x2222);
        externalVault = address(0x3333);
        depositRouter = address(0x4444);
    }

    function beforeEach() {
        adminRegistry = new AdminRegistry();
        address[] admins = [address(this)];
        adminRegistry.initialize(admins);
        tokenFactory = new TokenFactory(address(adminRegistry));
        user = new ExternalBridgeUser();
        relayer = new ExternalBridgeUser();

        bridge = ExternalAssetBridge(
            address(
                new Proxy(
                    address(new ExternalAssetBridge(address(0xdeadbeef))),
                    address(adminRegistry)
                )
            )
        );

        stratoToken = Token(
            tokenFactory.createTokenWithInitialOwner(
                "External USD",
                "xUSD",
                [],
                [],
                [],
                "xUSD",
                0,
                18,
                address(adminRegistry)
            )
        );
        stratoToken.setStatus(2);
        metalToken = Token(
            tokenFactory.createTokenWithInitialOwner(
                "Gold",
                "GOLD",
                [],
                [],
                [],
                "GOLD",
                0,
                18,
                address(adminRegistry)
            )
        );
        metalToken.setStatus(2);

        bridge.initialize(
            address(tokenFactory),
            address(relayer),
            address(user),
            address(stratoToken)
        );
        bridge.setChain(
            "External",
            externalVault,
            depositRouter,
            true,
            externalChainId,
            100
        );
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            true,
            18,
            "External USD",
            "xUSD",
            true,
            1000e18,
            100e18
        );

        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(stratoToken),
            "mint",
            address(bridge)
        );
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(stratoToken),
            "burn",
            address(bridge)
        );

        saveVault = new SaveUSDSTVault(address(this));
        saveVault.initialize(
            address(stratoToken),
            "Save External USD",
            "savexUSD"
        );
        bridge.setSaveUsdstVault(address(saveVault));
        bridge.setDepositAction(
            externalToken,
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_SAVE),
            true
        );

        PriceOracle oracle = new PriceOracle(address(this));
        oracle.initialize();
        FeeCollector feeCollector = new FeeCollector(address(this));
        metalForge = new MetalForge(address(this));
        metalForge.initialize(
            address(oracle),
            address(0xdead),
            address(feeCollector),
            address(stratoToken)
        );
        oracle.setAssetPrice(address(metalToken), 2000e18);
        metalForge.setMetalConfig(
            address(metalToken),
            true,
            1000000e18,
            0
        );
        metalForge.setPayToken(address(stratoToken), true);
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(metalToken),
            "mint",
            address(metalForge)
        );
        bridge.setMetalForge(address(metalForge));
        bridge.setDepositAction(
            externalToken,
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_FORGE),
            true
        );
    }

    function it_initializes_once_with_separate_operator_and_guardian() {
        require(bridge.initialized(), "Bridge should initialize");
        require(
            bridge.bridgeOperator() == address(relayer),
            "Operator should initialize"
        );
        require(
            bridge.guardian() == address(user),
            "Guardian should initialize"
        );

        bool reverted = false;
        try bridge.initialize(
            address(tokenFactory),
            address(relayer),
            address(user),
            address(stratoToken)
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Second initialization should revert");
    }

    function it_records_and_confirms_a_plain_deposit() {
        relayer.do(
            address(bridge),
            "deposit",
            externalChainId,
            address(0x1111),
            externalToken,
            25e18,
            "0xABCDEF",
            address(user),
            address(stratoToken)
        );
        relayer.do(
            address(bridge),
            "confirmDeposit",
            externalChainId,
            "0xabcdef"
        );

        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Recipient should receive minted route token"
        );
        (
            Status status,
            ,
            ,
            ,
            ,
            ,
            ,
            ,

        ) = bridge.deposits(externalChainId, "0xabcdef");
        require(
            status == Status.COMPLETED,
            "Deposit should complete"
        );
    }

    function it_preserves_action_intent_and_falls_back_to_route_token() {
        bridge.setDepositAction(
            externalToken,
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_SAVE),
            false
        );
        relayer.do(
            address(bridge),
            "depositWithAction",
            externalChainId,
            address(0x1111),
            externalToken,
            10e18,
            "0x1234",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_SAVE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "confirmDeposit",
            externalChainId,
            "0x1234"
        );

        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Failed optional action should mint fallback token"
        );
        (
            uint256 action,
            ,

        ) = bridge.depositActions(externalChainId, "0x1234");
        require(action == 0, "Completed action intent should be deleted");
    }

    function it_executes_auto_save_and_delivers_shares_to_the_recipient() {
        relayer.do(
            address(bridge),
            "depositWithAction",
            externalChainId,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_SAVE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "confirmDeposit",
            externalChainId,
            "0x2345"
        );

        require(
            saveVault.balanceOf(address(user)) == 10e18,
            "AUTO_SAVE should deliver vault shares"
        );
        require(
            stratoToken.balanceOf(address(user)) == 0,
            "AUTO_SAVE should not deliver fallback tokens"
        );
    }

    function it_executes_auto_forge_and_delivers_metal_to_the_recipient() {
        relayer.do(
            address(bridge),
            "depositWithAction",
            externalChainId,
            address(0x1111),
            externalToken,
            2000e18,
            "0x3456",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_FORGE),
            address(metalToken),
            0
        );
        relayer.do(
            address(bridge),
            "confirmDeposit",
            externalChainId,
            "0x3456"
        );

        require(
            metalToken.balanceOf(address(user)) > 0,
            "AUTO_FORGE should deliver metal"
        );
        require(
            stratoToken.balanceOf(address(user)) == 0,
            "AUTO_FORGE should not deliver fallback tokens"
        );
    }

    function it_keeps_deposit_and_withdrawal_route_controls_independent() {
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            false,
            18,
            "External USD",
            "xUSD",
            true,
            1000e18,
            100e18
        );

        relayer.do(
            address(bridge),
            "deposit",
            externalChainId,
            address(0x1111),
            externalToken,
            5e18,
            "0x5678",
            address(user),
            address(stratoToken)
        );

        bool reverted = false;
        try user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            5e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Disabled withdrawal should revert");
    }

    function it_allows_guardian_pause_but_only_owner_unpause() {
        user.do(address(bridge), "setPause", true, true);
        require(bridge.depositsPaused(), "Guardian should pause deposits");
        require(
            bridge.withdrawalsPaused(),
            "Guardian should pause withdrawals"
        );

        bool reverted = false;
        try user.do(address(bridge), "setPause", false, false) {
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian should not unpause");

        adminRegistry.castVoteOnIssue(
            address(bridge),
            "setPause",
            false,
            false
        );
        require(!bridge.depositsPaused(), "Owner should unpause deposits");
        require(
            !bridge.withdrawalsPaused(),
            "Owner should unpause withdrawals"
        );
    }

    function it_moves_withdrawal_from_escrow_to_ready_then_burns_after_release() {
        stratoToken.mint(address(user), 200e18);
        user.do(address(stratoToken), "approve", address(bridge), 200e18);

        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            150e18
        );

        (
            Status requestedStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool requiresManualReview,
            ,
            ,
            ,

        ) = bridge.withdrawals(withdrawalId);
        require(
            requestedStatus == Status.INITIATED,
            "Withdrawal should be requested"
        );
        require(
            requiresManualReview,
            "Amount above threshold should require review"
        );
        require(
            stratoToken.balanceOf(address(bridge)) == 150e18,
            "Bridge should escrow representation"
        );

        uint256 deadline = block.timestamp + 1800;
        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 7 * 24 * 60 * 60,
            "0xbbbb"
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            deadline,
            1
        );
        (
            uint256 authorizationNotBefore,
            uint256 authorizationDeadline,
            uint256 signerSetVersion
        ) = bridge.withdrawalAuthorizations(withdrawalId);
        require(
            authorizationNotBefore == block.timestamp &&
                authorizationDeadline == deadline &&
                signerSetVersion == 1,
            "Withdrawal authorization should be persisted"
        );
        relayer.do(
            address(bridge),
            "recordWithdrawalReservation",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        );
        relayer.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xcccc"
        );

        (
            Status completedStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            string externalTxHash,

        ) = bridge.withdrawals(withdrawalId);
        require(
            completedStatus == Status.COMPLETED,
            "Withdrawal should complete"
        );
        require(
            externalTxHash == "0xcccc",
            "External release hash should be recorded"
        );
        require(
            stratoToken.balanceOf(address(bridge)) == 0,
            "Escrow should burn only after release"
        );
        bool refundReverted = false;
        try
            adminRegistry.castVoteOnIssue(
                address(bridge),
                "refundWithdrawal",
                withdrawalId
            )
        {
        } catch {
            refundReverted = true;
        }
        require(
            refundReverted,
            "Completed withdrawal should never be refundable"
        );
    }

    function it_records_and_rejects_large_withdrawal_review() {
        stratoToken.mint(address(user), 200e18);
        user.do(address(stratoToken), "approve", address(bridge), 200e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            150e18
        );

        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 7 * 24 * 60 * 60,
            "0xbbbb"
        );
        (
            string reviewDigest,
            uint256 approvalDeadline,
            string proposalHash
        ) = bridge.withdrawalManualReviews(withdrawalId);
        (Status pendingStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            pendingStatus == Status.PENDING_REVIEW &&
                reviewDigest == "0xaaaa" &&
                approvalDeadline == block.timestamp + 7 * 24 * 60 * 60 &&
                proposalHash == "0xbbbb",
            "Manual review should be persisted"
        );

        relayer.do(
            address(bridge),
            "rejectWithdrawalReview",
            withdrawalId
        );
        (Status rejectedStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            rejectedStatus == Status.ABORTED,
            "Rejected withdrawal should abort"
        );
        require(
            stratoToken.balanceOf(address(user)) == 200e18,
            "Rejected withdrawal should refund escrow"
        );
    }

    function it_allows_requested_reclaim_but_blocks_ready_reclaim() {
        stratoToken.mint(address(user), 100e18);
        user.do(address(stratoToken), "approve", address(bridge), 100e18);
        bridge.setWithdrawalAbortDelay(0);

        uint256 requestedId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        user.do(address(bridge), "abortWithdrawal", requestedId);

        uint256 readyId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            readyId,
            block.timestamp,
            block.timestamp + 1800,
            1
        );

        bool reverted = false;
        try user.do(address(bridge), "abortWithdrawal", readyId) {
        } catch {
            reverted = true;
        }
        require(reverted, "Ready withdrawal should not be reclaimable");
    }

    function it_does_not_finalize_without_a_matching_vault_reservation() {
        stratoToken.mint(address(user), 25e18);
        user.do(address(stratoToken), "approve", address(bridge), 25e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            block.timestamp + 1800,
            1
        );

        bool reverted = false;
        try relayer.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unreserved withdrawal should not finalize");
        require(
            stratoToken.balanceOf(address(bridge)) == 25e18,
            "Failed finalization should preserve escrow"
        );
    }
}
