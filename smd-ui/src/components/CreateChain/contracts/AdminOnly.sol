export const adminOnly = 'pragma solidity ^0.4.24;

contract AdminOnly {

  modifier adminOnly() {
    require(msg.sender == admin, "You do not have permission to vote");
    _;
  }

  event MemberAdded (address member, string enode);
  event MemberRemoved (address member);

  address admin;

  function voteToAdd(address m, string e) adminOnly {
    emit MemberAdded(m,e);
  }

  function voteToRemove(address m) adminOnly {
    emit MemberRemoved(m);
  }
}'
