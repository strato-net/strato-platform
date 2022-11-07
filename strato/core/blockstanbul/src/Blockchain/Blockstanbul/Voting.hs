module Blockchain.Blockstanbul.Voting where

import Blockchain.Data.Block
import Blockchain.Data.BlockHeader as BH
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Data.Map as M
import Data.List as L

editBeneficiary :: Block -> Address -> Bool ->  Block
editBeneficiary ppl bnf nonc = ppl {blockBlockData = bdata}
                   where noncw = case nonc of
                                           True -> maxBound
                                           False -> 0
                         bdata = (blockBlockData ppl) {blockDataCoinbase = bnf,
                                                       blockDataNonce = noncw
                                                     }

extractBeneficiary :: Block -> Maybe(Address,Bool)
extractBeneficiary ppl = case (((BH.beneficiary $ BH.blockToBlockHeader ppl )> 0),(BH.nonce $ BH.blockToBlockHeader ppl)) of
  (True, x) | x == maxBound -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl), True)
            | x == 0 -> Just ((BH.beneficiary $ BH.blockToBlockHeader ppl),False)
  (_, _) -> Nothing

--output a new list of validater and beneficiary
updateValidator :: [Address] -> Map Address (Map Address Bool) -> ([Address], [Address], [Address])
updateValidator val voted = (sort newVals, keys dropSuccess, keys addSuccess)
                     where (toDrop,toAdd) = partitionWithKey (\ k _ -> k `elem` val) voted
                           addSuccess = M.filter helperAs toAdd
                           dropSuccess = M.filter helperDs toDrop
                           newVals = combined val addSuccess dropSuccess
                           threshold = (length val)*2 `div` 3
                           -- check if up and down votes exceed maxnum
                           helperAs valu = (length (L.filter (==True) (elems valu)) > threshold)
                           helperDs valu = (length (L.filter (==False) (elems valu)) > threshold)


combined :: [Address] -> Map Address (Map Address Bool) -> Map Address (Map Address Bool) -> [Address]
combined val adds drops = (val ++  (keys adds)) L.\\ (keys drops)
