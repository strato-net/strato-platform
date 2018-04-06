import "../libs/JsonUtils.sol";
import "../libs/Owned.sol";

/**
 * Data contract for postal addresses
 */
contract Address is Owned, JsonUtils {
    string fullName;
    string street;
    string city;
    string state;
    string zip;
    bytes summary;  // always up-to-date json summary of string storage attributes

    /**
     * Constructor for a new postal address
     * @param _fullName {string} - full name of sender/recipient
     * @param _street {string} - street name of sender/recipient
     * @param _city {string} - city of sender/recipient
     * @param _state {string} - state of sender/recipient
     * @param _zip {string} - zip of sender/recipient
     */
    function Address(string _fullName, string _street, string _city, string _state, string _zip) {
        edit(_fullName, _street, _city, _state, _zip);
    }

    /**
     * Update a json summary of this contract in storage for externale-contract convenience
     * @return {bytes} - json byte array
     */
    function updateSummary() internal returns (bytes) {
        bytes[] memory array = new bytes[](5);
        array[0] = bytes(fullName);
        array[1] = bytes(street);
        array[2] = bytes(city);
        array[3] = bytes(state);
        array[4] = bytes(zip);

        summary = bytes(JsonUtils.getJsonArray(array));
    }

    /**
     * Save new attributes for this contract
     * @param _fullName {string} - full name of sender/recipient
     * @param _street {string} - street name of sender/recipient
     * @param _city {string} - city of sender/recipient
     * @param _state {string} - state of sender/recipient
     * @param _zip {string} - zip of sender/recipient
     */
    function edit(string _fullName, string _street, string _city, string _state, string _zip) isOwner {
        fullName = _fullName;
        street = _street;
        city = _city;
        state = _state;
        zip = _zip;

        updateSummary();
    }

    /**
     * Return a tuple of the string attributes
     * @return {string, string, string, strng, string} - address as a tuple
     */
    function get() constant returns (string, string, string, string, string) {
        return (fullName, street, city, state, zip);
    }

    /**
     * Return length of the summmary for external-contract convenience
     * @return {uint} - length of the json summary
     */
    function jsonLength() constant returns (uint) {
        return summary.length;
    }

    /**
     * Return character of the summary at a given index
     * @param index {uint} - index of the summary to return
     * @return {bytes1} - character at location in the summary
     */
    function getJsonAt(uint index) constant returns (bytes1) {
        return summary[index];
    }

    /**
     * Return full json representation
     * @return {string} - json representation of the string attributes
     */
    function json() constant returns (string) {
        return string(summary);
    }
}
