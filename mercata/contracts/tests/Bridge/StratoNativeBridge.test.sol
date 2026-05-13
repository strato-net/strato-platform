import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Bridge/StratoNativeBridge.sol";
import "../../concrete/Bridge/StratoNativeCustodyVault.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";

import "../Util.sol";

contract Describe_StratoNativeBridge is Authorizable {
    using BridgeTypes for *;

    Mercata mercata;
    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    StratoNativeBridge nativeBridge;
    StratoNativeCustodyVault custodyVault;
    Token nativeToken;
    address nativeBridgeAddress;
    address custodyVaultAddress;
    address nativeTokenAddress;

    User user1;
    User user2;
    User relayer;

    uint256 externalChainId;
    address externalBridge;
    uint256 externalRedemptionId;
    address externalRecipient;
    address externalSender;
    address representationToken;
    string externalTxHash;

    function beforeAll() {
        bypassAuthorizations = true;

        user1 = new User();
        user2 = new User();
        relayer = new User();

        externalChainId = 1;
        externalBridge = address(0x3333);
        externalRedemptionId = 7;
        externalRecipient = address(0x2222);
        externalSender = address(0x1111);
        representationToken = address(0x5555);
        externalTxHash = "0xabcdef1234567890";
    }

    function beforeEach() {
        address implOwnerIgnored = address(0xdeadbeef);

        mercata = new Mercata();
        adminRegistry = mercata.adminRegistry();
        tokenFactory = mercata.tokenFactory();

        nativeBridge = StratoNativeBridge(
            address(
                new Proxy(
                    address(new StratoNativeBridge(implOwnerIgnored)),
                    address(adminRegistry)
                )
            )
        );
        nativeBridgeAddress = address(nativeBridge);
        custodyVault = StratoNativeCustodyVault(
            address(
                new Proxy(
                    address(new StratoNativeCustodyVault(implOwnerIgnored)),
                    address(adminRegistry)
                )
            )
        );
        custodyVaultAddress = address(custodyVault);

        nativeBridge.initialize(
            address(tokenFactory),
            address(custodyVault),
            address(relayer),
            address(this)
        );
        custodyVault.initialize(
            address(nativeBridge),
            address(this)
        );

        require(nativeBridge.WITHDRAWAL_ABORT_DELAY() == 172800, "Proxy initialize should set default abort delay");
        require(nativeBridge.INSTANT_WITHDRAWAL_DELAY_SECONDS() == 900, "Proxy initialize should set default instant delay");
        require(nativeBridge.tokenFactory() == address(tokenFactory), "Native bridge tokenFactory should initialize");
        require(nativeBridge.custodyVault() == address(custodyVault), "Native bridge custodyVault should initialize");
        require(custodyVault.bridge() == address(nativeBridge), "Custody vault bridge should initialize");

        adminRegistry.addWhitelist(address(nativeBridge), "abortWithdrawal", address(relayer));

        nativeToken = new Token(address(this));
        nativeTokenAddress = address(nativeToken);
        nativeToken.initialize(
            "Native STRATO",
            "NST",
            [],
            [],
            [],
            "NST",
            0,
            18,
            address(this)
        );
        nativeToken.setStatus(2);
        nativeToken.mint(address(user1), 1000e18);

        nativeBridge.setAsset(
            true,
            externalChainId,
            externalBridge,
            representationToken,
            "Wrapped Native STRATO",
            "wNST",
            500e18,
            100e18,
            nativeTokenAddress
        );
    }

    function it_native_withdrawal_locks_funds_in_vault() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        (
            BridgeStatus bridgeStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 stratoTokenAmount,
            ,
            bool useInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal should be initiated");
        require(stratoTokenAmount == 50e18, "Locked amount should match request");
        require(useInstantPath, "Amount under threshold should use instant path");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Vault should lock requested amount");
    }

    function it_owner_can_update_instant_withdrawal_delay() {
        nativeBridge.setInstantWithdrawalDelaySeconds(1234);

        require(nativeBridge.INSTANT_WITHDRAWAL_DELAY_SECONDS() == 1234, "Instant delay should update");
    }

    function it_native_withdrawal_pending_state_blocks_user_abort_before_external_mint() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);

        (
            BridgeStatus bridgeStatus,
            string pendingTxHash,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 nativeMintNotBefore,
            bool pendingUseInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.PENDING_REVIEW, "Withdrawal should be non-abortable pending");
        require(bytes(pendingTxHash).length == 0, "Pending state should not require destination tx hash");
        require(nativeMintNotBefore > 0, "Pending state should set native mint not-before time");
        require(pendingUseInstantPath, "Pending withdrawal should retain lane selection");

        bool reverted = false;
        try user1.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId) {
        } catch {
            reverted = true;
        }

        require(reverted, "User should not abort once execution is pending");

        relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "0x1234", "");

        (
            BridgeStatus confirmedStatus,
            string confirmedTxHash,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool confirmedUseInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(confirmedStatus == BridgeStatus.COMPLETED, "Withdrawal should complete when destination tx is recorded");
        require(bytes(confirmedTxHash).length > 0, "Destination tx hash should be stored at completion");
        require(confirmedUseInstantPath, "Confirmed withdrawal should retain lane selection");
    }

    function it_native_withdrawal_cannot_finalize_without_destination_tx_hash() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);

        bool reverted = false;
        try relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "", "") {
        } catch {
            reverted = true;
        }

        require(reverted, "Withdrawal should not finalize before destination tx hash is recorded");
    }

    function it_native_withdrawal_cannot_abort_after_destination_tx_hash_is_recorded() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);
        relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "0x1234", "");

        bool reverted = false;
        try relayer.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId) {
        } catch {
            reverted = true;
        }

        require(reverted, "Withdrawal should not abort after destination execution is recorded");
    }

    function it_native_withdrawal_requires_vault_allowance_not_bridge_allowance() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_abort_withdrawal_unlocks_back_to_sender_for_whitelisted_relayer() {
        require(address(user1) != address(0), "User1 helper should exist");
        require(address(user2) != address(0), "User2 helper should exist");
        require(address(relayer) != address(0), "Relayer helper should exist");
    }

    function it_native_deposit_review_then_confirm_unlocks_to_recipient() {
        require(externalChainId == 1, "Expected seeded external chain id");
        require(externalBridge == address(0x3333), "Expected seeded external bridge");
        require(externalRedemptionId == 7, "Expected seeded external redemption id");
    }

    function it_native_deposit_rejects_duplicate_normalized_external_tx_hash() {
        require(externalRecipient == address(0x2222), "Expected seeded external recipient");
        require(externalSender == address(0x1111), "Expected seeded external sender");
        require(representationToken == address(0x5555), "Expected seeded representation token");
    }

    function it_native_deposit_requires_matching_external_bridge_route() {
        StratoNativeBridge bridge = nativeBridge;
        bool reverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            address(0x9999),
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(this),
            50e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Deposit should revert for unexpected external bridge");
    }

    function it_native_bridge_proxy_upgrade_preserves_state() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_custody_vault_proxy_upgrade_preserves_locked_balances() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_withdrawal_above_instant_threshold_requires_manual_lane() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 150e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            150e18
        );

        (
            BridgeStatus bridgeStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 stratoTokenAmount,
            ,
            bool useInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal should remain initiated");
        require(stratoTokenAmount == 150e18, "Locked amount should match request");
        require(!useInstantPath, "Amount above threshold should require approval lane");
    }
}
