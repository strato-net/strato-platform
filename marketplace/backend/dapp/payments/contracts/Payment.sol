
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Payment assets
contract Payment_3 {

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public paymentSessionId;  //"id": "cs_test_a1jIRGPJra3H8e001xRh73mOu7XwppoKEVxcrgB8fijVuP5lAi2e1pHuMr",
    string public paymentIntentId;   //"payment_intent": "pi_1Dt0s32eZvKYlo2CV1tCo99t",  ==>update
    string public paymentStatus;    
    string public sessionStatus;
    string public paymentProvider;
    string public amount;
    uint public createdDate;
    uint public expiresAt;
    string public sellerAccountId;

    constructor(
            string _appChainId
        ,   string _paymentSessionId
        ,   string _paymentProvider
        ,   string _paymentStatus
        ,   string _sessionStatus
        ,   string _amount
        ,   uint _expiresAt
        ,   uint _createdDate
        ,   string _sellerAccountId
    ) public {
        owner = tx.origin;
        appChainId = _appChainId;

        paymentSessionId = _paymentSessionId;
        paymentProvider = _paymentProvider;
        paymentStatus = _paymentStatus;
        sessionStatus = _sessionStatus;
        amount = _amount;
        expiresAt = _expiresAt;
        createdDate = _createdDate;
        sellerAccountId= _sellerAccountId;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _paymentStatus
    ,   string _sessionStatus
    ,   string _paymentIntentId
    ,   uint _scheme
    ) returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        paymentStatus = _paymentStatus;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        sessionStatus = _sessionStatus;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        paymentIntentId = _paymentIntentId;
      }

      return RestStatus.OK;
    }
}