import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Review.sol";

/// @title A representation of ReviewManager to manage reviews
contract ReviewManager {
    // constructor() public {}

    function createReview(
        address _productId,
        address _propertyId,
        address _reviewerAddress,
        string _reviewerName,
        string _title,
        string _description,
        uint _rating,
        uint _createdDate,
        uint _delDate
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

    function updateReview(
        string _title,
        string _description,
        uint _rating,
        address _address
    ) returns (uint256) {
        Review review = Review(_address);
        return review.update(
                _title,
                _description,
                _rating
            );
    }

    function deleteReview(address _reviewAddress) returns (uint256, string) {
        Review review = Review(_reviewAddress);
        return review.deleteReview();
    }
}
