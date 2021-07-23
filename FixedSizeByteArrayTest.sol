

contract FixedSizeByteArrayTest{
    
bytes1 public b1 = 0x01; 
bytes1  public b2 = 0x02; 
    
uint[] public myArray ;
bool public value_1;
bool public  value_2 ; 
bool public value_3 ; 
bool public value_4  ; 
bool public value_5 ;
bool public value_6 ; 
     



bytes1 public byte_value_1;
bytes1 public byte_value_2;
bytes1 public byte_value_3;
bytes1 public byte_value_4;
bytes1 public byte_value_5;
bytes1 public byte_value_6;
bytes1 public byte_value_7;

 uint public  value_7;
    
    
    
constructor (){
        
//Comparisons ( <=, <, ==, !=, >=, > )
     
        
value_1 =  b1 <= b2; //bool: true
value_2 = b1 < b2; //bool: true
value_3 = b1 == b2; //bool: false
value_4 = b1 != b2; //bool: true
value_5 = b1 >= b2; //bool: false
value_6 = b1 > b2; //bool: false
      
      
      
// Bit operators (& , | , ^ , ~)
       
byte_value_1 = b1 & b2; //bytes1: 0x00
byte_value_2 = b1 | b2; //bytes1: 0x03
byte_value_3 = b1 ^ b2; //bytes1: 0x03
byte_value_4 = ~b1 ; //bytes1: 0xfe
       
//Shift operators << and >>
    
//Right Shift  ">>"    
        
byte_value_6 = byte_value_5 >> value_7;
        
 //Left Shift  ">>"     
byte_value_6 = byte_value_5 << value_7;
        
        
indexAccess();
getByteLength ();
        
        
    }
    
    
// Index access: If x is of type bytesI, then x[k] for 0 <= k < I returns the k th byte (read-only).
  
function indexAccess()public view {
      for ( uint i = 0 ; i < 10 ; i ++ )
      {
          myArray[i]  ;
      }
      
  }
    
// .length yields the fixed length of the byte array
  
  
  function getByteLength () public view returns (uint){
      return b1.length;
  }
  
    
    
}
    