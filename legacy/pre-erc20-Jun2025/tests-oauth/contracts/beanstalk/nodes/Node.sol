/**
* Node Definition Container
*
* This container holds the data for one node.
*
* #see NodeManager
*
* #param {string} nodeLabel          : node label
* #param {string} nodeIp             : node ip
* #param {string} nodePublicKey      : node public key
*
* #return none
*/

contract record Node {

  address public dappAddress;
  address public owner;
  string public nodeLabel;
  string public nodeIp;
  string public nodePublicKey;

  /**
  * Constructor
  */
  constructor(
    address _dappAddress,
    string _nodeLabel,
    string _nodeIp,
    string _nodePublicKey
  ) public {
    owner = msg.sender;
    dappAddress = _dappAddress;
    nodeLabel = _nodeLabel;
    nodeIp = _nodeIp;
    nodePublicKey = _nodePublicKey;
  }
}
