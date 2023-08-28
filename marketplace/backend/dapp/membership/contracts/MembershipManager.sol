
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Membership.sol";
import "/dapp/membershipService/contracts/MembershipService.sol";
import "/dapp/productFile/contracts/ProductFile.sol";
import "/dapp/products/contracts/ProductManager.sol";
import "/dapp/Dapp/contracts/Dapp.sol";



/// @title A representation of MembershipManager to manage membership and inventory
contract MembershipManager is RestStatus{


    address owner;
    address[] public memberships;
    mapping(address => address[]) private membershipServices; 
    mapping(address => address[]) private productFiles; 

    Dapp public dapp;

    constructor() public returns (address){
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
        ProductFileSection section;
        ProductFileType type;
    }

    function addMembership(address _dappAddress, MembershipArgs _membershipArgs, MembershipServiceArgs[] _membershipServiceArgs, ProductFileArgs[] _productFileArgs) 
        returns (uint256, address, address) {


        dapp = Dapp(account(_dappAddress, "parent"));

        // if (dapp == address(0)) {
        //     return (RestStatus.NOT_FOUND, address(0));
        // }

        ProductManager productManager = ProductManager(dapp.productManager());



        address product;
        uint256 rs;

        (rs, product) = productManager.addProduct(_membershipArgs.name, _membershipArgs.description, _membershipArgs.manufacturer, 
                                                 _membershipArgs.unitOfMeasurement, _membershipArgs.userUniqueMembershipCode,
                                                 _membershipArgs.uniqueMembershipCode, _membershipArgs.leastSellableUnit,
                                                 _membershipArgs.imageKey, _membershipArgs.isActive, _membershipArgs.category,
                                                 _membershipArgs.subCategory, _membershipArgs.createdDate);
        
        Membership_2 membership = new Membership_2(address(product), _membershipArgs.timePeriodInMonths, _membershipArgs.additionalInfo, _membershipArgs.createdDate);

        //iterate throught MembershipServiceArgs array and create MembershipServices 

        for(uint i = 0; i < _membershipServiceArgs.length; i++) {
            MembershipServiceArgs membershipServiceArg = _membershipServiceArgs[i];
            MembershipService membershipService = new MembershipService(address(membership), 
                                                                        address(membershipServiceArg.serviceId), 
                                                                        membershipServiceArg.membershipPrice, 
                                                                        membershipServiceArg.discountPrice, 
                                                                        membershipServiceArg.maxQuantity, 
                                                                        membershipServiceArg.createdDate, 
                                                                        membershipServiceArg.isActive);
            //add membershipService to membershipServices mapping 
            membershipServices[address(membership)].push(address(membershipService));

        }

        for (uint ip = 0; ip < _productFileArgs.length; ip++) {
            ProductFileArgs productFileArg = _productFileArgs[ip];
            ProductFile productFile = new ProductFile(address(product), 
                                                        productFileArg.fileLocation, 
                                                        productFileArg.fileHash, 
                                                        productFileArg.fileName, 
                                                        productFileArg.uploadDate, 
                                                        productFileArg.createdDate, 
                                                        productFileArg.section, 
                                                        productFileArg.type);

            //add productFile to productFiles mapping
            productFiles[address(product)].push(address(productFile));
        }

        //add membership to memberships array
        memberships.push(address(membership));


        return (RestStatus.OK, address(membership), address(product));
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
