import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Review.sol";

/// @title A representation of ReviewManager to manage reviews
contract ReviewManager_0_2 {
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
        Review_0_5 review = new Review_0_5(
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
        Review_0_5 review = Review_0_5(_address);
        return review.update(
                _title,
                _description,
                _rating
            );
    }

    function deleteReview(address _reviewAddress) returns (uint256, string) {
        Review_0_5 review = Review_0_5(_reviewAddress);
        return review.deleteReview();
    }
}
