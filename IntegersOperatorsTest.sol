contract IntegersOperatorsTest{

int public num_1 = 1;
int public num_2 = 2;

//Arithmatic operators 


int public addition = num_1 + num_2 ;
int public substraction = num_2 - num_1;
int public multiply = num_1 * num_2;
int public division = num_2 / num_1 ;
// unary-

int public mod = num_2 % num_1;

 //Comparisons

 function comparison_1(int value_1) public pure returns (bool){

     if (value_1 >= 10 && value_1 <= 20){
        return true;
        }
        return false;
 }

bool public value_2 = true ;
function comparison_2 (int value_1) public pure returns (bool){

     if (value_1 > 10 || value_1 < 20){
        return true;
        }
        return false;
}

//compare two values using operators > , < , == ,!=

bool public isGreater = num_2 > num_1 ;
bool public isLess = num_2 < num_1 ;
bool public isEqual = num_2 == num_1 ;
bool public isNotEqual = num_2 != num_1 ;

//bytes1 equals to byte
//Bit operator "&" (Bitwise AND) Performs boolean AND operation on each bit of integer argument

function bitOperator_1(bytes1 byte_1 , bytes1 byte_2) public pure returns (bytes1){
    return byte_1 & byte_2 ;
}

//Bit operator "|" (Bitwise OR) Performs boolean OR operation on each bit of integer argument

function bitOperator_2(bytes1 byte_3 , bytes1 byte_4) public pure returns (bytes1){
    return byte_3 | byte_4 ;
}
 
//Bit operator "^" (Bitwise exclusive or / XOR) Performs boolean exclusive OR operation on each bit of integer argument

function bitOperator_3(bytes1 byte_5 , bytes1 byte_6) public pure returns (bytes1){
    return byte_5 ^  byte_6 ;
}

//Bit operator "~" (Bitwise negation / Not) Performs boolean NOT operation on each bit of integer argument 

function bitOperator_4(bytes1 byte_7 ) public pure returns (bytes1){
    return ~byte_7 ;
}



//Right Shift  ">>"    (Moves all bits of the first operand to the right by the number of places specified by the second operand)
function rightShift(uint value_3 , uint value_4) public pure returns (uint ){
    return value_3 >> value_4;
}

//Left Shift  ">>"    (Moves all bits of the first operand to the right by the number of places specified by the second operand)
function lestShift(uint value_3 , uint value_4) public pure returns (uint ){
    return value_3 << value_4;
}



}