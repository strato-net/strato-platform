
/**
 * Exception Definition List
 *
 * Named array of exception definitions. Used to create both LifeCycle and Requirements exceptiondef lists
 *
 * #see ExceptionDef
 *
 * #param {bytes32[]} exceptionIdsBytes32 : exception id array
 *
 * #return none
 */

contract ExceptionDefList {

  string[] public exceptionIds;

  constructor(
    string[] _exceptionIds
  ) {
    exceptionIds = _exceptionIds;
  }
}
