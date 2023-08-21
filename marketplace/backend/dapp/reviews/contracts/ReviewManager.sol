import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Review.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ReviewManager {
    // constructor() public {}

    function createReview(
        address _productId,
        address _propertyId,
        address _reviewerAddress,
        string _reviewerName,
        string _title,
        string _description,
        string _rating,
        uint _createdDate,
        int _delDate
    ) returns (uint256, address) {
        Review review = new Review(
            _productId,
            _propertyId,
            _reviewerAddress,
            _reviewerName,
            _title,
            _description,
            _rating,
            _createdDate,
            _delDate
        );

        return (RestStatus.OK, address(review));
    }

    function deleteReview(address _reviewAddress) returns (uint256, string) {
        Review review = Review(_reviewAddress);
        return review.deleteReview();
    }
}
