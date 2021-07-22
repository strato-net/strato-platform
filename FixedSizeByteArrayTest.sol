contract FixedSizeByteArrayTest{
    
    bytes1 public b1 = 0x01; 
    bytes1  public b2 = 0x02; 
    
    uint[] public myArray ;
    
    
    //Comparisons ( <=, <, ==, !=, >=, > )
    function comparison_1() public view returns (bool) {
        return b1 <= b2; 
    }
    
   function comparison_2() public view returns (bool) {
        return b1 < b2; 
    }
    
     function comparison_3() public view returns (bool) {
        return b1 == b2; 
    }
    
     function comparison_4() public view returns (bool) {
        return b1 != b2; 
    }
    
     function comparison_5() public view returns (bool) {
        return b1 >= b2; 
    }
    
     function comparison_6() public view returns (bool) {
        return b1 > b2; 
    }
    
    
    
    // Bit operators (& , | , ^ , ~)
    
      function bitOperator_1() public view returns (bytes1) {
        return b1 & b2; 
    }
    
       function bitOperator_2() public view returns (bytes1) {
        return b1 | b2; 
    }
    
       function bitOperator_3() public view returns (bytes1) {
        return b1 ^ b2; 
    }
    
       function bitOperator_4() public view returns (bytes1) {
        return ~b1 ; 
    }
    
    
   
    
//Shift operators << and >>
    
  //Right Shift  ">>"   
function rightShift(bytes1 value_1 , uint  value_2) public pure returns (bytes1 ){
    return value_1 >> value_2;
}
     //Left Shift  ">>"   
function leftShift(bytes1 value_1 , uint  value_2) public pure returns (bytes1 ){
    return value_1 << value_2;
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
