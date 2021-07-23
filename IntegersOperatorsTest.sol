
contract IntegersOperatorsTest{

int public num_1 = 1;
int public num_2 = 2;




int public addition  ;
int public substraction ;
int public multiply ;
int public division  ;
int public mod ;

int public value_1 = 5;
bool  public value_5 ;
bool public value_6 ;

bool public isGreater ;
bool public isLess  ;
bool public isEqual  ;
bool public isNotEqual ;

bytes1 public byte_1 = 0x15 ;
bytes1 public byte_2 = 0xf6;


bytes1 public byte_value_1;
bytes1 public byte_value_2;
bytes1 public byte_value_3;
bytes1 public byte_value_4;


uint public  value_3 = 3;
uint  public value_4 = 4 ;

uint public value_7 ;
uint public value_8 ;


constructor( ){
    
 //Arithmatic operators 
 
addition = num_1 + num_2; //int256: 3
substraction = num_2 - num_1; //int256: 1
multiply = num_1 * num_2; //int256: 2
division = num_2 / num_1 ; //int256: 2
mod = num_2 % num_1; //int256: 0

 
 //Comparisons
 if (value_1 >= 10 && value_1 <= 20){
        value_5 ; }//bool: false
        
 if (value_1 > 10 || value_1 > 20){
        value_6 ;  }//bool: false
         
        
        
 //2 > 1 => bool: true
 isGreater = num_2 > num_1 ; 
 
 //2 < 1 => bool: false
 isLess = num_2 < num_1 ;
 
 // 2 == 1 => bool: false
 isEqual = num_2 == num_1 ;
 
 //2 != 1 => bool: true
 isNotEqual = num_2 != num_1 ;
 
 
 //bytes1 equals to byte
//Bit operator "&" (Bitwise AND) Performs boolean AND operation on each bit of integer argument
 
 byte_value_1 = byte_1 & byte_2 ; //bytes1: 0x14
 
 //Bit operator "|" (Bitwise OR) Performs boolean OR operation on each bit of integer argument
 
 byte_value_2 = byte_1 | byte_2; //0xf7
 
 //Bit operator "^" (Bitwise exclusive or / XOR) Performs boolean exclusive OR operation on each bit of integer argument
 
 byte_value_3 =  byte_1 ^  byte_2 ; //bytes1: 0xea
 
 //Bit operator "~" (Bitwise negation / Not) Performs boolean NOT operation on each bit of integer argument 
 
 byte_value_3 = ~byte_1; //bytes1: 0x00
 
 
 //Right Shift  ">>"    (Moves all bits of the first operand to the right by the number of places specified by the second operand)
 
 value_7 = value_3 >> value_4; //uint256: 0
 
 //Left Shift  ">>"    (Moves all bits of the first operand to the right by the number of places specified by the second operand)
 
  value_8 = value_3 << value_4; //uint256: 48
 
}
 
 
}
 


