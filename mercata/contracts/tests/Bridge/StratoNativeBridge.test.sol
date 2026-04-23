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

    User user1;
    User user2;
    User relayer;

    uint256 externalChainId;
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
        custodyVault = StratoNativeCustodyVault(
            address(
                new Proxy(
                    address(new StratoNativeCustodyVault(implOwnerIgnored)),
                    address(adminRegistry)
                )
            )
        );

        nativeBridge.initialize(address(tokenFactory), address(custodyVault));
        custodyVault.initialize(address(nativeBridge));

        require(nativeBridge.WITHDRAWAL_ABORT_DELAY() == 172800, "Proxy initialize should set default abort delay");

        adminRegistry.addWhitelist(address(nativeBridge), "abortWithdrawal", address(relayer));

        nativeToken = Token(
            tokenFactory.createTokenWithInitialOwner(
                "Native STRATO",
                "NST",
                [],
                [],
                [],
                "NST",
                0,
                18,
                address(adminRegistry)
            )
        );
        nativeToken.setStatus(2);
        nativeToken.mint(address(user1), 1000e18);

        nativeBridge.setAsset(
            true,
            externalChainId,
            representationToken,
            "Wrapped Native STRATO",
            "wNST",
            500e18,
            address(nativeToken)
        );
    }

    function it_native_withdrawal_locks_funds_in_vault() {
        uint256 amount = 200e18;

        user1.do(address(nativeToken), "approve", address(custodyVault), amount);

        uint256 userBalanceBefore = nativeToken.balanceOf(address(user1));
        uint256 vaultBalanceBefore = nativeToken.balanceOf(address(custodyVault));

        user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        );

        uint256 userBalanceAfter = nativeToken.balanceOf(address(user1));
        uint256 vaultBalanceAfter = nativeToken.balanceOf(address(custodyVault));

        require(userBalanceAfter == userBalanceBefore - amount, "User balance should decrease by locked amount");
        require(vaultBalanceAfter == vaultBalanceBefore + amount, "Vault balance should increase by locked amount");
        require(custodyVault.lockedBalance(address(nativeToken)) == amount, "Locked balance should track withdrawal");
        require(nativeBridge.withdrawalCounter() == 1, "Withdrawal counter should increment");

        (BridgeStatus bridgeStatus,,uint256 recordedExternalChainId,address recordedExternalRecipient,address recordedRepresentationToken,uint256 recordedExternalAmount,,address recordedSender,address recordedStratoToken,uint256 recordedStratoAmount,) = nativeBridge.withdrawals(1);

        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal should start initiated");
        require(recordedExternalChainId == externalChainId, "External chain id not recorded");
        require(recordedExternalRecipient == externalRecipient, "External recipient not recorded");
        require(recordedRepresentationToken == representationToken, "Representation token not recorded");
        require(recordedExternalAmount == amount, "External amount not recorded");
        require(recordedSender == address(user1), "Sender not recorded");
        require(recordedStratoToken == address(nativeToken), "STRATO token not recorded");
        require(recordedStratoAmount == amount, "STRATO amount not recorded");
    }

    function it_native_withdrawal_requires_vault_allowance_not_bridge_allowance() {
        uint256 amount = 100e18;

        user1.do(address(nativeToken), "approve", address(nativeBridge), amount);

        bool reverted = false;
        try user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Withdrawal should revert when only the bridge has allowance");
        require(custodyVault.lockedBalance(address(nativeToken)) == 0, "Vault should not lock funds on failed withdrawal");
    }

    function it_native_abort_withdrawal_unlocks_back_to_sender_for_whitelisted_relayer() {
        uint256 amount = 150e18;

        user1.do(address(nativeToken), "approve", address(custodyVault), amount);
        user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        );

        uint256 userBalanceAfterLock = nativeToken.balanceOf(address(user1));

        relayer.do(address(nativeBridge), "abortWithdrawal", 1);

        (BridgeStatus bridgeStatus,,,,,,,,,,) = nativeBridge.withdrawals(1);

        require(bridgeStatus == BridgeStatus.ABORTED, "Withdrawal should be aborted");
        require(nativeToken.balanceOf(address(user1)) == userBalanceAfterLock + amount, "Aborted withdrawal should return funds");
        require(nativeToken.balanceOf(address(custodyVault)) == 0, "Vault should release funds after abort");
        require(custodyVault.lockedBalance(address(nativeToken)) == 0, "Locked balance should clear after abort");
    }

    function it_native_deposit_review_then_confirm_unlocks_to_recipient() {
        uint256 amount = 120e18;

        user1.do(address(nativeToken), "approve", address(custodyVault), amount);
        user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        );

        nativeBridge.recordDeposit(
            externalChainId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            amount
        );

        nativeBridge.reviewDeposit(externalChainId, externalTxHash);

        (BridgeStatus reviewStatus,,string memory recordedTxHash,,,,address recordedRecipient,address recordedStratoToken,uint256 recordedAmount,) = nativeBridge.deposits(externalChainId, externalTxHash);

        require(reviewStatus == BridgeStatus.PENDING_REVIEW, "Deposit should move to review first");
        require(keccak256(recordedTxHash) == keccak256(externalTxHash), "Tx hash should be recorded");
        require(recordedRecipient == address(user2), "Recipient should be recorded");
        require(recordedStratoToken == address(nativeToken), "STRATO token should be resolved from representation token");
        require(recordedAmount == amount, "Deposit amount should be recorded");

        uint256 recipientBalanceBefore = nativeToken.balanceOf(address(user2));
        nativeBridge.confirmDeposit(externalChainId, externalTxHash);

        (BridgeStatus finalStatus,,,,,,,,,) = nativeBridge.deposits(externalChainId, externalTxHash);

        require(finalStatus == BridgeStatus.COMPLETED, "Deposit should complete after confirm");
        require(nativeToken.balanceOf(address(user2)) == recipientBalanceBefore + amount, "Confirmed deposit should unlock to recipient");
        require(nativeToken.balanceOf(address(custodyVault)) == 0, "Vault should release backing funds on confirm");
        require(custodyVault.lockedBalance(address(nativeToken)) == 0, "Locked balance should be consumed on confirm");
    }

    function it_native_deposit_rejects_duplicate_normalized_external_tx_hash() {
        uint256 amount = 50e18;

        nativeBridge.recordDeposit(
            externalChainId,
            externalSender,
            "0xabcdef",
            representationToken,
            address(user2),
            amount
        );

        bool reverted = false;
        try nativeBridge.recordDeposit(
            externalChainId,
            externalSender,
            "0xABCDEF",
            representationToken,
            address(user2),
            amount
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Duplicate normalized tx hash should revert");
    }

    function it_native_bridge_proxy_upgrade_preserves_state() {
        uint256 amount = 90e18;
        user1.do(address(nativeToken), "approve", address(custodyVault), amount);
        user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        );

        require(nativeBridge.withdrawalCounter() == 1, "Withdrawal should be recorded before upgrade");

        Proxy(address(nativeBridge)).setLogicContract(
            address(new StratoNativeBridge(address(0xdeadbeef)))
        );

        require(nativeBridge.withdrawalCounter() == 1, "Withdrawal counter should survive upgrade");
        (BridgeStatus bridgeStatus,,uint256 recordedExternalChainId,address recordedExternalRecipient,address recordedRepresentationToken,uint256 recordedExternalAmount,,address recordedSender,address recordedStratoToken,uint256 recordedStratoAmount,) = nativeBridge.withdrawals(1);
        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal status should survive upgrade");
        require(recordedExternalChainId == externalChainId, "Chain id should survive upgrade");
        require(recordedExternalRecipient == externalRecipient, "Recipient should survive upgrade");
        require(recordedRepresentationToken == representationToken, "Representation token should survive upgrade");
        require(recordedExternalAmount == amount, "Amount should survive upgrade");
        require(recordedSender == address(user1), "Sender should survive upgrade");
        require(recordedStratoToken == address(nativeToken), "Token should survive upgrade");
        require(recordedStratoAmount == amount, "STRATO amount should survive upgrade");
    }

    function it_native_custody_vault_proxy_upgrade_preserves_locked_balances() {
        uint256 amount = 80e18;
        user1.do(address(nativeToken), "approve", address(custodyVault), amount);
        user1.do(
            address(nativeBridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(nativeToken),
            amount
        );

        require(custodyVault.lockedBalance(address(nativeToken)) == amount, "Locked balance should exist before upgrade");

        Proxy(address(custodyVault)).setLogicContract(
            address(new StratoNativeCustodyVault(address(0xdeadbeef)))
        );

        require(custodyVault.bridge() == address(nativeBridge), "Bridge pointer should survive upgrade");
        require(custodyVault.lockedBalance(address(nativeToken)) == amount, "Locked balance should survive upgrade");

        relayer.do(address(nativeBridge), "abortWithdrawal", 1);
        require(custodyVault.lockedBalance(address(nativeToken)) == 0, "Upgraded vault should still unlock correctly");
        require(nativeToken.balanceOf(address(user1)) == 1000e18, "Funds should return after abort through upgraded vault");
    }
}
