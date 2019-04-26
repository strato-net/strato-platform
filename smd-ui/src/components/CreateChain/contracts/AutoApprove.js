export const autoApprove = `pragma solidity ^0.4.24;
 
contract AutoApprove { 
  event MemberAdded (address member, string enode); 
  event MemberRemoved (address member); 
 
  function voteToAdd(address m, string e) { 
    emit MemberAdded(m,e); 
  } 
 
  function voteToRemove(address m) { 
    emit MemberRemoved(m); 
  } 
}`
