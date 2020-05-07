import "../RestStatus.sol";
import "../dapp/BeanstalkErrorCodes.sol";
import "../permission/BeanstalkRole.sol";
import "../event/EventManager.sol";
import "../exception/ExceptionManager.sol";

contract Governance is RestStatus, BeanstalkRole, BeanstalkErrorCodes {
  EventManager eventManager;
  ExceptionManager exceptionManager;

  event MemberAdded (address member, string enode);
  event MemberRemoved (address member);

  constructor () public {
    eventManager = new EventManager();
    exceptionManager = new ExceptionManager();
  }

  function addMember(address _member, string _enode) public returns (uint) {
    _member.transfer(1000000000000000000000);
    emit MemberAdded(_member, _enode);
    return RestStatus.OK;
  }

  function removeMember(address _member) public returns (uint)  {
    emit MemberRemoved(_member);
    return RestStatus.OK;
  }

  function addMembers(address[] _members, string[] _enodes) public returns (uint) {
    require(_members.length == _enodes.length, "Input data should be consistent");

    for (uint i = 0; i < _members.length; i++) {
      addMember(_members[i], _enodes[i]);
    }
    return RestStatus.OK;
  }

  function removeMembers(address[] _members) public returns (uint) {
    for (uint i = 0; i < _members.length; i++) {
      removeMember(_members[i]);
    }
    return RestStatus.OK;
  }

  function faucet() public returns (uint) {
    msg.sender.transfer(1000000000000000000000);
    return RestStatus.OK;
  }
}
