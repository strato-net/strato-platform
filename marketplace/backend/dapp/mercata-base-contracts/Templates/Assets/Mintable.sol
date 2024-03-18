pragma es6;
pragma strict;

import <509>;
import "UTXO.sol";
import "../Enums/RestStatus.sol";

abstract contract Mintable is UTXO {
    uint public mintableMagicNumber = 0x4d696e7461626c65; // 'Mintable'
    address public minterAddress;
    string public minterCommonName;
    address public mintAddress;
    bool public isMint;
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) UTXO(
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity
    ) {
        try {
            assert(Mintable(msg.sender).mintableMagicNumber() == mintableMagicNumber);
            minterAddress = Mintable(msg.sender).minterAddress();
            mintAddress = Mintable(msg.sender).mintAddress();
            isMint = false;
        } catch {
            minterAddress = msg.sender;
            mintAddress = address(this);
            isMint = true;
        }
        minterCommonName = getCommonName(minterAddress);
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        Mintable m = new Mintable(name, description, images, files, createdDate, _quantity);
        return UTXO(m);
    }

    function mintNewUnits(uint _quantity) public returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
        require(getCommonName(msg.sender) == minterCommonName, "Only the minter can mint new units");
        emit OwnershipTransfer(
            originAddress,
            address(0),
            "",
            owner,
            ownerCommonName,
            itemNumber + quantity,
            itemNumber + quantity + _quantity - 1
        );
        quantity += _quantity;
        return RestStatus.OK;
    }
    
    function _callMint(address _newOwner, uint _quantity) internal virtual override{
        UTXO newAsset = mint(_quantity);
        // regular transfer - isUserTransfer: false, transferNumber: 0
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
    }
}