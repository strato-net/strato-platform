pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;
import "../../mercata-base-contracts/Templates/Payments/StratPaymentService.sol";

/// @title A representation of Token assets
contract Tokens is Mintable {

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {}

    function mint(uint _quantity) internal override returns (UTXO) {
        Tokens newToken = new Tokens(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService));
        return UTXO(address(newToken)); 
    }

    modifier fromPaymentService(string action) {
        StratPaymentService ps = StratPaymentService(msg.sender);
        string err = "Only the current corresponding Payment Service contract can "
                       + action
                       + ".";
        require(ps.stratAddress() == originAddress && ps.ownerCommonName() == "BlockApps", err);
        _;
    }
    
    function purchaseTransfer(address _newOwner, uint _quantity) public fromPaymentService("make a purchase") {
        require(_quantity <= quantity, "Cannot transfer more than available quantity.");
        // regular transfer - isUserTransfer: false, transferNumber: 0
        // transfer feature - isUserTransfer: true, transferNumber: >0
        _transfer(_newOwner, _quantity, false, 0, 0);
    }
}