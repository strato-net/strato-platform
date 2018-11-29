export const majorityRules = 'pragma solidity ^0.4.24; \
 \
contract MajorityRules { \
  event MemberAdded (address member, string enode); \
  event MemberRemoved (address member); \
 \
  mapping (address => uint) addVotes; \
  mapping (address => uint) removeVotes; \
 \
  address[] __members__; \
 \
  function voteToAdd(address m, string e) { \
    uint votes = addVotes[m] + 1; \
    uint mlen = __members__.length; \
    if (votes > mlen / 2) { \
      addVotes[m] = 0; \
      bool found = false; \
      for (uint i = 0; i < mlen; i++) { \
        if (__members__[i] == m) { \
          found = true; \
          break; \
        } \
      } \
      if (!found) { \
        __members__.push(m); \
        emit MemberAdded(m,e); \
      } \
    } \
    else { \
      addVotes[m] = votes; \
    } \
  } \
 \
  function voteToRemove(address m) { \
    uint votes = removeVotes[m] + 1; \
    uint mlen = __members__.length; \
    if (votes > mlen / 2) { \
      removeVotes[m] = 0; \
      for (uint i = 0; i < mlen; i++) { \
        if (__members__[i] == m) { \
          __members__[i] = __members__[mlen - 1]; \
          delete __members__[mlen - 1]; \
          __members__.length--; \
          emit MemberRemoved(m); \
          break; \
        } \
      } \
    } \
    else { \
      removeVotes[m] = votes; \
    } \
  } \
}'
