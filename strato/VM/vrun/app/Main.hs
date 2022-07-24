{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main (main) where

import qualified Data.ByteString                             as B
import qualified Data.Map                                    as M
import           Data.Time.Clock.POSIX
import           Control.Monad.IO.Class
import           HFlags

import           BlockApps.Logging
import           Blockchain.Bagger.Transactions
import           Blockchain.Data.DataDefs
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.VMContext
import           Blockchain.VMOptions       ()
import           Executable.EVMFlags        ()

import qualified Blockchain.SolidVM as SolidVM
import           EVMRunner
import           VRunOptions
import           VM

import           Text.Format

main :: IO ()
main = do
  args <- $initHFlags "The Ethereum Test program"

  let filename = case args of
                   [v] -> v
                   _ -> error "you need to supply one filename"

  (result, _) <- runLoggingT $ runTestContextM $ do
    MP.initializeBlank
    setStateDBStateRoot Nothing MP.emptyTriePtr

    case flags_vm of
      SolidVM -> do
        codeString <- liftIO $ B.readFile filename
        fmap Right $
          SolidVM.create
                (error "undefined: isRunningTests'")
                (error "undefined: isHomestead")
                (error "undefined: preExistingSuicideList")
                dummyBlockData
                (error "undefined: callDepth")
                (Account (Address 0) Nothing) -- sender
                (Account (Address 0) Nothing) -- origin
                (error "undefined: value")
                (error "undefined: gasPrice")
                (error "undefined: availableGas")
                (Account (Address 0) Nothing) -- newAddress
                (Code codeString) -- code
                emptyHash -- txHash
                Nothing -- chainId
                (Just $ M.fromList [("name", "fred")]) -- medadata
      SolidVM2022 -> error "SolidVM2022 not yet implemented"
      EVM -> runEVM dummyBlockData

  case result of
    Left e -> putStrLn $ show (e::TransactionFailureCause)
    Right r -> putStrLn $ "\n===============================================\n" ++ format r

--  BL.putStr =<< exportMetricsAsText





dummyBlockData :: BlockData
dummyBlockData = BlockData {
        blockDataParentHash = unsafeCreateKeccak256FromWord256 0xabcd,
        blockDataNumber = 1,
        blockDataCoinbase = Address 0xabcd,
        blockDataDifficulty = 1,
        blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0xabcd,
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
        blockDataMixHash=unsafeCreateKeccak256FromWord256 0
        }


