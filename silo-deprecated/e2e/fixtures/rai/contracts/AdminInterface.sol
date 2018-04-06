import "./SampleManager.sol";
import "./UserManager.sol";
import "./PermissionManager.sol";
import "./BusinessFunctions.sol";
import "./WellManager.sol";

contract AdminInterface {
  SampleManager public sampleManager;
  UserManager public userManager;
  PermissionManager public permissionManager;
  BusinessFunctions public businessFunctions;
  WellManager public wellManager;
  string public mystring;

  function AdminInterface() {
    mystring = "constructor";
  }

  function test() returns (string retVal) {
      return "A";
  }

  function init() {
    mystring = "init";
    wellManager = new WellManager();
    sampleManager = new SampleManager();
    userManager = new UserManager();
    permissionManager = new PermissionManager();
    businessFunctions = new BusinessFunctions();
  }
}
