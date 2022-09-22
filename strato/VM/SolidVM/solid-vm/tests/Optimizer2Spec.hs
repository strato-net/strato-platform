{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications  #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
module Optimizer2Spec where

import Control.Concurrent
import Control.Concurrent.Async
import Control.DeepSeq
import Control.Exception
import Control.Lens ((^.))
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as SB
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.UTF8   as UTF8
import Data.Coerce
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.List as L
import Data.Char
import Data.Text.Encoding
import Data.Time.Clock.POSIX
import HFlags
import Numeric
import Test.Hspec (hspec, Spec, describe, it, xit, fit, pendingWith, anyException, shouldThrow, anyErrorCall, Selector)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck
import Text.Printf
import Text.RawString.QQ


import Control.Monad.Change.Alter
import BlockApps.Logging
import Blockchain.SolidVM.CodeCollectionDB as CCDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.DataDefs (BlockData(..))
import Blockchain.Data.ExecResults
import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import qualified Blockchain.SolidVM as SVM
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Executable.EVMFlags() -- for HFlags
import Blockchain.VMOptions() -- for HFlags
import SolidVM.Model.SolidString
import SolidVM.Model.Storable as MS
import Blockchain.DB.X509CertDB as X509
import Data.ByteString (putStr)
import GHC.TypeLits (ErrorMessage(Text))
import qualified Control.Exception as Blockchain.SolidVM
import qualified LabeledError

import           SolidVM.Model.CodeCollection

import           SolidVM.Solidity.StaticAnalysis.Optimizer       as O
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker     as TP
import Debug.Trace

import Control.Monad.Trans.Reader

import Test.QuickCheck.Monadic (assert, monadicIO, pick, pre, run)


import  SolidVM.Solidity.Parse.UnParser
-- The newtype distinguishes uncaught SolidExceptions and
-- those that are returned in ExecResults
newtype HandledException = HE SolidException deriving (Show, Exception)

anyTODO :: Selector HandledException
anyTODO (HE TODO{}) = True
anyTODO _ = False

anyParseError :: Selector HandledException
anyParseError (HE ParseError{}) = True
anyParseError _ = False

anyRevertError :: Selector HandledException
anyRevertError (HE Blockchain.SolidVM.Exception.RevertError{}) = True
anyRevertError _ = False

anyUnknownFunc :: Selector HandledException
anyUnknownFunc (HE UnknownFunction{}) = True
anyUnknownFunc _ = False

anyUnknownVariableError :: Selector HandledException
anyUnknownVariableError (HE Blockchain.SolidVM.Exception.UnknownVariable{}) = True
anyUnknownVariableError _ = False

anyTypeError :: Selector HandledException
anyTypeError (HE Blockchain.SolidVM.Exception.TypeError{}) = True
anyTypeError _ = False

anyInvalidWriteError :: Selector HandledException
anyInvalidWriteError (HE Blockchain.SolidVM.Exception.InvalidWrite{}) = True
anyInvalidWriteError _ = False

anyInvalidArgumentsError :: Selector HandledException
anyInvalidArgumentsError (HE Blockchain.SolidVM.Exception.InvalidArguments{}) = True
anyInvalidArgumentsError _ = False

anyRequireError :: Selector HandledException
anyRequireError (HE Blockchain.SolidVM.Exception.Require{}) = True
anyRequireError _ = False

anyInternalError :: Selector HandledException
anyInternalError (HE Blockchain.SolidVM.Exception.InternalError{}) = True
anyInternalError _ = False

anyIndexOOBError :: Selector HandledException
anyIndexOOBError (HE Blockchain.SolidVM.Exception.IndexOutOfBounds{}) = True
anyIndexOOBError _ = False

anyMissingFieldError :: Selector HandledException
anyMissingFieldError (HE Blockchain.SolidVM.Exception.MissingField{}) = True
anyMissingFieldError _ = False

anyDivideByZeroError :: Selector HandledException
anyDivideByZeroError (HE Blockchain.SolidVM.Exception.DivideByZero{}) = True
anyDivideByZeroError _ = False

anyCustomError :: Selector HandledException
anyCustomError (HE Blockchain.SolidVM.Exception.CustomError{}) = True
anyCustomError _ = False

anyMissingTypeError :: Selector HandledException
anyMissingTypeError (HE Blockchain.SolidVM.Exception.MissingType{}) = True
anyMissingTypeError _ = False

anyInvalidCertError :: Selector HandledException
anyInvalidCertError (HE Blockchain.SolidVM.Exception.InvalidCertificate{}) = True
anyInvalidCertError _ = False

anyMalformedDataError :: Selector HandledException
anyMalformedDataError (HE Blockchain.SolidVM.Exception.MalformedData{}) = True
anyMalformedDataError _ = False

anyTooMuchGasError :: Selector HandledException
anyTooMuchGasError (HE Blockchain.SolidVM.Exception.TooMuchGas{}) = True
anyTooMuchGasError _ = False

anyTooManyCooks :: Selector HandledException
anyTooManyCooks (HE Blockchain.SolidVM.Exception.TooManyCooks{}) = True
anyTooManyCooks _ = False

anyPaymentError :: Selector HandledException
anyPaymentError (HE Blockchain.SolidVM.Exception.PaymentError{}) = True
anyPaymentError _ = False

anyModifierError :: Selector HandledException
anyModifierError (HE Blockchain.SolidVM.Exception.ModifierError{}) = True
anyModifierError _ = False

anyReservedWordError :: Selector HandledException
anyReservedWordError (HE Blockchain.SolidVM.Exception.ReservedWordError{}) = True
anyReservedWordError _ = False

anyImmutableError :: Selector HandledException
anyImmutableError (HE Blockchain.SolidVM.Exception.ImmutableError{}) = True
anyImmutableError _ = False

failedToAttainRunTimCodeError :: Selector HandledException
failedToAttainRunTimCodeError (HE Blockchain.SolidVM.Exception.FailedToAttainRunTimCode{}) = True
failedToAttainRunTimCodeError _ = False

failedRequirementMsg :: String -> Selector HandledException
failedRequirementMsg str (HE (Require (Just msg))) = str == msg
failedRequirementMsg _ _ = False

failedRequirementNoMsg :: Selector HandledException
failedRequirementNoMsg (HE (Require Nothing)) = True
failedRequirementNoMsg _ = False

failedAssertion :: Selector HandledException
failedAssertion (HE Assert) = True
failedAssertion _ = False

sender :: Account
sender = Account 0xdeadbeef Nothing

privateChainAcc :: Account 
privateChainAcc = Account 0xdeadbeef (Just 0x776622233444)

rootAcc :: Account 
rootAcc = Account (fromPublicKey X509.rootPubKey) Nothing

origin :: Account
origin = Account 0x8341 Nothing

uploadAddress :: Account
uploadAddress = Account (getNewAddress_unsafe (sender ^. accountAddress) 0) Nothing

secondAddress :: Account
secondAddress = Account (getNewAddress_unsafe (sender ^. accountAddress) 1) Nothing

recursiveAddr :: Account
recursiveAddr = Account (getNewAddress_unsafe (uploadAddress ^. accountAddress) 0) Nothing

storageDefSize :: VariableDecl -> Int
storageDefSize vd  = case  _varInitialVal vd of
        Nothing -> 0
        Just ex -> count ex
    where 
        count :: (Expression) -> Int
        count (Binary _ _ expr1 expr2 ) = (count expr1 ) + (count expr2)
        count _ = 1

-- makeStrArgs :: [T.Text] -> T.Text
-- makeStrArgs xs = 
--   let 
--     escp :: T.Text -> T.Text
--     escp s = "\"" <> s <> "\""
--     repl = map escp
--   in "(" <> (T.intercalate (T.pack ", ") (repl xs)) <> ")"

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

runTest :: ContextM a -> IO ()
runTest f = do
  let timeout = 5000000
  result <- race (threadDelay timeout) $ runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)
  case result of
    Left{} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right{} -> return ()

runFile :: FilePath -> ContextM ()
runFile fp = void $ runBS =<< liftIO (readFile fp)

runFileArgs :: T.Text -> FilePath -> ContextM ()
runFileArgs args fp = void $ runArgs args =<< liftIO (readFile fp)

runBS :: String -> ContextM ()
runBS = void . runBS'

runBSBeef :: String -> ContextM ()
runBSBeef = void . runBSBeef'

runBS' ::String -> ContextM ExecResults
runBS' = runArgs "()"

runBSBeef' ::String -> ContextM ExecResults
runBSBeef' = runArgs "()"

rethrowEx :: ExecResults -> ContextM ()
rethrowEx ExecResults{erException=Just ex} = either (liftIO . throwIO . HE) (void . return) ex
rethrowEx _ = return ()

--Adds a contract to the 0xfeedbeef chain
runArgsWithSenderBeef :: Account -> T.Text -> String -> ContextM ExecResults
runArgsWithSenderBeef acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Just 0xfeedbeef
      metadata = Just $ M.fromList [("name",  "qq"), ("args", args)]

  newAddress <- getNewAddress acc
  er <- SVM.create isTest isHomestead suicides blockData callDepth sender origin
          value gasPrice availableGas newAddress code txHash chainId metadata
  rethrowEx er
  return er

--Adds contract to the "main chain"
runArgsWithSender :: Account -> T.Text -> String -> ContextM ExecResults
runArgsWithSender acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Nothing
      metadata = Just $ M.fromList [("name",  "qq"), ("args", args)]

  newAddress <- getNewAddress acc
  er <- SVM.create isTest isHomestead suicides blockData callDepth sender origin
          value gasPrice availableGas newAddress code txHash chainId metadata
  rethrowEx er
  return er

runArgsWithOrigin :: Account -> Account -> T.Text -> String -> ContextM ExecResults
runArgsWithOrigin orig acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Nothing
      metadata = Just $ M.fromList [("name",  "qq"), ("args", args)]

  newAddress <- getNewAddress acc
  er <- SVM.create isTest isHomestead suicides blockData callDepth sender orig
          value gasPrice availableGas newAddress code txHash chainId metadata
  rethrowEx er
  return er

runArgs :: T.Text -> String -> ContextM ExecResults
runArgs = runArgsWithSender sender

runArgsBeef :: T.Text -> String -> ContextM ExecResults
runArgsBeef = runArgsWithSenderBeef sender


runCall :: T.Text -> T.Text -> String -> ContextM (Maybe SB.ShortByteString)
runCall funcName callArgs bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      isRCC = False
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = unsafeCreateKeccak256FromWord256 0x234962
      chainId = Nothing
      createMetadata = Just $ M.fromList [("name",  "qq"), ("args", "()")]
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  newAddress <- getNewAddress sender
  $logErrorS "runCall" "Beginning create"
  er1 <- SVM.create isTest isHomestead suicides blockData callDepth sender origin
    value gasPrice availableGas newAddress code txHash chainId createMetadata
  $logErrorS "runCall" "Returned from create"
  rethrowEx er1
  $logErrorS "runCall" "Beginning call"
  er2 <- SVM.call isTest isHomestead noValueTransfer isRCC suicides blockData callDepth receiveAddress
    newAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata
  $logErrorS "runCall" "Returned from call"
  rethrowEx er2
  return $ erReturnVal er2

call2 :: T.Text -> T.Text -> Account -> ContextM (Maybe SB.ShortByteString)
call2 funcName callArgs contractAddress = do
  let isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      isRCC = False
      suicides = error "TODO: suicides"
      blockData = BlockData { blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataCoinbase = Address 0x0
                            , blockDataStateRoot = ""
                            , blockDataTransactionsRoot = ""
                            , blockDataReceiptsRoot = ""
                            , blockDataLogBloom = ""
                            , blockDataDifficulty = 900
                            , blockDataNumber = 8033
                            , blockDataGasLimit = 1000000
                            , blockDataGasUsed = 10000
                            , blockDataExtraData = ""
                            , blockDataNonce = 22
                            , blockDataMixHash = unsafeCreateKeccak256FromWord256 0x0
                            , blockDataTimestamp = posixSecondsToUTCTime 0x4000 }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = error "TODO: availableGas"
      txHash = unsafeCreateKeccak256FromWord256 0xddba11
      chainId = Nothing
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  er <- SVM.call isTest isHomestead noValueTransfer isRCC suicides blockData callDepth receiveAddress
    contractAddress sender value gasPrice theData availableGas origin txHash chainId callMetadata
  rethrowEx er
  return $ erReturnVal er

checkStorage :: ContextM [(MP.Key, B.ByteString)]
checkStorage = flushMemRawStorageDB >> getAllRawStorageKeyVals' uploadAddress

getAll :: [[StoragePathPiece]] -> ContextM [BasicValue]
getAll = mapM (getSolidStorageKeyVal' uploadAddress . MS.fromList)

getAll2 :: [[StoragePathPiece]] -> ContextM [BasicValue]
getAll2 = mapM (getSolidStorageKeyVal' secondAddress . MS.fromList)

getFields :: [BC.ByteString] -> ContextM [BasicValue]
getFields = getAll . map (\t -> [Field t])

getFields2 :: [BC.ByteString] -> ContextM [BasicValue]
getFields2 = getAll2 . map (\t -> [Field t])

bAddress :: Address -> BasicValue
bAddress = BAccount . unspecifiedChain

bContract :: SolidString -> Address -> BasicValue
bContract t a =
  let u = unspecifiedChain a
   in if u == unspecifiedChain 0
        then BDefault
        else BContract t u

bContract' :: SolidString -> Account -> BasicValue
bContract' t a =
  let u = accountOnUnspecifiedChain a
   in if u == unspecifiedChain 0
        then BDefault
        else BContract t u

bAccount :: Account -> BasicValue
bAccount a =
  let u = accountOnUnspecifiedChain a
   in if u == unspecifiedChain 0
        then BDefault
        else (BAccount u)

iAddress :: Address -> IndexType
iAddress = IAccount . unspecifiedChain


propTest :: [CodeCollection] -> Bool
propTest arrCC = do 
    let map2 = (map fst) $ (filter (([] == ) . snd)) $ (zip arrCC $ TP.detector <$> arrCC)
    let len2 =  (O.detector <$> map2)
    let storgeDefs1 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> len2)
    let storgeDefs2 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$>  (O.detector <$> len2))
    let storgeDefs3 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
    
    let listOf1VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs1))
    let listOf2VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs3))

    trace (show $ (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)) (storgeDefs2 ==  storgeDefs1) && ((storageDefSize <$> listOf1VariableDeclF) <= (storageDefSize <$>   listOf2VariableDeclF)) -- && ( vals1 == vals2 )
 
--Can convert this to one line of code
getStringContracts :: [CodeCollection] -> [(String, String) ]
getStringContracts arrCC = do 
    let map2 = (map fst) $ (filter (([] == ) . snd)) $ (zip arrCC $ TP.detector <$> arrCC)
    let ls1  = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
    let ls2  =  (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> map2))
    (zip ls1 ls2)
    --tForm = (unparseContract  $ catMaybes $ (M.lookup "qq") $ _contracts 
    -- let tForm = ((unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$>) $ (_contracts <$>) 
    -- map ((x, y) -> (tForm x, tForm y)) (zip arrCC (O.detector <$> map2))


runValidContracts :: [CodeCollection] ->  ContextM Bool
runValidContracts arrCC = do
  let last1 = last $ getStringContracts arrCC
  (runBS $ fst last1)
  res1 <- checkStorage
  (runBS $ snd last1)
  res2 <- checkStorage
  return $ res1 == res2
  -- let be1 = (void . runResourceT . flip runReaderT r res2)
  -- let be2 = (void . runResourceT . flip runReaderT r res1)
  -- be1 == be2


runTest'' :: ContextM a -> IO ()
runTest'' f = do
  let timeout = 5000000
  result <- race (threadDelay timeout) $ runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)
  case result of
    Left{} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right{} -> return  ()


prop_factor' :: [CodeCollection]  -> Property
prop_factor' arrCC = monadicIO $ do
  let last1 = last $ getStringContracts arrCC
  return $ runTest $ do 
    --let t1 = runTest'' $  
    (runBS $ snd last1)
    (runBS $ fst last1)
    res1 <- checkStorage
     
    res2 <- checkStorage
    return $ res2 == res1

prop_factor'' :: [CodeCollection]  -> Property
prop_factor'' arrCC = monadicIO $ do
  case arrCC of
    [] -> Test.QuickCheck.Monadic.assert $ True
    _ ->  do
          let last1 = last $ getStringContracts arrCC
          good <-  run $ runConte (do runBS  $ snd last1) (do runBS $ snd last1)
          Test.QuickCheck.Monadic.assert $ good
    --let t2 = (runTestContextM $ withCurrentBlockHash zeroHash res)
  --Test.QuickCheck.Monadic.assert $ res

--So My goal is to make a function of IO [(Key, ByteString)]



prop_writeThenRead :: Property
prop_writeThenRead = monadicIO $ do 
                                    good <-  run $ runConte (do
                                        runBS [r|
                                    pragma solidvm 3.3;
                                    contract qq {
                                      int a =3;
                                      }
                                    |]) (do
                                        runBS [r|
                                    pragma solidvm 3.3;
                                    contract qq {
                                      int a =3;
                                      }
                                    |])
                                    Test.QuickCheck.Monadic.assert $ good 

runValidContracts''' ::  ContextM Bool ->  ContextM Bool -> ContextM Bool
runValidContracts''' a1  a2=  do
  a1' <- a1
  a2' <- a2
  return $ a1' == a2' 

-- runConte :: ContextM a -> IO (a, ContextState)
-- runConte f =  runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)

runConte :: ContextM a -> ContextM a  -> IO (Bool) --(a, ContextState)
runConte f b =  do
  (_, forSure) <-  runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)
  (_, forSure2) <- runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash b)
  pure $ trace ("\tMY PRINT" ++ ((show $ _memDBs forSure))) ( (show $ _memDBs forSure) == (show $ _memDBs forSure2)) --(printf "test case timed out after")
-- runValidContracts' ::  ContextM Bool
-- runValidContracts' arrCC = do
--   let last1 = last $ getStringContracts 
--   (runBS $ fst last1)
--   res1 <- checkStorage
--   (runBS $ snd last1)
--   res2 <- checkStorage
--   return $ res1 == res2


spec :: Spec
spec = do
  describe "Ballot" $ do
    it "can be created" . runTest $ do
      runFileArgs [r|(["a","b","c"])|] "testdata/Ballot.sol"

  
    it "throw an error when there is an 'block_number' variable name" $ runTest (do
      runBS [r|
pragma solidvm 3.3;

contract qq {
   string block_number;
   constructor()
   {
      block_number = "hello";
   }
}|]) `shouldThrow` anyReservedWordError


    it "throw an error when there is an 'address' variable name" $ runTest (do
      runBS [r|
contract qq {
   uint address;
}|]) `shouldThrow` anyParseError

  it "cannot allow negative block number" $ runTest (do
    runBS [r|
pragma solidvm 3.3;
contract qq {
  constructor() public returns (bytes32) {
    return blockhash(-1);
  }
}|]) `shouldThrow` anyInvalidArgumentsError

  it "cannot allow negative block number" $ 
    runTest (do
    runBS [r|
pragma solidvm 3.3;
contract qq {
  constructor() public returns (bytes32) {
    return blockhash(-1);
  }
}|]) `shouldThrow` anyInvalidArgumentsError

  fit "Should do something" $
            --quickCheck propTest
            --withMaxSuccess 10 propTest
            --verboseCheck  propTest
            quickCheck prop_factor''
  


--   fit "cannot allow negative block number" $ 
--     runConte (do
--     runBS [r|
-- pragma solidvm 3.3;
-- contract qq {
--   int a =3;
--   }
-- |]) (do
--     runBS [r|
-- pragma solidvm 3.3;
-- contract qq {
--   int a =3;
--   }
-- |])

--   fit "can assign from constants" . runTest $ do
--     runBS [r|
-- contract qq {
--   uint constant c = 2007;
--   uint x;
--   constructor() public {
--     x = c;
--   }
-- }|]
--     case checkStorage of 
--        Blockchain.VMContext.ContextM [] -> False
--       Blockchain.VMContext.ContextM  _  -> True
  -- it "cannot allow negative block number" $ 
  --   runTest (do  quickCheck runValidContracts) --``shouldBe` True

  -- it "cannot allow negative block number" $ 
  --   quickCheck  (runBS ) `shouldThrow` anyInvalidArgumentsError

-- fit "cannot allow negative block number" $ do
--     (True) `shouldBe` True
  
--So what do I want to do here?
--Test if the values are the same?
--    A) Bring in old propTest into this file
--    B) Then alter it to runTest func
--So runTest for all of the code collections?
--that need to be converted into a string
--Then passed to to run test serpately on both tests --ooohh this is a place for parrell or concurrnecy!
--