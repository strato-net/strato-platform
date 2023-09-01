import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./ProductDocument.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductDocumentManager {
    // constructor() public {}

    function createProductDocument(
        address _productId,
        string _fileKey,
        string _fileName,
        string _documentType,
        int _uploadDate,
        uint _delDate
    ) returns (uint256, address) {
        ProductDocument_1 productDocument = new ProductDocument_1(
         _productId,
         _fileKey,
         _fileName,
         _documentType,
         _uploadDate,
         _delDate
        );

        return (RestStatus.OK, address(productDocument));
    }

    function deleteProductDocument(address _productDocumentAddress) returns (uint256, string) {
        ProductDocument_1 productDocument = ProductDocument_1(_productDocumentAddress);
        return productDocument.deleteProductDocument();
    }

}