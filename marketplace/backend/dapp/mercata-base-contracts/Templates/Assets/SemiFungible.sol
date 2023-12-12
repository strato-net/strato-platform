pragma es6;
pragma strict;
import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

abstract contract SemiFungible is Asset {
    uint public units; // Number of units this asset represents
    string public serialNumber;
    bool public spent;

    // mapping (address => uint) lockedUnits;
    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) Asset(_name, _description, _images, _files, _createdDate) {
        quantity = _quantity;
        spent = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
        
    }

    function splitAsset(address orderAddress, uint _quantity, address newOwner) public requireOwner("split asset") returns (address[] memory) {
        // uint splitUnits = takeLockedUnits(orderAddress);
        require(spent==false, "Cannot split more units for spent Membership");
        require(_quantity <= quantity, "Cannot split more units than available");
        // Ensure there are enough unlocked units available for the split
        // require(_units <= lockedUnits[orderAddress], "Not enough unlocked units to split");

        address[] newAssets;

        //for example:
        //splitUnitsArray for SemiFungible will be [1,1,1,1,1] if someone buys 5 semiFungibles
        //splitUnitsArray for Carbon will be [5] if someone buys 5 semiFungibles
        for (uint i = 0; i < _quantity; i++) {
            SemiFungible sf = SemiFungible(mint(
                1
            ));
            Asset(sf).whitelistSale(msg.sender);
            Asset(sf).transferOwnership(msg.sender, newOwner);

            newAssets.push(address(sf));
        }

        SemiFungible sf = SemiFungible(mint(
                quantity-_quantity
        ));

        newAssets.push(address(sf));
        spent = true;
        return newAssets;
    }

    function mint(
        uint _quantity
     ) virtual internal returns(address){
        // require(block.timestamp < expirationDate, "Membershipt is expired");
        require(spent==false, "Cannot mint more units for spent Membership");
        SemiFungible newAsset = new SemiFungible(
                name,
                description,
                images,
                files,
                createdDate,
                _quantity
        );
        return address(newAsset);
            // emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }
}