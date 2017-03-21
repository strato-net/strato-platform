import "./SampleManager.sol";
import "./SampleFsm.sol";
import "./WellManager.sol";
import "./UserManager.sol";
import "./PermissionManager.sol";
import "./BusinessFunctions.sol";
import "./OrganizationManager.sol";

/**
  * Interface to global contracts
*/
contract AdminInterface {
  SampleManager public sampleManager;
  WellManager public wellManager;
  UserManager public userManager;
  PermissionManager public permissionManager;
  BusinessFunctions public businessFunctions;
  OrganizationManager public organizationManager;
  SampleFsm public sampleFsm;

  /**
    * Constructor. Initialize global contracts and pointers
  */
  function AdminInterface() {
    sampleManager = new SampleManager(1);
    wellManager = new WellManager();
    userManager = new UserManager();
    permissionManager = new PermissionManager();
    businessFunctions = new BusinessFunctions();
    organizationManager = new OrganizationManager();
    sampleFsm = new SampleFsm();
  }
}
