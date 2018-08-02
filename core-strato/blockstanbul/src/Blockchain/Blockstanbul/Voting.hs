module Blockchain.Blockstanbul.Voting where

import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader as BH
import Data.Map as M
import Data.List as L

editBeneficiary :: Block -> Address -> Bool ->  Block   
editBeneficiary ppl bnf nonc = ppl {blockBlockData = bdata}
                   where noncw = case nonc of
                                           True -> 0xffffffffffffffff
                                           False -> 0x0000000000000000
                         bdata = (blockBlockData ppl) {blockDataCoinbase = bnf,
                                                       blockDataNonce = noncw
                                                     }
                    

extractBeneficiary :: Block -> Maybe(Address,Bool)
extractBeneficiary ppl = case (BH.nonce $ BH.blockToBlockHeader ppl) of
  0xffffffffffffffff -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl), True)
  0x0000000000000000 -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl),False)
  _ -> Nothing
 
--output a new list of validater and beneficiary
updatevalidator :: [Address] -> Map Address (Map Address Bool) -> ([Address],Map Address (Map Address Bool))
updatevalidator val voted = (x,y)
                     where (todrop,toadd) = partitionWithKey (\ k _ -> k `elem` val) voted
                           addsuccess = M.filter helperas toadd 
                           dropsuccess = M.filter helperd todrop
                           x = combined val addsuccess dropsuccess
                           y =  voted M.\\ addsuccess M.\\ dropsuccess
                           maxnum = (length val)*2 `div` 3 +1
                           -- check if up and down votes exceed maxnum
                           helperas valu = (length (L.filter (==True) (elems valu)) > maxnum)
                           helperd valu =  (length (L.filter (==False) (elems valu)) > maxnum)
                                       
                           
combined :: [Address] -> Map Address (Map Address Bool) -> Map Address (Map Address Bool) -> [Address]
combined val adds drops = (val ++  (keys adds)) L.\\ (keys drops)

