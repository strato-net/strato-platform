// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./Ownable.sol";

contract Token is Ownable {
    string public name = "USDST";
    string public symbol = "USDST";
    uint8 public customDecimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() Ownable(msg.sender) {}

    function decimals() external view returns (uint8) { return customDecimals; }
    function mint(address to, uint256 amount) external onlyOwner { balanceOf[to] += amount; }
    function burn(address from, uint256 amount) external onlyOwner { require(balanceOf[from] >= amount, "burn>bal"); balanceOf[from] -= amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "to=0");
        require(balanceOf[msg.sender] >= amount, "bal");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(to != address(0), "to=0");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allow");
        require(balanceOf[from] >= amount, "bal");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
