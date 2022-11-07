const AutoApprove = `
contract AutoApprove { 
  event OrganizationAdded (string orgName, string orgUnit, string commonName); 
  event OrganizationRemoved (string orgName, string orgUnit, string commonName);
 
  constructor() {}

  function addOrg(string orgName) { 
    emit OrganizationAdded(orgName, "", ""); 
  } 

  function addOrgUnit(string orgName, string orgUnit) { 
    emit OrganizationAdded(orgName, orgUnit, ""); 
  } 

  function addCommonName(string orgName, string orgUnit, string commonName) { 
    emit OrganizationAdded(orgName, orgUnit, commonName); 
  } 

  function removeOrg(string orgName) { 
    emit OrganizationRemoved(orgName, "", ""); 
  } 

  function removeOrgUnit(string orgName, string orgUnit) { 
    emit OrganizationRemoved(orgName, orgUnit, ""); 
  } 

  function removeCommonName(string orgName, string orgUnit, string commonName) { 
    emit OrganizationRemoved(orgName, orgUnit, commonName); 
  } 
}`


const AdminOnly = ` 
contract AdminOnly {
  event OrganizationAdded(string orgName, string orgUnit, string commonName);
  event OrganizationRemoved(string orgName, string orgUnit, string commonName);

  struct chainMember {
    string o,
    string u,
    string c,
    string a 
  }

  chainMember admin; 

  constructor(chainMember _admin) {
    admin = _admin;
  }
  function voteToAdd(string o, string u, string c, bool a) {
    require(msg.sender == admin, "You do not have permission to vote");
    emit OrganizationAdded(o, u, c, a); 
  } 

  function voteToRemove(string o, string u, string c, bool a) {
    require(msg.sender == admin, "You do not have permission to vote");
    emit OrganizationRemoved(o, u, c, a); 
  } 
}`

const MajorityRules = `pragma solidvm 3.2; 
 
contract MajorityRules { 
  event OrganizationAdded(string orgName, string orgUnit, string commonName, bool access);
  event OrganizationRemoved(string orgName, string orgUnit, string commonName, bool access);

  mapping(chainMember => uint) addVotes; 
  mapping(chainMember => uint) removeVotes; 

  struct chainMember {
    string o,
    string u,
    string c,
    string a 
  }

  }
  chainMember[] __members__; 

  function voteToAdd(string o, string u, string c, bool a) {
    m = chainMember(o, u, c, a) 

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
        emit OrganizationAdded(o, u, c, a); 
      } 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 

  function voteToRemove(string o, string u, string c, bool a) { 
    m = chainMember(o, u, c, a) 
    uint votes = removeVotes[m] + 1; 
    uint mlen = __members__.length; 
    if (votes > mlen / 2) { 
      removeVotes[m] = 0; 
      for (uint i = 0; i < mlen; i++) { 
        if (__members__[i] == m) { 
          __members__[i] = __members__[mlen - 1]; 
          delete __members__[mlen - 1]; 
          __members__.length--; 
          emit OrganizationRemoved(o,u,c,a); 
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
  event OrganizationAdded(string orgName, string orgUnit, string commonName, bool access);
  event OrganizationRemoved(string orgName, string orgUnit, string commonName, bool access);

  mapping(chainMember => uint) addVotes; 
  mapping(chainMember => uint) removeVotes; 

  struct chainMember {
    string o,
    string u,
    string c,
    string a 
  }

  function voteToAdd(string o, string u, string c, bool a) {
    m = chainMember(o, u, c, a) 
    uint votes = addVotes[m] + 1; 
    if (votes >= 2) { 
      emit OrganizationAdded(o, u, c, a); 
      addVotes[m] = 0; 
    } 
    else { 
      addVotes[m] = votes; 
    } 
  } 

  function voteToRemove(string o, string u, string c, bool a) { 
    uint votes = removeVotes[m] + 1; 
    if (votes >= 2) { 
      emit OrganizationRemoved(o,u,c,a); 
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