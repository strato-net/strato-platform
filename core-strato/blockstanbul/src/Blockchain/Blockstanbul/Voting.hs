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
extractBeneficiary ppl = case (((BH.beneficiary $ BH.blockToBlockHeader ppl )> 0),(BH.nonce $ BH.blockToBlockHeader ppl)) of
  (True, 0xffffffffffffffff) -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl), True)
  (True, 0x0000000000000000) -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl),False)
  (_, _) -> Nothing
 
--output a new list of validater and beneficiary
updatevalidator :: [Address] -> Map Address (Map Address Bool) -> [Address]
updatevalidator val voted = newVals
                     where (todrop,toadd) = partitionWithKey (\ k _ -> k `elem` val) voted
                           addsuccess = M.filter helperas toadd 
                           dropsuccess = M.filter helperd todrop
                           newVals = combined val addsuccess dropsuccess
                           -- y =  voted M.\\ addsuccess M.\\ dropsuccess
                           threshold = (length val)*2 `div` 3 +1
                           -- check if up and down votes exceed maxnum
                           helperas valu = (length (L.filter (==True) (elems valu)) > threshold)
                           helperd valu =  (length (L.filter (==False) (elems valu)) > threshold)
                                       
                           
combined :: [Address] -> Map Address (Map Address Bool) -> Map Address (Map Address Bool) -> [Address]
combined val adds drops = (val ++  (keys adds)) L.\\ (keys drops)

