abstract contract Fungible is Asset{
    uint public totalSupply;
    mapping(address => uint) record public balanceOf;
    string public name;

    event Transfer(address indexed from, address indexed to, uint amount);

    constructor(uint _totalSupply, string _name) SellableAsset() {
        totalSupply = _totalSupply;
        name = _name;
        balanceOf[msg.sender] = _totalSupply;
    } 

    function transfer(address recipient, uint amount) external returns (bool) {
        if(balanceOf[msg.sender] - amount <0) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function mint(uint amount) external {
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
        emit Transfer(address(0), msg.sender, amount);
    }

    function burn(uint amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }
}