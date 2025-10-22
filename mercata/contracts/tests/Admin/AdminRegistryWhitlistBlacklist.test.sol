import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";

contract Describe_AdminRegistryUpgrade {
    using TestUtils for User;
    Mercata m;

    function beforeEach() {
        m = new Mercata();
    }

    /// @dev currently fails because whitelist is checked only for non-admins
    function it_admin_registry_cannot_whitelist_admin_registry_functions() {
        AdminRegistry adminRegistry = m.adminRegistry();

        // Ensure that normal whitelists still work
        adminRegistry.addWhitelist(address(m.lendingRegistry()), "setLendingPool", address(this));
        log("whitelisted");
        m.lendingRegistry().setLendingPool(address(m.collateralVault()));
        log("set collateral vault");
        require(address(m.lendingRegistry().lendingPool()) == address(m.collateralVault()), "Lending pool should be collateral vault");
        m.lendingRegistry().setLendingPool(address(m.lendingPool()));
        log("set lending pool");
        require(address(m.lendingRegistry().lendingPool()) == address(m.lendingPool()), "Lending pool should be lending pool");

        // Ensure that admin registry functions cannot be whitelisted
        bool reverted = false;
        try adminRegistry.addWhitelist(address(adminRegistry), "addAdmin", address(this)) {
            revert("Should revert addWhitelist call");
        } catch {
            reverted = true;
        }
        require(reverted, "Admin registry should not be whitelisted");
        require(!adminRegistry.whitelist(address(adminRegistry), "addAdmin", address(this)), "Admin registry should not be whitelisted");
    }

    function it_admin_registry_cannot_whitelist_admin_registry_functions_for_nonadmin() {
        AdminRegistry adminRegistry = m.adminRegistry();
        User user = new User();

        // Ensure that normal whitelists still work
        adminRegistry.addWhitelist(address(m.lendingRegistry()), "setLendingPool", address(user));
        log("whitelisted");
        TestUtils.callAs(user, address(m.lendingRegistry()), "setLendingPool", address(m.collateralVault()));
        log("set collateral vault");
        require(address(m.lendingRegistry().lendingPool()) == address(m.collateralVault()), "Lending pool should be collateral vault");
        TestUtils.callAs(user, address(m.lendingRegistry()), "setLendingPool", address(m.lendingPool()));
        log("set lending pool");
        require(address(m.lendingRegistry().lendingPool()) == address(m.lendingPool()), "Lending pool should be lending pool");

        // Ensure that admin registry functions cannot be whitelisted
        bool reverted = false;
        try adminRegistry.addWhitelist(address(adminRegistry), "addAdmin", address(user)) {
            revert("Should revert addWhitelist call");
        } catch {
            reverted = true;
        }
        require(reverted, "Admin registry should not be whitelisted");
        require(!adminRegistry.whitelist(address(adminRegistry), "addAdmin", address(user)), "Admin registry should not be whitelisted");
        bool reverted2 = false;
        try TestUtils.callAs(user, address(adminRegistry), "addAdmin", address(user)) {
            revert("Should revert addAdmin call");
        } catch {
            reverted2 = true;
        }
        require(reverted2, "addAdmin call should have failed");
    }

    function it_admin_registry_cannot_bypass_whitelist_blacklist() {
        AdminRegistry adminRegistry = m.adminRegistry();
        User user = new User();
        adminRegistry.addWhitelist(address(m.lendingRegistry()), "setLendingPool", address(user));

        // Ensure that admin registry functions cannot be whitelisted
        bool reverted = false;
        try adminRegistry.addWhitelist(address(user), "addAdmin", address(adminRegistry)) {
            revert("Should revert addWhitelist call");
        } catch {
            reverted = true;
        }
        require(reverted, "Admin registry should not be whitelisted");
        require(!adminRegistry.whitelist(address(adminRegistry), "addAdmin", address(user)), "Admin registry should not be whitelisted");
        bool reverted2 = false;
        try TestUtils.callAs(user, address(adminRegistry), "addAdmin", address(user)) {
            revert("Should revert addAdmin call");
        } catch {
            reverted2 = true;
        }
        require(reverted2, "addAdmin call should have failed");
    }

}