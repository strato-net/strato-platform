pragma es6;
pragma strict;
import <BASE_CODE_COLLECTION>;

import "../../../items/contracts/Tokens.sol";

contract SimpleMercataETHBridge is MercataETHBridge {

    function createEthSt(
        string   _name,
        string   _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) internal {
        ethSt = address(new Tokens(_name, _description, _images, _files, _fileNames, block.timestamp, 1, AssetStatus.ACTIVE, address(0)));
    }
    constructor(
        string   _name,
        string   _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) MercataETHBridge() {
        createEthSt(_name, description, _images, _files, _fileNames);
    }
}


