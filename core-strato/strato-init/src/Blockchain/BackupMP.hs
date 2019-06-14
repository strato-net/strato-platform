{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.BackupMP (
  backupMP
  ) where

import           Control.Monad
import           Control.Monad.Change.Modify
import           Control.Monad.IO.Class
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Lazy               as BL
import qualified Data.ByteString.Lazy.Char8         as BLC
import qualified Database.LevelDB                   as LDB
import           Numeric

import           Blockchain.Data.BlockDB
import           Blockchain.Data.Extra
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MPDB
import           Blockchain.SHA
import           Blockchain.Strato.Model.SHA        (keccak256)
import           Blockchain.Stream.VMEvent

addBlock :: HasSQLDB m => BL.ByteString -> m ()
addBlock blockData = do
  _ <- produceVMEvents [ChainBlock $ rlpDecode $ rlpDeserialize $ decodeWithCheck $ BL.toStrict blockData]
--       produceMessages $ map (TopicAndMessage (lookupTopic "block") . makeMessage) [decodeWithCheck $ BL.toStrict blockData]
  return ()

addStateDB::MonadIO m=>LDB.DB->BL.ByteString->m ()
addStateDB db stateDBData = do
  let val = decodeWithCheck $ BL.toStrict stateDBData
  LDB.put db LDB.defaultWriteOptions (keccak256 val) val
  return ()

addCode' :: MonadIO m => LDB.DB -> BL.ByteString -> m ()
addCode' db codeData = do
  let val = decodeWithCheck $ BL.toStrict codeData
  LDB.put db LDB.defaultWriteOptions (keccak256 val) val
  return ()

addHash'::MonadIO m=>LDB.DB->BL.ByteString->m ()
addHash' db hashData = do
  let val = decodeWithCheck $ BL.toStrict hashData
  LDB.put db LDB.defaultWriteOptions (keccak256 val) val
  return ()


decodeWithCheck::B.ByteString->B.ByteString
decodeWithCheck x =
  case B16.decode x of
   (result, "") -> result
   _            -> error $ "bad data passed to decodeWithCheck: " ++ show x

backupMP::( HasSQLDB m
          , HasStateDB m
          , Accessible LDB.DB m
          , Accessible CodeDB m
          , Accessible HashDB m
          ) => m Block
backupMP = do
    sdb <- access (Proxy @LDB.DB)
    codedb <- accesses (Proxy @CodeDB) unCodeDB
    hashdb <- accesses (Proxy @HashDB) unHashDB
    rawData <- liftIO $ fmap BLC.lines $ BL.getContents
    let gb = rlpDecode $ rlpDeserialize $ decodeWithCheck $ BL.toStrict $ BL.tail $ head rawData
    MPDB.initializeBlank
    forM_ rawData $ \line -> do
      case line of
       x | BLC.head x == 'b' -> addBlock $ BL.tail x
       x | BLC.head x == 'c' -> addCode' codedb $ BL.tail x
       x | BLC.head x == 'g' -> putGenesisHash $ SHA $ fromInteger $ fst $ head $ readHex $ BLC.unpack $ BL.tail x
       x | BLC.head x == 'h' -> addHash' hashdb $ BL.tail x
       x | BLC.head x == 's' -> addStateDB sdb $ BL.tail x
       x -> error $ "Malformed line in input: " ++ show x
    return gb
