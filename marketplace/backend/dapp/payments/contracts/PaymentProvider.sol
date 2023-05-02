

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/payments/contracts/PaymentServices.sol";

/// @title A representation of PaymentProvider_1 assets
contract PaymentProvider_1 is PaymentServices{

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;


    PaymentServices public name;
    string public accountId;
    bool public chargesEnabled;
    bool public detailsSubmitted;
    bool public payoutsEnabled;
    uint public eventTime;
    uint public createdDate;
    bool public accountDeauthorized;


    constructor(
            string _appChainId
        ,   PaymentServices _name
        ,   string _accountId
        ,   uint _createdDate
    ) public {
        owner = tx.origin;
        appChainId = _appChainId;

        name = _name;
        accountId = _accountId;
        chargesEnabled = false;
        detailsSubmitted = false;
        payoutsEnabled = false;
        eventTime = 0;
        createdDate = _createdDate;
        accountDeauthorized = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        bool _chargesEnabled
    ,   bool _detailsSubmitted
    ,   bool _payoutsEnabled
    ,   uint _eventTime
    ,   bool _accountDeauthorized
    ,   uint _scheme
    ) returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        chargesEnabled = _chargesEnabled;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        detailsSubmitted = _detailsSubmitted;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        payoutsEnabled = _payoutsEnabled;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        eventTime = _eventTime;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        accountDeauthorized = _accountDeauthorized;
      }

      return RestStatus.OK;
    }
}