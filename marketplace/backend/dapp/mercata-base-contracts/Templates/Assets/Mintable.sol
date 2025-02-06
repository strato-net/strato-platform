pragma es6;
pragma strict;

import <509>;
import "Redeemable.sol";
import "../Enums/RestStatus.sol";

abstract contract Mintable is Redeemable {
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
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals,
        AssetStatus _status,
        address _redemptionService
    ) Redeemable(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _decimals,
        _status,
        _redemptionService
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
        require(_quantity > 0, "Quantity must be greater than 0");
        Mintable m = new Mintable(name, description, images, files, fileNames, createdDate, _quantity, decimals, status, address(redemptionService));
        return UTXO(address(m));
    }

    function mintNewUnits(uint _quantity) public virtual returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(_quantity > 0, "Quantity must be greater than 0");
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
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        UTXO newAsset = mint(_quantity);
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
    }

        // Quantity is already checked by transferOwnership function
    // function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, decimal _price) internal override {
    //     require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
    //     require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
    //     require(_quantity > 0, "Quantity must be greater than 0");
    //     require(checkCondition(), "Condition is not met");
    //     // Create a new UTXO with a portion of the units
    //     try {
    //         // This is a hack to prevent the splitted UTXO from infinitely creating new UTXOs
    //         assert(UTXO(owner).utxoMagicNumber() == utxoMagicNumber);
    //         owner = _newOwner;
    //         ownerCommonName = getCommonName(_newOwner);
    //     } catch {
            
    //         if(_isUserTransfer && _transferNumber>0){
    //         // Emit ItemTransfers Event
    //             emit ItemTransfers(
    //                 originAddress,
    //                 owner,
    //                 ownerCommonName,
    //                 _newOwner,
    //                 getCommonName(_newOwner),
    //                 name,
    //                 itemNumber,
    //                 itemNumber + _quantity - 1,
    //                 _quantity,
    //                 _transferNumber,
    //                 block.timestamp,
    //                 _price
    //                 );
    //         }

    //         emit OwnershipTransfer(
    //             originAddress,
    //             owner,
    //             ownerCommonName,
    //             _newOwner,
    //             getCommonName(_newOwner),
    //             itemNumber,
    //             itemNumber + _quantity - 1
    //         );
    //         _callMint(_newOwner, _quantity);
    //         quantity -= _quantity;
    //         itemNumber += _quantity;
    //     }
    // }

}