{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.VM.TestEthereum
    ( runAllTests
    , runTest
    , runTests
    , noLog
    ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.State
import           Data.Aeson
import qualified Data.ByteString                             as B
import qualified Data.ByteString.Lazy                        as BL
import           Data.Either
import           Data.IORef.Unboxed
import           Data.List
import qualified Data.Map                                    as M
import           Data.Maybe
import qualified Data.Set                                    as S
import           HFlags
import           Network.Haskoin.Crypto                      (withSource)
import qualified Network.Haskoin.Internals                   as Haskoin
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen                hiding ((<$>), (</>))
import           Test.Hspec.Expectations.Lifted

import           Blockchain.BlockChain
import qualified Blockchain.Colors                           as C
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Code
import           Blockchain.Data.ExecResults
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin                    as TO
import qualified Blockchain.Database.MerklePatricia          as MP
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.SHA                 (keccak256)
import           Blockchain.SHA
import           Blockchain.Util
import           Blockchain.VM
import           Blockchain.VM.Code
import           Blockchain.VM.Environment
import           Blockchain.VM.VMM (readGasRemaining)
import           Blockchain.VM.VMState
import           Blockchain.VMContext

import           Blockchain.VM.TestDescriptions
import           Blockchain.VM.TestFiles

defineFlag "debugEnabled" False "enable debugging"
defineFlag "debugEnabled2" False "enable debugging"

populateAndConvertAddressState :: Maybe Word256 -> Address -> AddressState' -> ContextM AddressState
populateAndConvertAddressState cid owner addressState' = do
  addCode . codeBytes . contractCode' $ addressState'

  forM_ (M.toList $ storage' addressState') $
    \(key, val) -> putStorageKeyVal' owner (fromIntegral key) (fromIntegral val)

  addressState <- getAddressState owner

  return $
    AddressState
      (nonce' addressState')
      (balance' addressState')
      (addressStateContractRoot addressState)
      (hash $ codeBytes $ contractCode' addressState')
      cid

showHexInt::Integer->String
showHexInt x
  = let xHex = showHex x ""
    in (if odd $ length xHex
        then "0x0"
        else "0x")
       ++ xHex

getDataAndRevertAddressState::Address->AddressState->ContextM AddressState'
getDataAndRevertAddressState _ addressState = do
  theCode <- fromMaybe (error $ "Missing code in getDataAndRevertAddressState: " ++ format addressState) <$>
             getCode (addressStateCodeHash addressState)

  -- Copied wholesale from Context.hs:getAllStorageKeyVals'
  -- since that function requires an unhashed owner.
  -- This piece of code really should be in the lib somewhere
  storage <- do
    dbs' <- get
    let mpdb = (contextStateDB dbs'){stateRoot=addressStateContractRoot addressState}
    kvs <- lift $ unsafeGetKeyVals mpdb ""
    let toInt = fromInteger . rlpDecode . rlpDeserialize . rlpDecode
    return $ map (fmap toInt) kvs :: ContextM [(Key, Integer)]

  return $
    AddressState'
    (addressStateNonce addressState)
    (addressStateBalance addressState)
    (M.mapKeys (byteString2Integer . nibbleString2ByteString) . M.map fromIntegral $ M.fromList storage)
    (Code theCode)

getNumber::String->Integer
getNumber "" = 0
getNumber x  = read x

--Just a cheap trick to enable the display of nearly all storage keys in the tests
someHashes::M.Map SHA Int
someHashes = M.fromList $ map (\x -> (hash (word256ToBytes x), fromIntegral x)) [0..255]

showHash::Integer->String
showHash val =
  case M.lookup (SHA (fromIntegral val)) someHashes of
   Nothing -> showHexInt val ++ "[#ed]"
   Just x  -> show x

showInfo::(Address,AddressState')->String
showInfo (key,AddressState'{nonce'=n, balance'=b, storage'=s, contractCode'=Code c}) =
    show (pretty key) ++ "[#ed]" ++ "(" ++ show n ++ "): " ++ show b ++
         (if M.null s
          then ""
          else (", " ++) . show . M.toList . M.map showHexInt . M.mapKeys showHash $ s
         ) ++
         (if B.null c then "" else ", CODE:[" ++ C.blue (format c) ++ "]")
showInfo _ = undefined

addressStates::ContextM [(Address, AddressState')]
addressStates = do
  addrStates <- getAllAddressStates
  let addrs = map fst addrStates
      states = map snd addrStates
  states' <- zipWithM getDataAndRevertAddressState addrs states
  return $ zip addrs states'

txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransaction . IngestTx TO.Direct

runTest::Test-> ContextM ()
runTest test = do
  when flags_debugEnabled $
    liftIO . print $ test
  let cid = Nothing

  MP.initializeBlank =<< getStateDB
  setStateDBStateRoot emptyTriePtr

  forM_ (M.toList $ pre test) $
    \(addr, s) -> do
      state' <- populateAndConvertAddressState cid addr s
      putAddressState addr state'

  beforeAddressStates <- addressStates

  let block =
        Block {
          blockBlockData = BlockData {
             blockDataParentHash = fromMaybe (SHA 0x0) . previousHash . env $ test,
             blockDataNumber = read . currentNumber . env $ test,
             blockDataCoinbase = currentCoinbase . env $ test,
             blockDataDifficulty = read . currentDifficulty . env $ test,
             blockDataUnclesHash = SHA 0, --error "unclesHash not set",
             blockDataStateRoot = StateRoot "", -- error "bStateRoot not set",
             blockDataTransactionsRoot = StateRoot "", -- error "transactionsRoot not set",
             blockDataReceiptsRoot = StateRoot "", -- error "receiptsRoot not set", -- StateRoot ""
             blockDataLogBloom = "", --error "logBloom not set",
             blockDataGasLimit = currentGasLimit . env $ test,
             blockDataGasUsed = 0, --error "gasUsed not set",
             blockDataTimestamp = currentTimestamp . env $ test,
             --timestamp = posixSecondsToUTCTime . fromInteger . read . currentTimestamp . env $ test,
             blockDataExtraData = "", --error "extraData not set",
             blockDataNonce = 0, --error "nonce not set",
             blockDataMixHash=SHA 0 --error "mixHash not set"
             },
          blockReceiptTransactions = [], --error "receiptTransactions not set",
          blockBlockUncles = [] --error "blockUncles not set"
          }

  (result, retVal, gasRemaining, _, returnedCallCreates, _) <-
    case theInput test of
      IExec exec -> do

        let env' =
              Environment{
                envGasPrice = getNumber $ gasPrice' exec,
                envBlockHeader = blockBlockData block,
                envOwner = address' exec,
                envOrigin = origin exec,
                envInputData = theData $ data' exec,
                envSender = caller exec,
                envValue = getNumber $ value' exec,
                envCode = code exec,
                envJumpDests = getValidJUMPDESTs $ code exec,
                envTxHash = SHA 0,
                envChainId = Nothing,
                envMetadata = Nothing
                }

        cxt <- get
        cfg <- ask
        vmState0 <- liftIO $ startingState True False env' cfg cxt

        (result, vmState1) <- lift . lift $ do
          gasref <- liftIO . newCounter . fromIntegral . getNumber . gas' $ exec
          flip runStateT vmState0{vmGasRemaining=gasref, debugCallCreates=Just []} . runExceptT $ do
            runCodeFromStart

            vmState2 <- lift get
            when flags_debugEnabled $
              liftIO $ putStrLn $ "Removing accounts in suicideList: " ++
                                intercalate ", " (show . pretty <$> S.toList (suicideList vmState2))

            forM_ (suicideList vmState2) deleteAddressState
        when flags_debugEnabled $ do
          liftIO . putStrLn . ("runCodeFromStart: " ++) . show $ result
          liftIO . putStrLn . ("runCodeFromStart: " ++) . show $ vmState1

        put $ dbs vmState1

        flushMemStorageDB
        flushMemAddressStateDB

        case vmException vmState1 of
         Nothing -> do
          gr <- readGasRemaining vmState1
          return (result, returnVal vmState1, gr, logs vmState1, debugCallCreates vmState1, Just vmState1)
         Just _ -> return (Right (), Nothing, 0, [], Just [], Nothing)

      ITransaction transaction -> do
        let t = case tTo' transaction of
                Nothing ->
                  createContractCreationTX
                    (getNumber $ tNonce' transaction)
                    (getNumber $ tGasPrice' transaction)
                    (getNumber $ tGasLimit' transaction)
                    (getNumber $ tValue' transaction)
                    (Code $ theData $ tData' transaction)
                    Nothing
                    (tSecretKey' transaction)
                Just a ->
                  createMessageTX
                    (getNumber $ tNonce' transaction)
                    (getNumber $ tGasPrice' transaction)
                    (getNumber $ tGasLimit' transaction)
                    a
                    (getNumber $ tValue' transaction)
                    (theData $ tData' transaction)
                    Nothing
                    (tSecretKey' transaction)
        signedTransaction' <- liftIO $ withSource Haskoin.devURandom t
        let signedTransaction = txToOutputTx signedTransaction'
        result <-
          runExceptT $ addTransaction True (blockBlockData block) (currentGasLimit $ env test) signedTransaction
        when flags_debugEnabled $
          liftIO . putStrLn . ("addTransaction: " ++) . show $ result

        flushMemStorageDB
        flushMemAddressStateDB

        return $ case result of
            Right (ExecResults remGas _ retVal _ rLogs _ _ _) ->
                      (Right (), retVal, fromIntegral remGas, rLogs, Just [], Nothing)
            Left _ -> (Right (), Nothing, 0, [], Just [], Nothing)

  afterAddressStates <- addressStates

  let hashInteger = fromIntegral . fastBytesToWord256 . keccak256 . word256ToBytes . fromIntegral
  let postTest = M.toList $
                 flip M.map (post test) $
                 \s' -> s'{storage' = M.mapKeys hashInteger (storage' s')}

  when flags_debugEnabled $ do
    liftIO $ putStrLn "Before   -------------"
    liftIO $ putStrLn $ unlines $ showInfo <$> beforeAddressStates
    liftIO $ putStrLn "After    -------------"
    liftIO $ putStrLn $ unlines $ showInfo <$> afterAddressStates
    liftIO $ putStrLn "Expected -------------"
    liftIO $ putStrLn $ unlines $ showInfo <$> postTest
    liftIO $ putStrLn "End      -------------"
  RawData (fromMaybe B.empty retVal) `shouldBe` out test
  unless (null postTest && isLeft result) $
    afterAddressStates `shouldBe` postTest
  mapM_ (gasRemaining `shouldBe`) $ remainingGas test
  if isNothing (callcreates test)
      then returnedCallCreates `shouldBe` Just []
      else fmap reverse returnedCallCreates `shouldBe` callcreates test

runTests::[(String, Test)]->ContextM ()
runTests tests =
    forM_ tests $ \(_, test) -> runTest test

runAllTests::Maybe String->Maybe String->ContextM ()
runAllTests maybeFileName maybeTestName= do
  let theFiles =
        case maybeFileName of
          Nothing       -> testFiles
          Just fileName -> [fileName]

  forM_ theFiles $ \theFileName -> do
      theFile <- liftIO $ BL.readFile theFileName
      liftIO $ putStrLn $ C.yellow $ "#### Running tests in file: " ++ theFileName
      runTestsInFile maybeTestName theFile

runTestsInFile::Maybe String->BL.ByteString->ContextM ()
runTestsInFile maybeTestName theFile =

  case fromJSON <$> eitherDecode theFile::Either String (Result Tests) of
    Left err -> liftIO $ putStrLn err
    Right val ->
      case val of
        Error err'    -> liftIO $ putStrLn err'
        Success tests -> runTests (filter (matchName maybeTestName . fst) (M.toList tests))
  where
    matchName::Maybe String->String->Bool
    matchName Nothing _    = True
    matchName (Just x1) x2 | x1 == x2 = True
    matchName _ _          = False


noLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
noLog _ _ _ _ = return ()
