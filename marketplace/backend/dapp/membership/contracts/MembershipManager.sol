import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Membership.sol";
import "/dapp/membershipService/contracts/MembershipService.sol";
import "/dapp/productFile/contracts/ProductFile.sol";
import "/dapp/products/contracts/ProductManager.sol";
import "/dapp/Dapp/contracts/Dapp.sol";
import "/dapp/productFile/contracts/ProductFileSection.sol";
import "/dapp/productFile/contracts/ProductFileType.sol";
import "/dapp/serviceUsage/contracts/ServiceUsage.sol";
import "/dapp/serviceUsage/contracts/PaymentStatus.sol";
import "/dapp/serviceUsage/contracts/Status.sol";

/// @title A representation of Mem_MembershipManager to manage membership and inventory
contract Mem_MembershipManager is
    RestStatus,
    ProductFileSection,
    ProductFileType,
    PaymentStatus,
    Status
{
    address owner;
    address[] public memberships;
    mapping(address => address[]) private membershipServices;
    mapping(address => address[]) private productFiles;

    Dapp public dapp;

    constructor() public {
        owner = msg.sender;
    }

    struct MembershipArgs {
        string name;
        string description;
        string manufacturer;
        UnitOfMeasurement unitOfMeasurement;
        string userUniqueMembershipCode;
        uint uniqueMembershipCode;
        int leastSellableUnit;
        string imageKey;
        bool isActive;
        string category;
        string subCategory;
        uint createdDate;
        int timePeriodInMonths;
        string additionalInfo;
    }

    struct MembershipServiceArgs {
        address serviceId;
        int membershipPrice;
        int discountPrice;
        int maxQuantity;
        int createdDate;
        bool isActive;
    }

    struct ProductFileArgs {
        string fileLocation;
        string fileHash;
        string fileName;
        int uploadDate;
        uint createdDate;
        ProductFileSection currentSection;
        ProductFileType currentType;
    }

    function addMembership(
        address _dappAddress,
        MembershipArgs _membershipArgs,
        MembershipServiceArgs[] _membershipServiceArgs,
        ProductFileArgs[] _productFileArgs
    ) returns (uint256, address, address) {
        dapp = Dapp(account(_dappAddress, "parent"));

        // if (dapp == address(0)) {
        //     return (RestStatus.NOT_FOUND, address(0));
        // }

        Mem_ProductManager productManager = Mem_ProductManager(
            dapp.productManager()
        );

        address product;
        uint256 rs;

        (rs, product) = productManager.addProduct(
            _membershipArgs.name,
            _membershipArgs.description,
            _membershipArgs.manufacturer,
            _membershipArgs.unitOfMeasurement,
            _membershipArgs.userUniqueMembershipCode,
            _membershipArgs.uniqueMembershipCode,
            _membershipArgs.leastSellableUnit,
            _membershipArgs.imageKey,
            _membershipArgs.isActive,
            _membershipArgs.category,
            _membershipArgs.subCategory,
            _membershipArgs.createdDate
        );

        Membership_2 membership = new Membership_2(
            address(tx.origin),
            address(product),
            _membershipArgs.timePeriodInMonths,
            _membershipArgs.additionalInfo,
            _membershipArgs.createdDate
        );

        //iterate throught MembershipServiceArgs array and create MembershipServices

        for (uint i = 0; i < _membershipServiceArgs.length; i++) {
            MembershipServiceArgs membershipServiceArg = _membershipServiceArgs[
                i
            ];
            MembershipService membershipService = new MembershipService(
                address(tx.origin),
                address(membership),
                address(membershipServiceArg.serviceId),
                membershipServiceArg.membershipPrice,
                membershipServiceArg.discountPrice,
                membershipServiceArg.maxQuantity,
                membershipServiceArg.createdDate,
                membershipServiceArg.isActive
            );
            //add membershipService to membershipServices mapping
            membershipServices[address(membership)].push(
                address(membershipService)
            );
        }

        for (uint ip = 0; ip < _productFileArgs.length; ip++) {
            ProductFileArgs productFileArg = _productFileArgs[ip];
            ProductFile productFile = new ProductFile(
                address(tx.origin),
                address(product),
                productFileArg.fileLocation,
                productFileArg.fileHash,
                productFileArg.fileName,
                productFileArg.uploadDate,
                productFileArg.createdDate,
                productFileArg.currentSection,
                productFileArg.currentType
            );

            //add productFile to productFiles mapping
            productFiles[address(product)].push(address(productFile));
        }

        //add membership to memberships array
        memberships.push(address(membership));

        return (RestStatus.OK, address(membership), address(product));
    }

    function addMembershipOrderFlow(
        address _dappAddress,
        address _owner,
        address _productId,
        MembershipArgs _membershipArgs,
        MembershipServiceArgs[] _membershipServiceArgs,
        ProductFileArgs[] _productFileArgs
    ) returns (uint256, address, address) {
        dapp = Dapp(account(_dappAddress, "parent"));

        Membership_2 membership = new Membership_2(
            address(_owner),
            address(_productId),
            _membershipArgs.timePeriodInMonths,
            _membershipArgs.additionalInfo,
            _membershipArgs.createdDate
        );

        //iterate throught MembershipServiceArgs array and create MembershipServices

        for (uint i = 0; i < _membershipServiceArgs.length; i++) {
            MembershipServiceArgs membershipServiceArg = _membershipServiceArgs[
                i
            ];
            MembershipService membershipService = new MembershipService(
                address(_owner),
                address(membership),
                address(membershipServiceArg.serviceId),
                membershipServiceArg.membershipPrice,
                membershipServiceArg.discountPrice,
                membershipServiceArg.maxQuantity,
                membershipServiceArg.createdDate,
                membershipServiceArg.isActive
            );
            //add membershipService to membershipServices mapping
            membershipServices[address(membership)].push(
                address(membershipService)
            );
        }

        for (uint ip = 0; ip < _productFileArgs.length; ip++) {
            ProductFileArgs productFileArg = _productFileArgs[ip];
            ProductFile productFile = new ProductFile(
                address(_owner),
                address(_productId),
                productFileArg.fileLocation,
                productFileArg.fileHash,
                productFileArg.fileName,
                productFileArg.uploadDate,
                productFileArg.createdDate,
                productFileArg.currentSection,
                productFileArg.currentType
            );

            //add productFile to productFiles mapping
            productFiles[address(_productId)].push(address(productFile));
        }

        //add membership to memberships array
        memberships.push(address(membership));

        return (RestStatus.OK, address(membership), address(_productId));
    }

    function addServiceUsage(
        address _itemId,
        address _serviceId,
        uint _serviceDate,
        string _summary,
        Status _status,
        PaymentStatus _paymentStatus,
        address _providerLastUpdated,
        string _providerComment,
        uint _providerLastUpdatedDate,
        uint _pricePaid,
        address _bookedUserAddress
    ) returns (uint256, address) {
        ServiceUsage serviceUsage = new ServiceUsage(
            _itemId,
            _serviceId,
            _serviceDate,
            _summary,
            _status,
            _paymentStatus,
            _providerLastUpdated,
            _providerComment,
            _providerLastUpdatedDate,
            _pricePaid,
            _bookedUserAddress
        );

        return (RestStatus.OK, address(serviceUsage));
    }

    //    function updateMembership (address _membershipAddress, string _description, string _imageKey, bool _isActive, string _userUniqueMembershipCode, uint _scheme)
    //
    //
    //    function deleteMembership (address _membershipAddress) returns (uint256, string) {
    //
    //        Membership membership = Membership(_membershipAddress);
    //        return membership.deleteMembership();
    //    }
    //
    //     function getOrganization(address _owner) public returns(string){
    //        mapping(string => string) ownerCert = getUserCert(_owner);
    //        string ownerOrganization = ownerCert["organization"];
    //
    //        return ownerOrganization;
    //
    //    }
}
