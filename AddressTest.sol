contract AddressTest{
    
    address public my_address;
    uint public balance_value;

    constructor(address _my_address, uint _balance_value) payable {
       my_address = _my_address;
        balance_value = _balance_value;
        getBalance();
        
        
    }

    function getBalance() public view returns (uint) {
        return address(this).balance;
    }
    
    
}
