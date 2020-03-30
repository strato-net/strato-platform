import "../Hashmap.sol";
import "../RestStatus.sol";
import "./Program.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";

/**
* Program Manager
*
* Entry point to create new programs and access existing programs by programId
*
* #see Program
* #see EventDefManager
*
* #return none
*/

contract ProgramManager is RestStatus, BeanstalkErrorCodes {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;

  Hashmap programs;

  /**
  * Constructor
  */
  constructor (address _dappAddress, address _permissionManager) public {
    dappAddress = _dappAddress;
    programs = new Hashmap();
    permissionManager = BeanstalkPermissionManager(_permissionManager);
  }

  function createProgram(
    string _programId,
    string _programName
  ) public returns (uint, uint, address) {
    // check permissions
    if (!permissionManager.canCreateProgram(msg.sender)) return (RestStatus.UNAUTHORIZED, BeanstalkErrorCodes.UNAUTHORIZED, msg.sender);
    // exists ?
    if (contains(_programId)) return (RestStatus.CONFLICT, BeanstalkErrorCodes.PROGRAM_DUPLICATION, 0);
    // create new
    Program program = new Program(
      dappAddress,
      _programId,
      _programName
    );
    programs.put(_programId, program);
    // created
    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, program);
  }

  function get(string _programId) public view returns (uint, BeanstalkErrorCodes, address) {
    if (!contains(_programId)) return (RestStatus.NOT_FOUND, BeanstalkErrorCodes.PROGRAM_NOT_FOUND, 0);
    return (RestStatus.OK, BeanstalkErrorCodes.NULL, programs.get(_programId));
  }

  function contains(string _programId) public view returns (bool) {
    return programs.contains(_programId);
  }
}
