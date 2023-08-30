import "/dapp/dapp/contracts/Dapp.sol";

contract Carbon {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    string public projectType;
    string public methodology;
    string public projectCountry;
    string public projectCategory;
    string public projectDeveloper;
    string public dMRV;
    string public registry;
    string public creditType;
    string public sdg;
    string public validator;
    string public eligibility;
    string public permanenceType;
    string public reductionType;
    string public unit;
    string public currency;
    int public divisibility;

    constructor(
        address _productId,
        string _projectType,
        string _methodology,
        string _projectCountry,
        string _projectCategory,
        string _projectDeveloper,
        string _dMRV,
        string _registry,
        string _creditType,
        string _sdg,
        string _validator,
        string _eligibility,
        string _permanenceType,
        string _reductionType,
        string _unit,
        string _currency,
        int _divisibility
    ) {
        owner = tx.origin;

        productId = _productId;
        projectType = _projectType;
        methodology = _methodology;
        projectCountry = _projectCountry;
        projectCategory = _projectCategory;
        projectDeveloper = _projectDeveloper;
        dMRV = _dMRV;
        registry = _registry;
        creditType = _creditType;
        sdg = _sdg;
        validator = _validator;
        eligibility = _eligibility;
        permanenceType = _permanenceType;
        reductionType = _reductionType;
        unit = _unit;
        currency = _currency;
        divisibility = _divisibility;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }
}