{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}

module Blockchain.VM.TestEthereum
    ( runAllTests
    , runTest
    , runTests
    , noLog
    ) where

import           Control.Lens ((^.))
import           Control.Monad
import qualified Control.Monad.Change.Alter                  as A
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Control.Monad.Trans.Except
import           Data.Aeson
import qualified Data.ByteString                             as B
import qualified Data.ByteString.Lazy                        as BL
import qualified Data.ByteString.Short                       as BSS
import           Data.Either
import           Data.IORef.Unboxed
import           Data.List
import qualified Data.Map                                    as M
import           Data.Maybe
import qualified Data.Set                                    as S
import           HFlags
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen                hiding ((<$>), (</>))
import           Test.Hspec.Expectations.Lifted

import           BlockApps.Logging
import           Blockchain.BlockChain
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs                    (BlockData(..))
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
import           Blockchain.EVM
import           Blockchain.EVM.Code
import           Blockchain.EVM.Environment
import           Blockchain.EVM.VMM (readGasRemaining)
import           Blockchain.EVM.VMState
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Util
import           Blockchain.VMContext
import           Blockchain.VM.VMException

import           Blockchain.VM.TestDescriptions
import           Blockchain.VM.TestFiles

import qualified Text.Colors                                 as C
import           Text.Format

import           UnliftIO

defineFlag "debugEnabled" False "enable debugging"
defineFlag "debugEnabled2" False "enable debugging"

populateAndConvertAddressState :: Account -> AddressState' -> ContextM AddressState
populateAndConvertAddressState owner addressState' = do
  hsh <- addCode EVM . codeBytes . contractCode' $ addressState'

  forM_ (M.toList $ storage' addressState') $
    \(key, val) -> putStorageKeyVal' owner (fromIntegral key) (fromIntegral val)

  addressState <- A.lookupWithDefault (A.Proxy @AddressState) owner

  return $
    AddressState
      (nonce' addressState')
      (balance' addressState')
      (addressStateContractRoot addressState)
      (EVMCode hsh)
      (owner ^. accountChainId)

showHexInt::Integer->String
showHexInt x
  = let xHex = showHex x ""
    in (if odd $ length xHex
        then "0x0"
        else "0x")
       ++ xHex

getDataAndRevertAddressState :: Account -> AddressState -> ContextM AddressState'
getDataAndRevertAddressState _ addressState = do
  theCode <- getEVMCode $
             case addressStateCodeHash addressState of
               EVMCode x -> x
               _ -> error "getDataAndRevertAddressState only supports EVMCode"

  -- Copied wholesale from Context.hs:getAllStorageKeyVals'
  -- since that function requires an unhashed owner.
  -- This piece of code really should be in the lib somewhere
  storage <- do
    let sr = addressStateContractRoot addressState
        toInt = fromInteger . rlpDecode . rlpDeserialize . rlpDecode
    kvs <- unsafeGetKeyVals sr ""
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
someHashes::M.Map Keccak256 Int
someHashes = M.fromList $ map (\x -> (hash (word256ToBytes x), fromIntegral x)) [0..255]

showHash::Integer->String
showHash val =
  case M.lookup (unsafeCreateKeccak256FromWord256 (fromIntegral val)) someHashes of
   Nothing -> showHexInt val ++ "[#ed]"
   Just x  -> show x

showInfo :: (Account, AddressState') -> String
showInfo (key,AddressState'{nonce'=n, balance'=b, storage'=s, contractCode'=co}) =
  let c = case co of
            Code c' -> c'
            PtrToCode _ -> ""
   in show key ++ "[#ed]" ++ "(" ++ show n ++ "): " ++ show b ++
         (if M.null s
          then ""
          else (", " ++) . show . M.toList . M.map showHexInt . M.mapKeys showHash $ s
         ) ++
         (if B.null c then "" else ", CODE:[" ++ C.blue (format c) ++ "]")

addressStates :: ContextM [(Account, AddressState')]
addressStates = do
  addrStates <- getAllAddressStates Nothing
  let addrs = map fst addrStates
      states = map snd addrStates
  states' <- zipWithM getDataAndRevertAddressState addrs states
  return $ zip addrs states'

txToOutputTx :: Transaction -> OutputTx
txToOutputTx = fromJust . wrapTransactionUnanchored . IngestTx TO.Direct

runTest :: Test-> ContextM ()
runTest test = do
  when flags_debugEnabled $
    liftIO . print $ test

  MP.initializeBlank
  setStateDBStateRoot Nothing emptyTriePtr

  forM_ (M.toList $ pre test) $
    \(acct, s) -> do
      state' <- populateAndConvertAddressState acct s
      putAddressState acct state'

  beforeAddressStates <- addressStates

  let bData = BlockData {
        blockDataParentHash = fromMaybe (unsafeCreateKeccak256FromWord256 0x0) . previousHash . env $ test,
        blockDataNumber = read . currentNumber . env $ test,
        blockDataCoinbase = _accountAddress . currentCoinbase . env $ test,
        blockDataDifficulty = read . currentDifficulty . env $ test,
        blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0, --error "unclesHash not set",
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
        blockDataMixHash=unsafeCreateKeccak256FromWord256 0 --error "mixHash not set"
        }
  let block = Block bData [] []

  (result, retVal, gasRemaining, _, returnedCallCreates, _) <-
    case theInput test of
      IExec exec -> do

        let env' =
              Environment{
                envGasPrice = getNumber $ gasPrice' exec,
                envBlockHeader = blockBlockData block,
                envOwner = account' exec,
                envOrigin = origin exec,
                envInputData = theData $ data' exec,
                envSender = caller exec,
                envValue = getNumber $ value' exec,
                envCode = code exec,
                envJumpDests = getValidJUMPDESTs $ code exec,
                envTxHash = unsafeCreateKeccak256FromWord256 0,
                envChainId = Nothing,
                envMetadata = Nothing
                }

        mdbs <- contextGets _memDBs
        vmState0 <- liftIO $ startingState True False env' mdbs
        gasref <- liftIO . newCounter . fromIntegral . getNumber . gas' $ exec
        vmStateRef <- newIORef $ vmState0{vmGasRemaining=gasref, debugCallCreates=Just []}

        result <- try . flip runReaderT vmStateRef $ do
          runCodeFromStart

          vmState2 <- readIORef vmStateRef
          when flags_debugEnabled $
            liftIO $ putStrLn $ "Removing accounts in suicideList: " ++
                              intercalate ", " (show . pretty <$> S.toList (suicideList vmState2))

          forM_ (suicideList vmState2) deleteAddressState
        vmState1 <- readIORef vmStateRef
        when flags_debugEnabled $ do
          liftIO . putStrLn . ("runCodeFromStart: " ++) . show $ result
          liftIO . putStrLn . ("runCodeFromStart: " ++) . show $ vmState1

        contextModify $ \st -> st{_memDBs = vmMemDBs vmState1}

        flushMemStorageDB
        flushMemAddressStateDB

        case result of
         Right _ -> do
          gr <- readGasRemaining vmState1
          return (result, returnVal vmState1, gr, logs vmState1, debugCallCreates vmState1, Just vmState1)
         Left (_ :: VMException) -> return (Right (), Nothing, 0, [], Just [], Nothing)

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
                    (a ^. accountAddress)
                    (getNumber $ tValue' transaction)
                    (theData $ tData' transaction)
                    Nothing
                    (tSecretKey' transaction)
        signedTransaction' <- liftIO t
        let signedTransaction = txToOutputTx signedTransaction'
        result <-
          runExceptT $ addTransaction Nothing True (blockBlockData block) (currentGasLimit $ env test) signedTransaction
        when flags_debugEnabled $
          liftIO . putStrLn . ("addTransaction: " ++) . show $ result

        flushMemStorageDB
        flushMemAddressStateDB

        return $ case result of
            Right er@ExecResults{erReturnVal=retVal, erLogs=rLogs} ->
                      (Right (), BSS.fromShort <$> retVal,
                       fromIntegral $ currentGasLimit (env test) - (transactionGasLimit signedTransaction' - calculateReturned signedTransaction' er),
                       rLogs, Just [], Nothing)
            Left _ -> (Right (), Nothing, 0, [], Just [], Nothing)

  afterAddressStates <- addressStates

  let hashInteger = fromIntegral . bytesToWord256 . keccak256ToByteString . hash . word256ToBytes . fromIntegral
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
  mapM_ (gasRemaining `shouldBe`) $ fmap fromIntegral $ remainingGas test
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
