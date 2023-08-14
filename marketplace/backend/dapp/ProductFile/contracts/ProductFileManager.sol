import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/ProductFile/contracts/ProductFile.sol";
import "/dapp/ProductFile/contracts/ProductFileSection.sol";
import "/dapp/ProductFile/contracts/ProductFileType.sol";

contract ProductFileManager is RestStatus, ProductFileSection, ProductFileType {

    function createProductFile(
        address _productId,
        string _fileLocation,
        string _fileHash,
        string _fileName,
        int _uploadDate,
        uint _createdDate,
        ProductFileSection _section,
        ProductFileType _type
    ) public returns (uint256, address) {
       
        ProductFile productFile = new ProductFile(_productId, _fileLocation, _fileHash, _fileName, _uploadDate, _createdDate, _section, _type);
        return (RestStatus.CREATED, address(productFile));
    }
}