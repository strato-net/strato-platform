contract TestNoCons {
    string public _tag = "TestNoCons";
    uint public storedData;
    function set(uint x) {
        storedData = x;
    }
    function get() returns (uint retVal) {
        return storedData;
    }
}

contract TestIntCons {
    string public _tag = "TestIntCons";
    int public storedData;
    function TestIntCons(int x) {
        storedData = x;
    }
    function get() returns (int retVal) {
        return storedData;
    }
}

contract TestUIntCons {
    string public _tag = "TestUIntCons";
    uint public storedData;
    function TestUIntCons(uint x) {
        storedData = x;
    }
    function get() returns (uint retVal) {
        return storedData;
    }
}

contract TestAddressCons {
    string public _tag = "TestAddressCons";
    address public storedData;
    function TestAddressCons(address x) {
        storedData = x;
    }
    function get() returns (address retVal) {
        return storedData;
    }
}

contract TestBytesStatCons {
    string public _tag = "TestBytesStatCons";
    bytes32 public storedData;
    function TestBytesStatCons(bytes32 x) {
        storedData = x;
    }
    function get() returns (bytes32 retVal) {
        return storedData;
    }
}

contract TestBytesDynCons {
    string public _tag = "TestBytesDynCons";
    bytes public storedData;
    function TestBytesStatCons(bytes x) {
        storedData = x;
    }
    function get() returns (bytes retVal) {
        return storedData;
    }
}

contract TestBoolCons {
    string public _tag = "TestBoolCons";
    bool public storedData;
    function TestBoolCons(bool x) {
        storedData = x;
    }
    function get() returns (bool retVal) {
        return storedData;
    }
}
contract TestStringCons {
    string public _tag = "TestStringCons";
    string public storedData;
    function TestStringCons(string x) {
        storedData = x;
    }
    function get() returns (string retVal) {
        return storedData;
    }
}

contract TestArrayDynCons {
    string public _tag = "TestArrayDynCons";
    uint[] public storedData;
    function TestArrayDynCons(uint[] x) {
        storedData = x;
    }
    function get() returns (uint[] retVal) {
        return storedData;
    }
}
contract TestArrayStatCons {
    string public _tag = "TestArrayStatCons";
    uint[3] public storedData;
    function TestArrayStatCons(uint[3] x) {
        storedData = x;
    }
    function get() returns (uint[3] retVal) {
        return storedData;
    }
}
contract TestEnumCons {
    string public _tag = "TestEnumCons";
    enum Numbers {Zero, One, Two}
    Numbers public storedData;
    function TestEnumCons(Numbers x) {
        storedData = x;
    }
    function get() returns (Numbers retVal) {
        return storedData;
    }
}
contract TestComplexCons {
    enum Numbers {Zero, One, Two}
    uint public storedDataUInt;
    int public storedDataInt;
    address public storedDataAddress;
    Numbers public storedDataNumbers;
    bool public storedDataBool;
    string public storedDataString ;
    bytes32 public storedDatBytes32St;
    bytes public storedDataBytes32Dy;
    uint[] public storedDataUIntArrDy;
    uint[3] public storedDataUIntArrSt;
    function TestComplexCons(uint _uint, int _int, address _address, Numbers _numbers, bool _bool, string _string,
                             bytes32 _bytes32St, bytes _bytes32Dy, uint[] _uintArrDy, uint[3] _uintArrSt) {
        storedDataUInt = _uint;
        storedDataInt = _int;
        storedDataAddress = _address;
        storedDataNumbers = _numbers;
        storedDataBool = _bool;
        storedDataString  = _string;
        storedDatBytes32St = _bytes32St;
        storedDataBytes32Dy = _bytes32Dy;
        storedDataUIntArrDy = _uintArrDy;
        storedDataUIntArrSt = _uintArrSt;
    }

    function get() returns (uint retVal) {
        return storedDataUInt;
    }
}
