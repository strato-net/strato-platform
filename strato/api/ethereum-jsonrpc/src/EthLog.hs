{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module EthLog
  ( EthLog(..)
  , eventRowToLog
  , eventRowToLogMaybe
  , eventToLog
  , ethLogsBloom
  , matchesTopics
  ) where

import BlockApps.Solidity.ABI.Bridge (encodeEventToLog, findEventDef)
import Blockchain.Data.LogsBloom (bloomFromItems)
import Blockchain.Strato.Model.Address (addressFromHex)
import Control.Monad.Composable.CodeDB (CodeDBM, EventRow(..), lookupCodeCollection, lookupCodeHash)
import Data.Aeson (ToJSON(..), Value(..), object, (.=))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.Map as M
import qualified Data.Text as T
import GHC.Generics (Generic)
import Numeric (showHex)
import SolidVM.Model.CodeCollection (CodeCollection)
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

eventRowToLog :: EventRow -> CodeDBM IO EthLog
eventRowToLog row = do
  let addrText = erAddress row
  addr <- case addressFromHex (BC.pack $ T.unpack addrText) of
    Left err -> error $ "eth_getLogs: corrupt address in event table: " ++ T.unpack addrText ++ " (" ++ err ++ ")"
    Right a -> return a
  cHash <- lookupCodeHash addr >>= \case
    Nothing -> error $ "eth_getLogs: no code hash for contract " ++ T.unpack addrText ++ " — address_state_ref is missing or has no codeHash"
    Just h -> return h
  cc <- lookupCodeCollection cHash >>= \case
    Nothing -> error $ "eth_getLogs: no CodeCollection for code hash of contract " ++ T.unpack addrText ++ " — code_ref table is corrupt"
    Just c -> return c
  return $ eventToLog cc row

eventToLog :: CodeCollection -> EventRow -> EthLog
eventToLog cc row =
  let evName = stringToLabel $ T.unpack (erEventName row)
      eventDef = case findEventDef cc evName of
        Nothing -> error $ "eth_getLogs: event " ++ T.unpack (erEventName row) ++ " not found in CodeCollection for contract " ++ T.unpack (erAddress row)
        Just e -> e
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

-- | Like 'eventRowToLog', but yields 'Nothing' instead of throwing when the
-- contract code, code collection, or event definition cannot be resolved.
-- Used where a single unresolvable event must not fail the whole request
-- (e.g. bloom computation over every event in a transaction or block).
eventRowToLogMaybe :: EventRow -> CodeDBM IO (Maybe EthLog)
eventRowToLogMaybe row =
  case addressFromHex (BC.pack $ T.unpack (erAddress row)) of
    Left _ -> pure Nothing
    Right addr ->
      lookupCodeHash addr >>= \case
        Nothing -> pure Nothing
        Just cHash ->
          lookupCodeCollection cHash >>= \case
            Nothing -> pure Nothing
            Just cc -> pure $
              case findEventDef cc (stringToLabel $ T.unpack (erEventName row)) of
                Nothing -> Nothing
                Just _  -> Just (eventToLog cc row)

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
