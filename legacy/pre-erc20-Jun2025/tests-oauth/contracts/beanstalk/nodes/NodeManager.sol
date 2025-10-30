import "../RestStatus.sol";
import "../permission/BeanstalkPermissionManager.sol";
import "../dapp/BeanstalkErrorCodes.sol";

import "./Node.sol";

/**
* Node Manager Container
*
* Storing node details on the network
*
* #see Node
*
* #return none
*/

contract record NodeManager is RestStatus, BeanstalkErrorCodes {
  address public dappAddress;
  BeanstalkPermissionManager permissionManager;
  /**
  * Constructor
  */
  constructor(address _dappAddress, address _permissionManager, string _nodeLabel, string _nodeIp, string _nodePublicKey) public {
    dappAddress = _dappAddress;
    permissionManager = BeanstalkPermissionManager(_permissionManager);
    createNodeInternal(_nodeLabel, _nodeIp, _nodePublicKey);
  }

  mapping (string => address) nodesByIP;
  mapping (string => address) nodesByLabel;
  mapping (string => address) nodesByPublicKey;

  // Check if nodeIp already exists for some node
  function nodeIpExists(string _nodeIp) public returns (bool) {
    return nodesByIP[_nodeIp] != 0;
  }

  // Check if nodeLabel already exists for some node
  function nodeLabelExists(string _nodeLabel) public returns (bool) {
    return nodesByLabel[_nodeLabel] != 0;
  }

  // Check if nodePublicKey already exists for some node
  function nodePublicKeyExists(string _nodePublicKey) public returns (bool) {
    return nodesByPublicKey[_nodePublicKey] != 0;
  }

  function nodePropertyExists(string _nodeIp, string _nodeLabel, string _nodePublicKey) public returns (bool) {
    if (nodeIpExists(_nodeIp) || nodeLabelExists(_nodeLabel) || nodePublicKeyExists(_nodePublicKey)) {
      return true;
    }
    return false;
  }

  // Check if nodePublicKey, nodeLabel and nodeIp exists for a node
  function nodeExists(string _nodeIp, string _nodeLabel, string _nodePublicKey) public returns (bool) {
    if ((nodesByIP[_nodeIp] == nodesByPublicKey[_nodePublicKey]) && (nodesByIP[_nodeIp] == nodesByLabel[_nodeLabel])) {
      return true;
    }
    return false;
  }

  // Create a Node
  function createNodeInternal(
                      string _nodeLabel,
                      string _nodeIp,
                      string _nodePublicKey
                      ) public returns (uint, BeanstalkErrorCodes, address) {
    // Create Node Contract
    Node node = new Node(dappAddress, _nodeLabel, _nodeIp, _nodePublicKey);

    nodesByIP[_nodeIp] = address(node);
    nodesByLabel[_nodeLabel] = address(node);
    nodesByPublicKey[_nodePublicKey] = address(node);

    return (RestStatus.CREATED, BeanstalkErrorCodes.NULL, address(node));
  }

  // Create a Node
  function createNode(
    string _nodeLabel,
    string _nodeIp,
    string _nodePublicKey
  ) public returns (uint, BeanstalkErrorCodes, address) {

    if (nodePropertyExists(_nodeIp, _nodeLabel, _nodePublicKey)) {
      return (RestStatus.BAD_REQUEST, BeanstalkErrorCodes.NODE_PROPERTY_DUPLICATION, 0);
    }

    return createNodeInternal(_nodeLabel, _nodeIp, _nodePublicKey);
  }

  function getByLabel(string _nodeLabel) public returns (uint, address) {
    address node = nodesByLabel[_nodeLabel];
    if (node == address(0)) return (RestStatus.NOT_FOUND, 0);
    return (RestStatus.OK, node);
  }
}
