pragma solidity ^0.4.24;

contract MajorityRules {
  event MemberAdded (address member, string enode);
  event MemberRemoved (address member);

  mapping (address => uint) addVotes;
  mapping (address => uint) removeVotes;

  address[] __members__;

  function voteToAdd(address m, string e) {
    uint votes = addVotes[m] + 1;
    if (votes > __members__.length / 2) {
      emit MemberAdded(m,e);
      addVotes[m] = 0;
    }
    else {
      addVotes[m] = votes;
    }
  }

  function voteToRemove(address m) {
    uint votes = removeVotes[m] + 1;
    if (votes > __members__.length / 2) {
      emit MemberRemoved(m);
      removeVotes[m] = 0;
    }
    else {
      removeVotes[m] = votes;
    }
  }
}
