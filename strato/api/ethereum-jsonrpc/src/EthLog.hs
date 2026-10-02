{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module EthLog
  ( EthLog(..)
  , eventRowToLogMaybe
  , ethLogsBloom
  , matchesTopics
  ) where

import BlockApps.Solidity.ABI.Bridge (encodeEventToLog, findEventDef)
import Blockchain.Data.LogsBloom (bloomFromItems)
import Blockchain.Strato.Model.Address (addressFromHex)
import Control.Monad.Composable.CodeDB (CodeDBM, EventRow(..), lookupCodeCollection, lookupCodeHash, lookupDelegatecallCodeHashes)
import Data.Aeson (ToJSON(..), Value(..), object, (.=))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map as M
import qualified Data.Text as T
import GHC.Generics (Generic)
import Numeric (showHex)
import SolidVM.Model.CodeCollection (Event)
import SolidVM.Model.SolidString (stringToLabel)

data EthLog = EthLog
  { address          :: T.Text
  , topics           :: [B.ByteString]
  , logData          :: B.ByteString
  , blockNumber      :: Integer
  , transactionHash  :: T.Text
  , transactionIndex :: Integer
  , blockHash        :: T.Text
  , logIndex         :: Integer
  , removed          :: Bool
  } deriving (Show, Generic)

instance ToJSON EthLog where
  toJSON l = object
    [ "address"          .= hexText (address l)
    , "topics"           .= map hexBytes (topics l)
    , "data"             .= hexBytes (logData l)
    , "blockNumber"      .= hexInt (blockNumber l)
    , "transactionHash"  .= hexText (transactionHash l)
    , "transactionIndex" .= hexInt (transactionIndex l)
    , "blockHash"        .= hexText (blockHash l)
    , "logIndex"         .= hexInt (logIndex l)
    , "removed"          .= removed l
    ]
    where
      hexText t = "0x" <> t
      hexBytes bs = T.pack $ "0x" ++ BC.unpack (B16.encode bs)
      hexInt n = T.pack $ "0x" ++ showHex n ""

-- | The event definition for a row, resolved by the emitting contract's name
-- (stored on the row) rather than by event name alone, so same-named events in
-- one CodeCollection (Pool.Swap vs PoolV3.Swap) are told apart. The
-- CodeCollection is taken from the address's own code first; under a proxy
-- that is the factory bundle, which normally also contains the implementation.
-- If it does not (implementation upgraded to separately compiled code), fall
-- back to the code hashes recorded for @(address, contract_name)@ in the
-- Cirrus @contract@ table by the VM's delegatecall records.
resolveEventDef :: EventRow -> CodeDBM '[] (Maybe Event)
resolveEventDef row =
  case (addressFromHex (BC.pack $ T.unpack (erAddress row)), erContractName row) of
    (Right addr, Just cName) -> do
      own <- maybe [] pure <$> lookupCodeHash addr
      delegated <- lookupDelegatecallCodeHashes addr cName
      firstJustM (own ++ delegated) $ \cHash ->
        fmap (\cc -> findEventDef cc (stringToLabel $ T.unpack cName) evName) <$> lookupCodeCollection cHash
    _ -> pure Nothing
  where
    evName = stringToLabel $ T.unpack (erEventName row)
    firstJustM [] _ = pure Nothing
    firstJustM (x : xs) f = f x >>= \case
      Just (Just r) -> pure (Just r)
      _ -> firstJustM xs f

eventToLog :: Event -> EventRow -> EthLog
eventToLog eventDef row =
  let evName = stringToLabel $ T.unpack (erEventName row)
      textAttrs = M.mapMaybe extractText (erAttributes row)
      (topicBytes, dataBytes) = encodeEventToLog evName eventDef textAttrs
      blockNum = case reads (T.unpack $ erBlockNumber row) :: [(Integer, String)] of
                   [(n, _)] -> n
                   _        -> 0
  in EthLog
      { address          = erAddress row
      , topics           = topicBytes
      , logData          = dataBytes
      , blockNumber      = blockNum
      , transactionHash  = erTransactionHash row
      , transactionIndex = 0
      , blockHash        = erBlockHash row
      , logIndex         = fromIntegral $ erEventIndex row
      , removed          = False
      }
  where
    extractText (String s) = Just s
    extractText _          = Nothing

-- | Yields 'Nothing' when the contract code, code collection, or event
-- definition cannot be resolved, so a single unresolvable event does not fail
-- the whole request.
eventRowToLogMaybe :: EventRow -> CodeDBM '[] (Maybe EthLog)
eventRowToLogMaybe row = fmap (`eventToLog` row) <$> resolveEventDef row

-- | Ethereum logs bloom over a set of reconstructed logs (address + topics).
ethLogsBloom :: [EthLog] -> B.ByteString
ethLogsBloom = bloomFromItems . concatMap logItems
  where
    logItems l = addrBytes (address l) : topics l
    addrBytes t = either (const B.empty) id (B16.decode (BC.pack (T.unpack t)))

matchesTopics :: [String] -> EthLog -> Bool
matchesTopics [] _ = True
matchesTopics filterTopics l =
  and $ zipWith matchTopic filterTopics (topics l ++ repeat B.empty)
  where
    matchTopic "" _ = True
    matchTopic ft logTopic =
      let stripped = if take 2 ft == "0x" then drop 2 ft else ft
      in case B16.decode (BC.pack stripped) of
           Right decoded -> decoded == logTopic
           Left _        -> False
