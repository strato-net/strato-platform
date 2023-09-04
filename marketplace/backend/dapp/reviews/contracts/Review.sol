import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";

/// @title A representation of Review assets
contract Review {
    address public productId;
    address public propertyId;
    address public reviewerAddress;
    string public reviewerName;
    string public title;
    string public description;
    uint public rating;
    uint public createdDate;
    uint public delDate;

    constructor(
        address _productId,
        address _propertyId,
        address _reviewerAddress,
        string _reviewerName,
        string _title,
        string _description,
        uint _rating,
        uint _createdDate,
        uint _delDate
    ) public {
        productId = _productId;
        propertyId = _propertyId;
        reviewerAddress = _reviewerAddress;
        reviewerName = _reviewerName;
        title = _title;
        description = _description;
        rating = _rating;
        createdDate = _createdDate;
        delDate = 0;
    }

    function update(
        string _title,
        string _description,
        uint _rating
    ) returns (uint) {
        if (reviewerAddress != tx.origin) {
            return (RestStatus.FORBIDDEN);
        }
        title = _title;
        description = _description;
        rating = _rating;

        return RestStatus.OK;
    }

    // Delete the review
    function deleteReview() public returns (uint256, string) {
        if (reviewerAddress != tx.origin) {
            return (
                RestStatus.FORBIDDEN,
                "Only the reviewer can delete the review."
            );
        }
        delDate = block.timestamp;
        return (RestStatus.OK, "Review is deleted successfully.");
    }
}
