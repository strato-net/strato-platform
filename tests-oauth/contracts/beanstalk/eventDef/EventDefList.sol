
/**
 * Event Definition List
 *
 * Named array of event definitions. Used to create both LifeCycle and Requirements eventdef lists
 *
 * #see EventDef
 *
 * #param {string} programId : the list programId
 * #param {bytes32[]} eventIdsBytes32 : event id array
 *
 * #return none
 */

contract EventDefList {

  string public programId;
  string[] public eventIds;

  constructor(
    string _programId,
    string[] _eventIds
  ) {
    programId = _programId;
    eventIds = _eventIds;
  }
}
