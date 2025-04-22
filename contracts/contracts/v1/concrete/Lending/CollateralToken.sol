
pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract CollateralToken is ERC20Token {
 constructor(
        string memory _name,
        string memory _description,
        uint _createdDate,
        string memory _symbol,
        uint256 _initialSupply,
        uint8 _decimals
    )
        ERC20Token (
            _name, _description,
            _createdDate, _symbol, _initialSupply, _decimals
        )
    {}
}
