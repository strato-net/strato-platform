{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module SolidVM.Events (emitEventValuesForContract) where

import BlockApps.Solidity.ABI.Bridge (encodeEventToLogValues)
import SolidVM.Model.Event (Event (Event))
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import SolidVM.Storage
import Blockchain.SolidVM.SM
import Control.Monad
import qualified Data.Map.Strict as M
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import SolidVM.Model.Value
import SolidVM.Solidity.Parse.UnParser (unparseStatement)

emitEventValuesForContract :: CC.Contract -> CC.Statement -> SolidString -> [Value] -> SM (Maybe Value)
emitEventValuesForContract curCnct st eventName values = do
  expVals <- mapM forceValue values

  -- checks that the event is declared and that the number of args match
  --   DOES NOT check consistency of arg types
  curInfo <- getCurrentCallInfo
  let evs = CC._events curCnct
      mEv = M.lookup eventName evs
  case mEv of
    Nothing ->
      missingType "no corresponding event has been declared for the following emit statement: " (unparseStatement st)
    Just ev -> do
      if (length expVals) /= (length $ CC._eventLogs ev)
        then invalidArguments "arguments to statement are inconsistent with those declared" (unparseStatement st)
        else do
          let address = currentAddress curInfo
          -- pair up field names with values one-by-one (no type checking tho, lol)
          -- let pairs = zip (map (T.unpack . fst) $ CC._eventLogs ev) expStrs

          -- An arg that was never written (unset storage slot, or SNULL) has no
          -- shape of its own; give it the declared type's default so it leaves
          -- the VM as a real value ([] / "" / 0 ...) like every other arg.
          cc <- snd <$> getCurrentCodeCollection
          evArgs <- forM (zip (CC._eventLogs ev) expVals) $
            \(CC.EventLog name _ (CC.IndexedType _ idxType _), value) ->
              (name,) <$> case value of
                SReference _ -> forceValue =<< createDefaultValue cc curCnct idxType
                SNULL -> forceValue =<< createDefaultValue cc curCnct idxType
                _ -> pure value

          tHash <- Env.txHash <$> getEnv
          txSender <- Env.origin <$> getEnv
          let contractName' = labelToText $ CC._contractName curCnct
          -- Derive the Ethereum log topics (topic0 + indexed args) from the event
          -- ABI now, while the CodeCollection is in hand, so the block producer can
          -- build a real logsBloom without re-deriving them. Encodes straight from
          -- the Values; gives the same bytes as the text-based encodeEventToLog the
          -- JSON-RPC layer applies to Cirrus rows, so producer and RPC blooms agree.
          let (evTopicBytes, _) = encodeEventToLogValues eventName ev evArgs
          addEvent $ Event tHash txSender contractName' address eventName evArgs evTopicBytes
          return Nothing
