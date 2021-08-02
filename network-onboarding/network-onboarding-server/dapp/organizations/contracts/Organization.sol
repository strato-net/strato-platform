/**
 * Organization data contract
 * The Organization contract stores data pertinent to the organization, it will also expose a number
 * of functions for changing these data elements, some permissioned only to network admins, and
 * others permissioned to the organization admins).
 *
 * Holds data for an organization, including the current members of the organization
 */
contract Organization {
    address public owner;       // The creator of the contract, i.e. OrganizationsManager
    // IMPORTANT!!! There is an implicit state that this contract has a X.509 certificate registed to its address
    address[] public members;   // TODO Use a better data structure (maybe a mapping)

    constructor() {
        owner = msg.sender;
        members = [];
    }

    function addMember(address _userAddress) returns (uint256) {
        // TODO Add more verification to adding members

        members.push(_member);
    }

    function removeMember(address _member) {
        // TODO
    }
}
