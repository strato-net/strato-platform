pragma solidity ^0.8.6;
contract IntegerRationalLiterals{
    
   uint256 s;
   int256 c;
   int256 public i;
   uint256 public e;

   uint8 t;
   uint128 a;
    constructor(){

//scientific notation
   s = 2.5e10;  //s = 2.5^10
   c = -2.5e10;  // c = -2.5^10
   
// underscores to seperate for readability
   i = 123_000;   // i = 123000 == 0x2eff_abde(hexidecimal)
   e = 0x2eff_abde;  //788507614

// 1_2e345_678 // *This should compile* strato doesn't compile with mulitple underscores. 


//using operators in equation
   t = (2**800 + 1) - 2**800; // results in 1
   a = 2.5 * 10; //25
 


//Another issue is that when declaring an int256 variable, you must declare a value at the time 
//of creation or assign the value in a constructor. Otherwise, it will not work. See below for example. 


// int256 i = 123_000;  //works

/*

	int256 i;
	i = 123_000;  // doesn't work	

*/


/*

	int256 i;

	constructor() public {
	
	i = 123_000; //works

}

	

*/


}}