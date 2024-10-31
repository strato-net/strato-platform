{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-unused-local-binds #-}

module Main where

import BlockApps.Logging
import Blockchain.BlockChain
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader (BlockHeader(..))
import qualified Blockchain.Data.BlockHeader as BlockHeader
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.VMContext
import Blockchain.VMOptions ()
import Blockchain.Wiring ()
import Control.Monad.IO.Class
import Control.Monad.Trans.Except
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import Data.Time.Clock.POSIX
import Executable.EVMFlags ()
import HFlags
import Prometheus

main :: IO ()
main = do
  _ <- $initHFlags "The Ethereum Test program"

  let secretKey =
        fromJust . importPrivateKey $
          B.pack
            [ 0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0x12,
              0x34
            ]
      rep = B.concat . replicate 100000 . B.pack
      jumpAll = B.replicate 1000000 0x5b
      pushOnes = rep [0x60, 0xf2, 0x50]
      pushBigs = rep $ (0x7f : replicate 32 0x72) ++ [0x50]
      pushMeds = rep $ (0x6f : replicate 16 0x34) ++ [0x50]
      pushSmalls = rep $ (0x67 : replicate 8 0x21) ++ [0x50]
      pushLarges = rep $ (0x77 : replicate 24 0x99) ++ [0x50]
      t =
        createContractCreationTX
          0 --nonce
          1 --gas price
          1000000000000000000 --gas limit
          1 --value
          (Code pushLarges)
          Nothing
          secretKey

  signedTransaction' <- liftIO t

  let blockData =
        BlockHeader
          { BlockHeader.parentHash = unsafeCreateKeccak256FromWord256 0xabcd,
            BlockHeader.number = 1,
            BlockHeader.beneficiary = CommonName "BlockApps" "Engineering" "James Hormuzdiar" True,
            BlockHeader.difficulty = 1,
            BlockHeader.ommersHash = unsafeCreateKeccak256FromWord256 0xabcd,
            BlockHeader.stateRoot = MP.blankStateRoot,
            BlockHeader.transactionsRoot = MP.blankStateRoot,
            BlockHeader.receiptsRoot = MP.blankStateRoot,
            BlockHeader.logsBloom = "",
            BlockHeader.gasLimit = 100000000000000,
            BlockHeader.gasUsed = 1,
            BlockHeader.timestamp = posixSecondsToUTCTime 0,
            --timestamp = posixSecondsToUTCTime . fromInteger . read . currentTimestamp . env $ test,
            BlockHeader.extraData = "",
            BlockHeader.nonce = 0,
            BlockHeader.mixHash = unsafeCreateKeccak256FromWord256 0
          }

  let signedTransaction = txToOutputTx signedTransaction'

  (result, _) <- runLoggingT $
    runTestContextM $ do
      MP.initializeBlank
      setStateDBStateRoot Nothing MP.emptyTriePtr

      let addr = Account 0xcf03dd0a894ef79cb5b601a43c4b25e3ae4c67ed Nothing
      putAddressState
        addr
        AddressState
          { addressStateNonce = 0,
            addressStateBalance = 10000000000000000000000000000000000000000,
            addressStateContractRoot = MP.blankStateRoot,
            addressStateCodeHash = ExternallyOwned $ unsafeCreateKeccak256FromWord256 0,
            addressStateChainId = Nothing
          }

      runExceptT $ addTransaction Nothing True blockData 10000000000000000000000000000 signedTransaction (Address 0)

  case result of
    Left e -> putStrLn $ show e
    Right r -> putStrLn $ "vrun: " ++ show r
  BL.putStr =<< exportMetricsAsText

txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransactionUnanchored . IngestTx TO.Direct
