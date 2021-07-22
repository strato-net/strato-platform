contract FunctionTest{

int value;
int value_1;

// Function visibility private
function getValue() private view returns (int){
    return value;
}


function setValue(int newValue) external {
    value = newValue;
}

// Function visibility public

function getValue_1() public view returns (int){
    return value_1;
}

function setValue_1(int newValue_1) external {
   value_1 = newValue_1;
}



}