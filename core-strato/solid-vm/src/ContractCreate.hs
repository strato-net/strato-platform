{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# OPTIONS_GHC -fno-warn-unused-local-binds #-}
module ContractCreate where
import qualified Data.ByteString                             as B
import qualified Data.ByteString.Char8                       as C8
import qualified Data.ByteString.Lazy                        as BL
import qualified Data.Map                                    as M
import           Data.Maybe
import qualified Data.Text                                   as T
import           Data.Time.Clock.POSIX
import           Control.Monad.IO.Class
import           Blockchain.Output
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
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.VMContext
import           Blockchain.VMOptions       ()
import           Executable.EVMFlags        ()
create :: IO ()
create = do
  _ <- $initHFlags "The Ethereum Test program"
  let secretKey = fromJust . Haskoin.makePrvKey $ 0x1234
      rep = B.concat . replicate 100000 . B.pack
      jumpAll = B.replicate 1000000 0x5b
      srcBS = C8.pack "contract TestContract { uint x; constructor() { x = 0; } function getX() returns (uint) { return x; }}"
      metadata = M.fromList $ map (\(k,v) -> (T.pack k, T.pack v))  
                    [ ("VM", "SolidVM")
                    , ("name", "TestContract")]
      t = createContractCreationTX
            0 --nonce
            1 --gas price
            1000000000000000000 --gas limit
            1 --value
            (Code srcBS)
            (Just metadata)
            secretKey
  signedTransaction' <- liftIO $ withSource Haskoin.devURandom t
  let blockData = BlockData {
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
  let signedTransaction = txToOutputTx signedTransaction'
  (result, _) <- runLoggingT $ runTestContextM $ do
    MP.initializeBlank
    setStateDBStateRoot MP.emptyTriePtr
    let addr = Address 0xcf03dd0a894ef79cb5b601a43c4b25e3ae4c67ed
    putAddressState addr AddressState{
      addressStateNonce=0,
        addressStateBalance=10000000000000000000000000000000000000000,
        addressStateContractRoot=MP.blankStateRoot,
        addressStateCodeHash=EVMCode $ unsafeCreateKeccak256FromWord256 0,
        addressStateChainId=Nothing
      }
    runExceptT $ addTransaction Nothing True blockData 10000000000000000000000000000 signedTransaction
  case result of
    Left e -> putStrLn $ show e
    Right r -> putStrLn $ "vrun: " ++ show r
  BL.putStr =<< exportMetricsAsText
txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransactionUnanchored . IngestTx TO.Direct