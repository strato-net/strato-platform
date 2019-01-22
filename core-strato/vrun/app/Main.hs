{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS_GHC -fno-warn-unused-local-binds #-}

module Main where

import qualified Data.ByteString                             as B
import qualified Data.ByteString.Lazy                        as BL
import qualified Data.ByteString.Char8                       as BC
import           Data.Maybe
import           Data.Time.Clock.POSIX
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.Except
import           HFlags
import           Network.Haskoin.Crypto                      (withSource)
import qualified Network.Haskoin.Internals                   as Haskoin
import           Prometheus

import           Blockchain.BlockChain
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Code
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin                    as TO
import qualified Blockchain.Database.MerklePatricia      as MP
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB
import           Blockchain.Sequencer.Event
import           Blockchain.SHA
import           Blockchain.Strato.Model.Address
import           Blockchain.VMContext
import           Blockchain.VMOptions       ()
import           Executable.EVMFlags        ()
import           System.Log.FastLogger  (fromLogStr)

main :: IO ()
main = do
  _ <- $initHFlags "The Ethereum Test program"

  let secretKey = fromJust . Haskoin.makePrvKey $ 0x1234
      rep = B.concat . replicate 100000 . B.pack
      jumpAll = B.replicate 1000000 0x5b
      pushOnes = rep [0x60, 0xf2, 0x50]
      pushBigs = rep $ (0x7f:replicate 32 0x72) ++ [0x50]
      pushMeds = rep $ (0x6f:replicate 16 0x34) ++ [0x50]
      pushSmalls = rep $ (0x67:replicate 8 0x21) ++ [0x50]
      pushLarges = rep $ (0x77:replicate 24 0x99) ++ [0x50]
      t = createContractCreationTX
            0 --nonce
            1 --gas price
            1000000000000000000 --gas limit
            1 --value
            (Code pushLarges)
            Nothing
            secretKey

  signedTransaction' <- liftIO $ withSource Haskoin.devURandom t

  let blockData = BlockData {
        blockDataParentHash = SHA 0xabcd,
        blockDataNumber = 1,
        blockDataCoinbase = Address 0xabcd,
        blockDataDifficulty = 1,
        blockDataUnclesHash = SHA 0xabcd,
        blockDataStateRoot = MP.blankStateRoot,
        blockDataTransactionsRoot = MP.blankStateRoot,
        blockDataReceiptsRoot = MP.blankStateRoot,
        blockDataLogBloom = "",
        blockDataGasLimit = 100000000000000,
        blockDataGasUsed = 1,
        blockDataTimestamp = posixSecondsToUTCTime 0,
        --timestamp = posixSecondsToUTCTime . fromInteger . read . currentTimestamp . env $ test,
        blockDataExtraData = "",
        blockDataNonce = 0,
        blockDataMixHash=SHA 0
        }

  let signedTransaction = txToOutputTx signedTransaction'

  (result, _) <- flip runLoggingT vrunLogger $ runTestContextM $ do
    MP.initializeBlank =<< getStateDB
    setStateDBStateRoot MP.emptyTriePtr

    let addr = Address 0xcf03dd0a894ef79cb5b601a43c4b25e3ae4c67ed
    putAddressState addr AddressState{
      addressStateNonce=0,
        addressStateBalance=10000000000000000000000000000000000000000,
        addressStateContractRoot=MP.blankStateRoot,
        addressStateCodeHash=SHA 0,
        addressStateChainId=Nothing
      }

    runExceptT $ addTransaction True blockData 10000000000000000000000000000 signedTransaction

  case result of
    Left e -> putStrLn $ show e
    Right r -> putStrLn $ "vrun: " ++ show r
  BL.putStr =<< exportMetricsAsText


vrunLogger :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
vrunLogger _ _ _ s = putStrLn $ BC.unpack $ fromLogStr s

txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransaction . IngestTx TO.Direct



