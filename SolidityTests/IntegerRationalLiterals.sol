pragma solidity ^0.8.6;
contract IntegerRationalLiterals{
    
   uint256 s;
   int256 c;
   int256 i;
   uint256 e;
   int128 n;
   uint8 t;
   uint128 a;
    constructor(){


   s = 2.5e10;
   c = -2.5e10;
   i = 123_000;
   e = 0x2eff_abde;
  // n = 1_2e345_678;
   t = (2**800 + 1) - 2**800; // results in 1
   u = .5 * 8;   
   a = 2.5 * 10;
 
}}
