contract AddressTest{
    
    address public my_address; 
    
    // using address payable can send ether or vote after function executes
    address payable public recipient_address;
    
    
    constructor()  {
         my_address = msg.sender;
        
    }

    function transferFund () external payable {
        
    }
    
    function getBalance () external view returns (uint) {
        return address (this).balance;
    }
    
      function etherTransfer (address payable _recipient_address) external {
       _recipient_address.transfer(100);
    }
    

    function etherSend (address payable _recipient_address) external {
       _recipient_address.send(100);
    }
    
    
}
