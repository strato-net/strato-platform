module Blockchain.Bagger.TransactionList
  ( TransactionList,
    -- , emptyTransactionList
    singletonTransactionList,
    insertTransaction,
    trimBelowNonce,
    trimAboveCost,
    popSequential,
    toList,
  )
where

import Blockchain.Data.TransactionDef
import Blockchain.Model.WrappedBlock (OutputTx (..))
import Data.Foldable (foldl')
import qualified Data.Map.Strict as M

type TransactionList = M.Map Integer OutputTx

nonce :: OutputTx -> Integer
nonce = transactionNonce . otBaseTx

--emptyTransactionList :: TransactionList
--emptyTransactionList = M.empty

singletonTransactionList :: OutputTx -> TransactionList
singletonTransactionList t = M.singleton (transactionNonce $ otBaseTx t) t

-- should replace TXs with identical nonces but different gas cost to one with higher gas cost
-- returns (Maybe <txThatWasReplaced/txToDropFromSeen>, newTransactionList)
insertTransaction :: OutputTx -> TransactionList -> (Maybe OutputTx, OutputTx, TransactionList)
insertTransaction t tl =
  let nonce' = nonce t
      (oldTx, newTL) = M.insertLookupWithKey (\_ a _ -> a) nonce' t tl
   in (oldTx, t, newTL)

trimBelowNonce :: Integer -> TransactionList -> ([OutputTx], TransactionList)
trimBelowNonce nonce' tl = let (lt, gte) = M.partitionWithKey (\k _ -> k < nonce') tl in (M.elems lt, gte)

trimAboveCost :: Integer -> (OutputTx -> Integer) -> TransactionList -> ([OutputTx], TransactionList)
trimAboveCost maxCost calcCost tl =
  let (tooHigh, justRight) = M.partitionWithKey (\_ v -> calcCost v > maxCost) tl in (M.elems tooHigh, justRight)

popSequential :: Integer -> TransactionList -> ([OutputTx], TransactionList)
popSequential nonce' tl = (popped, M.fromList kept)
  where
    (_, popped, kept) = foldl' theFold initialFoldState (M.toAscList tl)
    initialFoldState = (nonce' - 1, [], [])
    theFold (lastNonce, popped', kept') e@(elemNonce, elemTx) =
      if elemNonce == lastNonce + 1
        then (elemNonce, elemTx : popped', kept')
        else (lastNonce, popped', e : kept')

toList :: TransactionList -> [OutputTx]
toList = M.elems
