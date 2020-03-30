import "/blockapps-sol/dist/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/BeanstalkErrorCodes.sol";

import "./Exception.sol";
import "/dapp/permission/contracts/BeanstalkPermissionManager.sol";
import "/dapp/dapp/contracts/BeanstalkErrorCodes.sol";
import "/dapp/exceptionDef/contracts/ExceptionType.sol";

/**
* Exception Manager
*
* Entry point to create new exception
*
* #see Exception
*/

contract ExceptionManager is RestStatus, ExceptionType, BeanstalkErrorCodes {

  constructor() {
  }

  function addException(
    string _agreementId,
    string _eventUid,
    string _exceptionId,
    string _label,
    uint _exceptionTime,
    uint _value
  ) public returns (uint, BeanstalkErrorCodes, address) {
    // create new
    Exception exception = new Exception(
      _agreementId,
      _eventUid,
      _exceptionId,
      _label,
      _exceptionTime,
      _value
    );

    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, address(exception));
  }
}
