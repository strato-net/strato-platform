pragma solidvm 3.0;

import "./Organization.sol";
import "/network-onboarding-server/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/network-onboarding-server/blockapps-sol/lib/collections/hashmap/contracts/Hashmap.sol";

/**
 * The OrganizationManager contract is responsible for the onboarding and removal of organizations 
 * from the network by a network admin. The contract will also maintain a list of all Organizations 
 * in the network, so that applications can retrieve a list of all active organizations in the
 * network.
 */

contract OrganizationManager is RestStatus, Util {

  function OrganizationManager() {
    // TODO
  }

  function getOrganizations() returns (mapping(string=>address) {
    // TODO
  }

  function addOrganization(string _commonName, string _cert) returns (address) {
    // TODO
  }

  function removeOrganization(string _commonName) returns (uint) {
    // TODO
  }
}