import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

/// @title A representation of Product assets
contract ProductDocument {
    address public productId;
    string public fileKey;
    string public fileHash;
    string public fileName;
    string public fileLocation;
    int public uploadDate;
    string public documentType;
    address public uploadedByUser;
    uint public delDate;
    string public events;


    constructor(
        address _productId,
        string _fileKey,
        string _fileHash,
        string _fileName,
        string _fileLocation,
        int _uploadDate,
        string _documentType,
        int _delDate

    ) public {
        productId = _productId;
        fileKey = _fileKey;
        fileHash = _fileHash;
        fileName = _fileName;
        fileLocation = _fileLocation;
        uploadDate = _uploadDate;
        documentType = _documentType;
        uploadedByUser = tx.origin;
        delDate = 0;
    }

        // Delete the product document
    function deleteProductDocument() public returns(uint256, string){

        delDate = block.timestamp;
        return (RestStatus.OK, "ProductDocunent is deleted successfully.");
      }
    }
}
