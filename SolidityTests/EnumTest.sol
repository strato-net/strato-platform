pragma solidity ^0.8.4;
contract EnumTest{

enum shapes{Triangle,Square,Rectangle}  //enum

shapes shape1;
shapes shape2;
shapes shape3;

constructor(){

shape1 = shapes.Triangle;  // shape1 chooses triangle from enum
shape2 = shapes.Square;    // shape1 chooses square from enum
shape3 = shape1;           // shape3 is the same as shape1 which is a Triangle
 
}
}