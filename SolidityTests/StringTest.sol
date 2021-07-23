
pragma solidity ^0.5.1;
contract StringTest{
    
    string public val1;
    string public val2;
    string public val3; 
    string public val4; 
    string public val5; 
    string public val6;
    string public val7; 
    string public val8; 
    string public val9;
    string public val10;
    string public h; 
    string x;
    string val11;
    constructor()public {
        
/*     
    
    \<newline> (escapes an actual newline)
    \' (single quote)
    \" (double quote)
    \b (backspace)
    \\ (backslash)
    \f (form feed)
    \n (newline)
    \r (carriage return)
    \t (tab)
    \v (vertical tab)
    \xNN (hex escape, see below)
    \uNNNN (unicode escape, see below)

*/
        
       
       val1 = "Hello\nWorld";  //new line
       val2 = "Hello \'World\'";  //single quote
       val3 = "Hello \"World\""; //double quote
       val4 = "Hello\tWorld"; // tab
       val5 = "Hello World\b";   // backspace
       val6 = "Hello \\World"; // backslash
       val7 = "Hello World\r"; // carriage return
       val8 = "Hello \v World"; //vertical tab
       h = "\x4a";
       x = "\uc39b";
    
    }
    
    
    
    
}
