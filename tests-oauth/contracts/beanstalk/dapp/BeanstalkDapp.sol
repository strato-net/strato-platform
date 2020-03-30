import "../agreement/AgreementManager.sol";
import "../eventDef/EventDefManager.sol";
import "../exceptionDef/ExceptionDefManager.sol";
import "../membership/MembershipManager.sol";
import "../nodes/NodeManager.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../program/ProgramManager.sol";
import "../user/BeanstalkUserManager.sol";

/**
 * Single entry point to all the project's contract
 * Replace this with your own code
 * Deployed by the deploy script
 */

contract BeanstalkDapp {

  // Public
  address owner;
  BeanstalkPermissionManager public permissionManager;
  MembershipManager public membershipManager;
  NodeManager public nodeManager;
  EventDefManager public eventDefManager;
  ExceptionDefManager public exceptionDefManager;
  ProgramManager public programManager;
  AgreementManager public agreementManager;
  BeanstalkUserManager public userManager;

  constructor(string _userId, string _username, string _nodeLabel, string _nodeIp, string _nodePublicKey) {
    owner = msg.sender;
    permissionManager = new BeanstalkPermissionManager(msg.sender, msg.sender);
    nodeManager = new NodeManager(address(this), permissionManager, _nodeLabel, _nodeIp, _nodePublicKey);
    userManager = new BeanstalkUserManager(address(this), permissionManager, _userId, _username);
    programManager = new ProgramManager(address(this), permissionManager);
    agreementManager = new AgreementManager(address(this), permissionManager, userManager, programManager);
    membershipManager = new MembershipManager(address(this), permissionManager, agreementManager, nodeManager, userManager, _username, _nodeLabel, msg.sender);
    eventDefManager = new EventDefManager(address(this), permissionManager, programManager);
    exceptionDefManager = new ExceptionDefManager(address(this), permissionManager, eventDefManager);
  }
}
