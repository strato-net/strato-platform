const AutoApprove = `
contract AutoApprove { 
  event MemberAdded (address member, string enode); 
  event MemberRemoved (address member); 
  
  constructor() {}
  
  function voteToAdd(address m, string e) { 
    emit MemberAdded(m,e); 
  } 
 
  function voteToRemove(address m) { 
    emit MemberRemoved(m); 
  } 
}`

const AdminOnly = ` 
contract AdminOnly {  
  
  event MemberAdded (address member, string enode); 
  event MemberRemoved (address member); 
  
  address admin;

  constructor(address _admin) {
    admin = _admin;
  }
  
  function voteToAdd(address m, string e) { 
    require(msg.sender == admin, "You do not have permission to vote"); 
    emit MemberAdded(m,e); 
  } 
 
  function voteToRemove(address m) {
    require(msg.sender == admin, "You do not have permission to vote"); 
    emit MemberRemoved(m); 
  } 
}`

const MajorityRules = `pragma solidvm 3.2; 
 
contract MajorityRules { 
  event MemberAdded (address member, string enode); 
  event MemberRemoved (address member); 
 
  mapping (address => uint) addVotes; 
  mapping (address => uint) removeVotes; 
 
  address[] __members__; 
  
  constructor() {
    __members__ = [];
  }
  
  function voteToAdd(address m, string e) { 
    uint votes = addVotes[m] + 1; 
    uint mlen = __members__.length; 
    if (votes > mlen / 2) { 
      addVotes[m] = 0; 
      bool found = false; 
      for (uint i = 0; i < mlen; i++) { 
        if (__members__[i] == m) { 
          found = true; 
          break; 
        } 
      } 
      if (!found) { 
        __members__.push(m); 
        emit MemberAdded(m,e); 
      } 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 
 
  function voteToRemove(address m) { 
    uint votes = removeVotes[m] + 1; 
    uint mlen = __members__.length; 
    if (votes > mlen / 2) { 
      removeVotes[m] = 0; 
      for (uint i = 0; i < mlen; i++) { 
        if (__members__[i] == m) { 
          __members__[i] = __members__[mlen - 1]; 
          delete __members__[mlen - 1]; 
          __members__.length--; 
          emit MemberRemoved(m); 
          break; 
        } 
      } 
    } 
    else { 
      removeVotes[m] = votes; 
    } 
  } 
}`

const TwoIn = `
 
contract TwoIn { 
  event MemberAdded (address member, string enode); 
  event MemberRemoved (address member); 
 
  mapping (address => uint) addVotes; 
  mapping (address => uint) removeVotes; 
  
  constructor() {}
  
  function voteToAdd(address m, string e) { 
    uint votes = addVotes[m] + 1; 
    if (votes >= 2) { 
      emit MemberAdded(m,e); 
      addVotes[m] = 0; 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 
 
  function voteToRemove(address m) { 
    uint votes = removeVotes[m] + 1; 
    if (votes >= 2) { 
      emit MemberRemoved(m); 
      removeVotes[m] = 0; 
    } 
    else { 
      removeVotes[m] = votes; 
    } 
  } 
}`

export default {
    AutoApprove,
    AdminOnly,
    MajorityRules,
    TwoIn,
  }