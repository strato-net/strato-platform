
contract Parent {
    uint private _name;

    constructor(uint name_) {
        _name = name_;
    }

    function getName() public view returns (uint) {
        return _name;
    }
}

contract Child is Parent {
    constructor(uint name_) Parent(name_) {
        _name = 420;
    }
}

contract Describe_PrivateVariables {
    Parent parent;
    Child child;

    function beforeAll() public {
        parent = new Parent(1);
        child = new Child(2);
    }

    function it_upholds_privacy() public {
        log("Parent name:", parent.getName());
        log("Child name:", child.getName());
        require(parent.getName() == 1, "Parent name not set correctly");
        require(child.getName() == 2, "Child name not set correctly");
    }
}