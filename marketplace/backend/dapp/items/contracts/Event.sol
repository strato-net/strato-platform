import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";

/// @title A representation of Event assets
contract Event {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public eventTypeId;
    string public eventBatchId;
    string public itemSerialNumber;
    address public itemAddress;
    uint public date;
    string public summary;
    address public certifier;
    string public certifierComment;
    uint public certifiedDate;
    uint public createdDate;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName);

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);

    constructor(
        address _eventTypeId,
        string _eventBatchId,
        string _itemSerialNumber,
        address _itemAddress,
        uint _date,
        string _summary,
        address _certifier,
        uint _createdDate
    ) public {
        owner = tx.origin;

        eventTypeId = _eventTypeId;
        eventBatchId = _eventBatchId;
        itemSerialNumber = _itemSerialNumber;
        itemAddress = _itemAddress;
        date = _date;
        summary = _summary;
        certifier = _certifier;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function certify(
        string _certifierComment,
        uint _certifiedDate,
        uint _scheme
    ) returns (uint) {
        if (tx.origin != certifier) {
            return RestStatus.FORBIDDEN;
        }
        if (_scheme == 0) {
            return RestStatus.OK;
        }
        if ((_scheme & (1 << 0)) == (1 << 0)) {
            certifierComment = _certifierComment;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            certifiedDate = _certifiedDate;
        }
        return RestStatus.OK;
    }
}
