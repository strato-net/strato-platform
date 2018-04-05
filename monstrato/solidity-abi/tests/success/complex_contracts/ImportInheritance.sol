contract owned {
    function owned() { owner = msg.sender; }
    address owner;
}

// Use "is" to derive from another contract. Derived contracts can access all non-private members
// including internal functions and state variables. These cannot be accessed externally via
// `this`, though.
contract mortal is owned {
    function kill() { if (msg.sender == owner) suicide(owner); }
}
