import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./ProductDocument.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ReviewManager {
    // constructor() public {}

    function createReview(
        address _productId,
        string _fileKey,
        string _fileHash,
        string _fileName,
        string _fileLocation,
        int _uploadDate,
        string _documentType,
        string _uploadedByUser,
        int _delDate
    ) returns (uint256, address) {
        Review review = new Review(
         _productId,
         _fileKey,
         _fileHash,
         _fileName,
         _fileLocation,
         _uploadDate,
         _documentType,
         _uploadedByUser,
         _delDate
        );

        return (RestStatus.OK, address(review));
    }

    function deleteReview(address _reviewAddress) returns (uint256, string) {
        Review review = Review(_reviewAddress);
        return review.deleteReview();
    }

}