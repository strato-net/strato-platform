import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/eventType/contracts/EventType.sol";

contract EventTypeManager_10 is RestStatus {

    function createEventType(
        string _name,
        string _description,
        uint _createdDate
    ) public returns (uint256, address) {
       
        EventType_10 eventType = new EventType_10(_name, _description, _createdDate);
        return (RestStatus.CREATED, address(eventType));
    }
}
