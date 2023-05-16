import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/eventType/contracts/EventType.sol";
import "/dapp/permissions/app/contracts/AppPermissionManager.sol";

contract EventTypeManager_10 is RestStatus {
    AppPermissionManager appPermissionManager;

    constructor(address _permissionManager) public {
        appPermissionManager = AppPermissionManager(_permissionManager);
    }

    function createEventType(
        string _name,
        string _description,
        uint _createdDate
    ) public returns (uint256, address) {
        // if(!appPermissionManager.canCreateEventType(tx.origin)){
        //     return (RestStatus.UNAUTHORIZED,address(0));
        // }

        EventType_10 eventType = new EventType_10(
            _name,
            _description,
            _createdDate
        );
        return (RestStatus.CREATED, address(eventType));
    }
}
