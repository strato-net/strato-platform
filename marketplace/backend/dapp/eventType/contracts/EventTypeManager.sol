import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/eventType/contracts/EventType.sol";

contract EventTypeManager is RestStatus {

    function createEventType(
        string _name,
        string _description,
        uint _createdDate
    ) public returns (uint256, address) {
       
        EventType eventType = new EventType(_name, _description, _createdDate);
        return (RestStatus.CREATED, address(eventType));
    }
}
