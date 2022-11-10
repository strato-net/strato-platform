const AutoApprove = `
contract AutoApprove { 
  event OrgAdded (string orgName); 
  event OrgUnitAdded (string orgName, string orgUnit); 
  event CommonNameAdded (string orgName, string orgUnit, string commonName); 
  event OrgRemoved (string orgName); 
  event OrgUnitRemoved (string orgName, string orgUnit); 
  event CommonNameRemoved (string orgName, string orgUnit, string commonName); 
 
  constructor() {}

  function addOrg(string orgName) { 
    emit OrgAdded(orgName); 
  } 

  function addOrgUnit(string orgName, string orgUnit) { 
    emit OrgUnitAdded(orgName, orgUnit); 
  } 

  function addCommonName(string orgName, string orgUnit, string commonName) { 
    emit CommonNameAdded(orgName, orgUnit, commonName); 
  } 

  function removeOrg(string orgName) { 
    emit OrgRemoved(orgName); 
  } 

  function removeOrgUnit(string orgName, string orgUnit) { 
    emit OrgUnitRemoved(orgName, orgUnit); 
  } 

  function removeCommonName(string orgName, string orgUnit, string commonName) { 
    emit CommonNameRemoved(orgName, orgUnit, commonName); 
  } 
}`


const AdminOnly = ` 
contract AdminOnly {
  event CommonNameAdded(string orgName, string orgUnit, string commonName);
  event CommonNameRemoved(string orgName, string orgUnit, string commonName);

  struct chainMember {
    string o,
    string u,
    string c
  }

  chainMember admin; 

  constructor(chainMember _admin) {
    admin = _admin;
  }
  function voteToAdd(string o, string u, string c) {
    require(msg.sender == admin, "You do not have permission to vote");
    emit CommonNameAdded(o, u, c); 
  } 

  function voteToRemove(string o, string u, string c) {
    require(msg.sender == admin, "You do not have permission to vote");
    emit CommonNameRemoved(o, u, c); 
  } 
}`

const MajorityRules = `pragma solidvm 3.2; 
 
contract MajorityRules { 
  event CommonNameAdded(string orgName, string orgUnit, string commonName);
  event CommonNameRemoved(string orgName, string orgUnit, string commonName);

  mapping(chainMember => uint) addVotes; 
  mapping(chainMember => uint) removeVotes; 

  struct chainMember {
    string o,
    string u,
    string c
  }

  }
  chainMember[] __members__; 

  function voteToAdd(string o, string u, string c) {
    chainMember m = chainMember(o, u, c); 

    uint votes = addVotes[m] + 1; 
    uint mlen = __members__.length; 
    if (votes > mlen / 2) { 
      addVotes[m] = 0; 
      bool found = false; 
      for (uint i = 0; i < mlen; i++) { 
        if (__members__[i] == m) { 
          found = true; 
          i = mlen;
        } 
      } 
      if (!found) { 
        __members__.push(m); 
        emit CommonNameAdded(o, u, c); 
      } 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 

  function voteToRemove(string o, string u, string c) { 
    chainMember m = chainMember(o, u, c); 
    uint votes = removeVotes[m] + 1; 
    uint mlen = __members__.length; 
    if (votes > mlen / 2) { 
      removeVotes[m] = 0; 
      for (uint i = 0; i < mlen; i++) { 
        if (__members__[i] == m) { 
          __members__[i] = __members__[mlen - 1]; 
          delete __members__[mlen - 1]; 
          __members__.length--; 
          emit CommonNameRemoved(o,u,c); 
          i = mlen; 
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
  event CommonNameAdded(string orgName, string orgUnit, string commonName);
  event CommonNameRemoved(string orgName, string orgUnit, string commonName);

  mapping(chainMember => uint) addVotes; 
  mapping(chainMember => uint) removeVotes; 

  struct chainMember {
    string o,
    string u,
    string c
  }

  function voteToAdd(string o, string u, string c) {
    chainMember m = chainMember(o, u, c); 
    uint votes = addVotes[m] + 1; 
    if (votes >= 2) { 
      emit CommonNameAdded(o, u, c); 
      addVotes[m] = 0; 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 

  function voteToRemove(string o, string u, string c) { 
    chainMember m = chainMember(o, u, c); 
    uint votes = removeVotes[m] + 1; 
    if (votes >= 2) { 
      emit CommonNameRemoved(o,u,c); 
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