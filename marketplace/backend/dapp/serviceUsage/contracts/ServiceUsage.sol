import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "./Status.sol";
import "./PaymentStatus.sol";

/// @title A representation of ServiceUsage assets
contract ServiceUsage is Status, PaymentStatus {
    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;
    uint public createdDate;

    address public itemId;
    address public serviceId;
    uint public serviceDate;
    string public summary;
    Status public status;
    PaymentStatus public paymentStatus;
    address public providerLastUpdated;
    string public providerComment;
    uint public providerLastUpdatedDate;
    uint public pricePaid;
    address public bookedUserAddress;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName);

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);

    constructor(
        address _itemId,
        address _serviceId,
        uint _serviceDate,
        string _summary,
        Status _status,
        PaymentStatus _paymentStatus,
        address _providerLastUpdated,
        string _providerComment,
        uint _providerLastUpdatedDate,
        uint _pricePaid,
        address _bookedUserAddress
    ) public {
        owner = tx.origin;

        createdDate = block.timestamp;
        itemId = _itemId;
        serviceId = _serviceId;
        serviceDate = _serviceDate;
        summary = _summary;
        status = _status;
        paymentStatus = _paymentStatus;
        providerLastUpdated = _providerLastUpdated;
        providerComment = _providerComment;
        providerLastUpdatedDate = _providerLastUpdatedDate;
        pricePaid = _pricePaid;
        bookedUserAddress = _bookedUserAddress;

        mapping(string => string) ownerCert = getUserCert(tx.origin);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        uint _serviceDate,
        string _summary,
        Status _status,
        PaymentStatus _paymentStatus,
        address _providerLastUpdated,
        string _providerComment,
        uint _providerLastUpdatedDate,
        uint _pricePaid,
        uint _scheme
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            serviceDate = _serviceDate;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            summary = _summary;
        }
        if ((_scheme & (1 << 2)) == (1 << 2)) {
            changeStatus(_status);
        }
        if ((_scheme & (1 << 3)) == (1 << 3)) {
            changePaymentStatus(_paymentStatus);
        }
        if ((_scheme & (1 << 4)) == (1 << 4)) {
            providerLastUpdated = _providerLastUpdated;
        }
        if ((_scheme & (1 << 5)) == (1 << 5)) {
            providerComment = _providerComment;
        }
        if ((_scheme & (1 << 6)) == (1 << 6)) {
            providerLastUpdatedDate = _providerLastUpdatedDate;
        }
        if ((_scheme & (1 << 7)) == (1 << 7)) {
            pricePaid = _pricePaid;
        }

        return RestStatus.OK;
    }

    function changeStatus(Status newType) public {
        if (
            newType == Status.REQUESTED ||
            newType == Status.COMPLETED ||
            newType == Status.CANCELLED
        ) {
            // Add more here in the future
            status = newType;
        }
    }

    function changePaymentStatus(PaymentStatus newSection) public {
        if (
            newSection == PaymentStatus.PAID ||
            newSection == PaymentStatus.UNPAID
        ) {
            // Add more here in the future
            paymentStatus = newSection;
        }
    }

    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
    }
}
