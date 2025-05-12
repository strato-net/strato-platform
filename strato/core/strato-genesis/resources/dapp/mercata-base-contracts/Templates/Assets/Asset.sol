import <509>;
//import "../Enums/RestStatus.sol";
//import "../Utils/Utils.sol";

abstract contract record Asset is ERC20, Ownable {
    enum AssetStatus {
        NULL,
        ACTIVE,
        PENDING_REDEMPTION,
        RETIRED,
        MAX
    }

    uint public assetMagicNumber = 0x4173736574; // 'Asset'
    string public ownerCommonName;
    address public originAddress; // For NFTS, this will always be address(this), but this should be the mint address for UTXOs
    string public description;
    string[] public record images;
    string[] public record files;
    string[] public record fileNames;
    uint public createdDate;
    uint public quantity;
    uint public itemNumber;
    AssetStatus public status;

    address public sale;

    event OwnershipTransfer(
        address originAddress,
        address sellerAddress,
        string sellerCommonName,
        address purchaserAddress,
        string purchaserCommonName,
        uint minItemNumber,
        uint maxItemNumber
    );

    event ItemTransfers(
        address indexed assetAddress,
        address indexed oldOwner,
        string oldOwnerCommonName,
        address indexed newOwner,
        string newOwnerCommonName,
        string assetName,
        uint minItemNumber,
        uint maxItemNumber,
        uint quantity,
        uint transferNumber,
        uint transferDate,
        decimal price
    );

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        AssetStatus _status
    ) ERC20(_name, _symbol) Ownable() {
        // TODO: Get ownerCommonName by getting commonName field from on-chain wallet at that address
        description = _description;
        images = _images;
        files = _files; 
        fileNames = _fileNames;
        createdDate = _createdDate;
        quantity = 0;
        status = _status;
        originAddress = address(this);
        itemNumber = 1;
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `value`.
     */
    function transfer(address to, uint256 value) public virtual override returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    function updateAsset(
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) public returns (uint) {
        images = _images;
        files = _files;
        fileNames = _fileNames;
        return RestStatus.OK;
    }

    function updateStatus(AssetStatus _status) public returns (uint) {
        status = _status;
        return RestStatus.OK;
    }
}