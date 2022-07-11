{-# LANGUAGE FlexibleContexts #-}

module EVMRunner where

import           Control.Monad.IO.Class
import           Control.Monad.Trans.Except
import qualified Data.ByteString                             as B
import           Data.Maybe

import           Prometheus

import qualified Blockchain.Bagger                     as Bagger
import           Blockchain.Bagger.Transactions
import           Blockchain.BlockChain
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin                    as TO
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.VMContext
import           Blockchain.VMOptions       ()
import           Executable.EVMFlags        ()

runEVM :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m) =>
          BlockData -> m (Either TransactionFailureCause ExecResults)
runEVM blockData = do
  let addr = Account 0xcf03dd0a894ef79cb5b601a43c4b25e3ae4c67ed Nothing
  putAddressState addr AddressState{
    addressStateNonce=0,
    addressStateBalance=10000000000000000000000000000000000000000,
    addressStateContractRoot=MP.blankStateRoot,
    addressStateCodeHash=EVMCode $ unsafeCreateKeccak256FromWord256 0,
    addressStateChainId=Nothing
    }

  let secretKey = fromJust . importPrivateKey $ B.pack [0,0,0,0,0,0,0,0,
                                                        0,0,0,0,0,0,0,0,
                                                        0,0,0,0,0,0,0,0,
                                                        0,0,0,0,0,0, 0x12, 0x34]
      rep = B.concat . replicate 100000 . B.pack
--      jumpAll = B.replicate 1000000 0x5b
--      pushOnes = rep [0x60, 0xf2, 0x50]
--      pushBigs = rep $ (0x7f:replicate 32 0x72) ++ [0x50]
--      pushMeds = rep $ (0x6f:replicate 16 0x34) ++ [0x50]
--      pushSmalls = rep $ (0x67:replicate 8 0x21) ++ [0x50]
      pushLarges = rep $ (0x77:replicate 24 0x99) ++ [0x50]
      t = createContractCreationTX
            0 --nonce
            1 --gas price
            1000000000000000000 --gas limit
            1 --value
            (Code pushLarges)
            Nothing
            secretKey

  signedTransaction' <- liftIO t

  let signedTransaction = txToOutputTx signedTransaction'

  runExceptT $ addTransaction Nothing True blockData 10000000000000000000000000000 signedTransaction

txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransactionUnanchored . IngestTx TO.Direct
