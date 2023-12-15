pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

/// @title A representation of PaymentProvider_1 assets
abstract contract BasePaymentProvider is Utils {
    address public owner;
    string public ownerCommonName;


    string public name;
    string public accountId;
    bool public chargesEnabled;
    bool public detailsSubmitted;
    bool public payoutsEnabled;
    uint public eventTime;
    uint public createdDate;
    bool public accountDeauthorized;

    event Payment(
        string sellerAccountId,
        string amount
    );


    constructor (
            string _name
        ,   string _accountId
        ,   uint _createdDate
    ) public {
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);

        name = _name;
        accountId = _accountId;
        chargesEnabled = false;
        detailsSubmitted = false;
        payoutsEnabled = false;
        eventTime = 0;
        createdDate = _createdDate;
        accountDeauthorized = false;
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