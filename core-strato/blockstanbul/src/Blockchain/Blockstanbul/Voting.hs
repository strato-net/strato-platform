module Blockchain.Blockstanbul.Voting where

import Data.Word
import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader as BH
import Data.Map
import Data.List ((\\))

editBeneficiary :: Block -> Address -> Bool ->  Block   
editBeneficiary ppl bnf nonc = ppl {blockBlockData = bdata}
                   where noncw = case nonc of
                                           True -> 0xffffffffffffffff
                                           False -> 0x0000000000000000
                         bdata = (blockBlockData ppl) {blockDataCoinbase = bnf,
                                                       blockDataNonce = noncw
                                                     }
                    

extractBeneficiary :: Block -> (Address,Word64)
extractBeneficiary ppl = (benef, dir)
  where benef = BH.beneficiary $ BH.blockToBlockHeader ppl
        dir = BH.nonce $ BH.blockToBlockHeader ppl

--output a new list of validater and beneficiary
updatevalidator :: [Address] -> Map Address (Map Address Word64) -> ([Address],Map Address (Map Address Word64))
updatevalidator val voted = (x,y)
                     where (todrop,toadd) = partitionWithKey (\ k _ -> k `elem` val) voted
                           (addsuccess, _) = partition helperas toadd
                           --(addfail, _) = partition helperaf addunknown
                           (dropsuccess,_) = partition helperd todrop
                           --(dropfail, _) = partition helperdf dropfail
                           x = combined val addsuccess dropsuccess
                           y =  voted Data.Map.\\ addsuccess Data.Map.\\ dropsuccess
                           maxnum = (length val)*2 `div` 3 +1
                           -- minnum = (length val)*1 `div` 3 +1
                           -- check if up and down votes exceed maxnum
                           helperas valu = (numberofup (elems valu) > maxnum)
                           --helperaf valu = (numberofdown (elems valu)>minnum)
                           helperd valu = (numberofdown (elems valu) > maxnum)
                           --helperdf valu =(numberofup (elems valu)>minnum)
                                       
                           
combined :: [Address] -> Map Address (Map Address Word64) -> Map Address (Map Address Word64) -> [Address]
combined val adds drops = (val ++  (keys adds)) Data.List.\\ (keys drops)


numberofup :: [Word64] -> Int
numberofup [] = 0
numberofup (x:xs) = numberofup xs + (if (x == 0xffffffffffffffff) then 1 else 0)

numberofdown :: [Word64] -> Int
numberofdown [] = 0
numberofdown (x:xs) = numberofup xs + (if (x == 0x0000000000000000) then 1 else 0)
    
