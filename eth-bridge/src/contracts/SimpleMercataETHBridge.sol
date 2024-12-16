pragma es6;
pragma strict;
import <9e963ed4ffafd9073327ca9b427ed0b4b2c97a32>;

import "../../../items/contracts/Tokens.sol";

contract SimpleMercataETHBridge is MercataETHBridge {

    function createEthSt() internal {
        ethSt = address(new Tokens("ETHST", "ETHST", [], [] , [] , block.timestamp, 1, AssetStatus.ACTIVE, address(0)));
    }
    constructor() MercataETHBridge() {createEthSt();}
}


