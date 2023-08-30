import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Product assets
contract ProductDocument {
    address public productId;
    string public fileKey;
    string public fileName;
    string public documentType;
    int public uploadDate;
    uint public delDate;

    constructor(
        address _productId,
        string _fileKey,
        string _fileName,
        string _documentType,
        int _uploadDate
    ) public {
        productId = _productId;
        fileKey = _fileKey;
        fileName = _fileName;
        documentType = _documentType;
        uploadDate = _uploadDate;
        delDate = 0;
    }

    // Delete the product document
    function deleteProductDocument() public returns (uint256, string) {
        delDate = block.timestamp;
        return (RestStatus.OK, "ProductDocunent is deleted successfully.");
    }
}