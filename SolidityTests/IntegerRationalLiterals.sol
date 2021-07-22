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

//using operators in equation
   t = (2**800 + 1) - 2**800; // results in 1
   a = 2.5 * 10; //25
 
}}
