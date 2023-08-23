import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Product assets
contract ProductDocument {
    address public productId;
    string public fileKey;
    string public fileHash;
    string public fileName;
    string public fileLocation;
    int public uploadDate;
    string public documentType;
    uint public delDate;

    constructor(
        address _productId,
        string _fileKey,
        string _fileHash,
        string _fileName,
        string _fileLocation,
        int _uploadDate,
        string _documentType
    ) public {
        productId = _productId;
        fileKey = _fileKey;
        fileHash = _fileHash;
        fileName = _fileName;
        fileLocation = _fileLocation;
        uploadDate = _uploadDate;
        documentType = _documentType;
        delDate = 0;
    }

    // Delete the product document
    function deleteProductDocument() public returns (uint256, string) {
        delDate = block.timestamp;
        return (RestStatus.OK, "ProductDocunent is deleted successfully.");
    }
}