pragma solidity ^0.8.4;
contract BooleanTest {
    
    
    bool val1;
    bool val2;
    bool val3;
    bool val4;
    bool val5;
    bool val6;
    bool val7;
    bool val8;
    bool public val9;
    
            constructor() {
        
        val1 = true;
        val2 = true;
        val3 = false;
        val4 = false;
        val5 = false;
        val6 = false;
        val7 = true;
    
        // ! && || == !=
        
        
        val1 = !val2;   //val1 = false
        
        if(val2 == val3){     //val2 = true and val3 = false
            val6 = true;     //shouldn't work.
        }
        
        if(val6 != true){     //val6 = false
             
            val7 = false;    //should work. -> val7 now = false
            
        }
        
        if(val7 == true && val6 == false){   //val7= true , val6 = false
            val8 = true;      //should work. 
        }
        
        if((val8 == true && val7 == true) || (val6 == true)){  //val8 = true , val7 = false(this will be wrong) , val6 = false(this will be wrong)
            val9 = false;    //shouldn't work.
        }
        else{
            val9 = true;   //should work.
        }
        //if val9 == false then something broke, if val9 == true, everything worked.
        
    }
    
}
