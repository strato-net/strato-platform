
/**
 * Program Definition container
 *
 * This container holds the data for one program definition. The Programs list is managed by the ProgramManager
 *
 * #see ProgramManager
 *
 * #param {string} programId  : unique program ID
 * #param {string} programName  : program name
 *
 * #return none
 */

contract record Program {

  address public dappAddress;
  string public programId;
  string public programName;

  constructor(
    address _dappAddress,
    string _programId,
    string _programName
  ) {
    dappAddress = _dappAddress;
    programId = _programId;
    programName = _programName;
  }
}
