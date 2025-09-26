// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract DelegateLib {
    uint public y;
    address public seenSender;
    address public seenSelf;
    function inc(uint d) external {
        y += d; // when delegate-called, this writes into caller storage
        seenSender = msg.sender;
        seenSelf = address(this);
    }
}

contract Describe_DelegateMappingSolidVMOnly {
    mapping(string => address) public delegates;
    uint public y;
    address public seenSender;
    address public seenSelf;

    function it_delegate_mapping_writes_caller_storage() public {
        DelegateLib lib = new DelegateLib();
        delegates["inc"] = address(lib);
        delegates["inc"].delegatecall("inc", 4);
        require(y == 4, "delegate inc did not update caller storage");
        require(seenSelf == address(this), "delegate context self not caller");
        require(seenSender == msg.sender, "delegate context msg.sender not preserved");
    }
}


