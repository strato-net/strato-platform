export const twoIn = 'pragma solidity ^0.4.24; \
 \
contract TwoIn { \
  event MemberAdded (address member, string enode); \
  event MemberRemoved (address member); \
 \
  mapping (address => uint) addVotes; \
  mapping (address => uint) removeVotes; \
 \
  function voteToAdd(address m, string e) { \
    uint votes = addVotes[m] + 1; \
    if (votes >= 2) { \
      emit MemberAdded(m,e); \
      addVotes[m] = 0; \
    } \
    else { \
      addVotes[m] = votes; \
    } \
  } \
 \
  function voteToRemove(address m) { \
    uint votes = removeVotes[m] + 1; \
    if (votes >= 2) { \
      emit MemberRemoved(m); \
      removeVotes[m] = 0; \
    } \
    else { \
      removeVotes[m] = votes; \
    } \
  } \
}'
