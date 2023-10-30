import "./ClothingSize.sol";

/// @title The Clothing Category
contract Clothing is ClothingSize{

    string public category = "Clothing";
    string public company;
    ClothingSize public size;

    constructor (
        string _company,
        ClothingSize _size
    ) public {
        company = _company;
        size = _size;
    }
}