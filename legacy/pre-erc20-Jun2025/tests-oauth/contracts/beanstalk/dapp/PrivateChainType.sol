/**
* Private Chain Types Enums
*
* Users' private chains types for Agreements
*
* #see Agreement
*
* #return none
*/

contract record PrivateChainType {
  enum PrivateChainType {
    dealerChain,
    dealerGrowerChain,
    growerChain,
    growerProcessorChain
  }
}
