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
updateValidator :: [Address] -> Map Address (Map Address Bool) -> [Address]
updateValidator val voted = sort newVals
                     where (toDrop,toAdd) = partitionWithKey (\ k _ -> k `elem` val) voted
                           addSuccess = M.filter helperAs toAdd
                           dropSuccess = M.filter helperDs toDrop
                           newVals = combined val addSuccess dropSuccess
                           threshold = (length val)*2 `div` 3
                           -- check if up and down votes exceed maxnum
                           helperAs valu = (length (L.filter (==True) (elems valu)) > threshold)
                           helperDs valu =  (length (L.filter (==False) (elems valu)) > threshold)


combined :: [Address] -> Map Address (Map Address Bool) -> Map Address (Map Address Bool) -> [Address]
combined val adds drops = (val ++  (keys adds)) L.\\ (keys drops)
