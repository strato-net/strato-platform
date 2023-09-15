import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/Service/contracts/Service.sol";

contract ServiceManager_10 is RestStatus {

    function createService(
        string _name,
        string _description,
        int _price,
        int _createdDate
    ) public returns (uint256, address) {
       
        Service_10 Service = new Service_10(_name, _description, _price, _createdDate);
        return (RestStatus.CREATED, address(Service));
    }
}
