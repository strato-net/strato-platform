import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Admin/AdminRegistry.sol";

contract Describe_AdminRegistryUpgrade {

    function it_admin_registry_upgrade_can_upgrade_if_eoa_owns_proxy() {
        AdminRegistry adminRegistry = AdminRegistry(address(new Proxy(address(new AdminRegistry()), this)));
        adminRegistry.initialize([this]);
        Proxy(address(adminRegistry)).setLogicContract(address(new AdminRegistry()));
    }

    function it_admin_registry_upgrade_can_upgrade_if_self_owned_proxy() {
        AdminRegistry adminRegistry = AdminRegistry(address(new Proxy(address(new AdminRegistry()), this)));
        adminRegistry.initialize([this]);
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));
        Proxy(address(adminRegistry)).setLogicContract(address(new AdminRegistry()));
    }


}