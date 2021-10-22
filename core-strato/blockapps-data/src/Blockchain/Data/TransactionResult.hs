{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Data.TransactionResult
    (
      TransactionResult,
      HasMemTXResultDB(..),
      putTransactionResult,
      putTransactionResults
    ) where

import           Control.DeepSeq
import qualified Data.ByteString.Short                   as BSS
import           Data.Swagger                 hiding (Format)
import           Data.Word
import           Database.Persist             hiding (get)
import qualified Database.Persist.Postgresql  as SQL
import qualified Generic.Random               as GR
import           Test.QuickCheck
import           Servant.Docs                 hiding (pretty)

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Text.Format



instance Format TransactionResult where
  format = show

instance NFData TransactionResult

instance Arbitrary TransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform


instance ToSample TransactionResult where
  toSamples _ = singleSample exampleTxResult

exampleTxResult :: TransactionResult
exampleTxResult = TransactionResult (hash "blockHask")
                                    (hash "txhash")
                                    "I'm a tx result message"
                                    (BSS.pack [5 :: Word8])
                                    "I'm a tx trace"
                                    (21 :: Word256)
                                    (42 :: Word256)
                                    "[MyNewContractA, MyNewContractB]"
                                    "[MyOldContract]"
                                    "I am a state Diff"
                                    0.2321
                                    "New Storage"
                                    "Deleted Storage"
                                    Nothing
                                    Nothing
                                    (Just SolidVM)


instance ToSchema TransactionResult where
  declareNamedSchema _ = return $
    NamedSchema (Just "TransactionResult") mempty






class (Monad m) => HasMemTXResultDB m where
  enqueueTransactionResults :: [TransactionResult] -> m ()
  flushTransactionResults   :: m ()

  enqueueTransactionResult :: TransactionResult -> m ()
  enqueueTransactionResult = enqueueTransactionResults . pure


putTransactionResult :: HasSQLDB m
                     => TransactionResult
                     -> m (Key TransactionResult)
putTransactionResult = fmap head . putTransactionResults . pure

putTransactionResults :: HasSQLDB m
                      => [TransactionResult]
                      -> m [Key TransactionResult]
putTransactionResults = sqlQuery . SQL.insertMany
