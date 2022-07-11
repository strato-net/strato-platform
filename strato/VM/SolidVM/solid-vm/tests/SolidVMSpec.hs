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
module SolidVMSpec where

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
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Char
import Data.Text.Encoding
import Data.Time.Clock.POSIX
import HFlags
import Numeric
import Test.Hspec (hspec, Spec, describe, it, it, fit, xit, pendingWith, anyException, shouldThrow, anyErrorCall, Selector)
import Test.Hspec.Expectations.Lifted
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

-- The newtype distinguishes uncaught SolidExceptions and
-- those that are returned in ExecResults
newtype HandledException = HE SolidException deriving (Show, Exception)

anyTODO :: Selector HandledException
anyTODO (HE TODO{}) = True
anyTODO _ = False

anyParseError :: Selector HandledException
anyParseError (HE ParseError{}) = True
anyParseError _ = False

anyUnknownFunc :: Selector HandledException
anyUnknownFunc (HE UnknownFunction{}) = True
anyUnknownFunc _ = False

anyTypeError :: Selector HandledException
anyTypeError (HE Blockchain.SolidVM.Exception.TypeError{}) = True
anyTypeError _ = False

anyInvalidWriteError :: Selector HandledException
anyInvalidWriteError (HE Blockchain.SolidVM.Exception.InvalidWrite{}) = True
anyInvalidWriteError _ = False

anyInvalidArgumentsError :: Selector HandledException
anyInvalidArgumentsError (HE Blockchain.SolidVM.Exception.InvalidArguments{}) = True
anyInvalidArgumentsError _ = False

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

anyPaymentError :: Selector HandledException
anyPaymentError (HE Blockchain.SolidVM.Exception.PaymentError{}) = True
anyPaymentError _ = False


anyModifierError :: Selector HandledException
anyModifierError (HE Blockchain.SolidVM.Exception.ModifierError{}) = True
anyModifierError _ = False

anyReservedWordError :: Selector HandledException
anyReservedWordError (HE Blockchain.SolidVM.Exception.ReservedWordError{}) = True
anyReservedWordError _ = False

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
  result <- race (threadDelay timeout) $ runLoggingT (runTestContextM f)
  case result of
    Left{} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right{} -> return ()

runFile :: FilePath -> ContextM ()
runFile fp = void $ runBS =<< liftIO (readFile fp)

runFileArgs :: T.Text -> FilePath -> ContextM ()
runFileArgs args fp = void $ runArgs args =<< liftIO (readFile fp)

runBS :: String -> ContextM ()
runBS = void . runBS'

runBS' ::String -> ContextM ExecResults
runBS' = runArgs "()"

rethrowEx :: ExecResults -> ContextM ()
rethrowEx ExecResults{erException=Just ex} = either (liftIO . throwIO . HE) (void . return) ex
rethrowEx _ = return ()

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

spec :: Spec
spec = do
  describe "Ballot" $ do
    it "can be created" . runTest $ do
      runFileArgs [r|(["a","b","c"])|] "testdata/Ballot.sol"

  describe "Create" $ do
    it "should be able to run an empty contract" . runTest $ do
      runFile "testdata/Empty.sol"
      checkStorage `shouldReturn` []

    it "should be able to store a default int" . runTest $ do
      runFile "testdata/DefaultInt.sol"
      checkStorage `shouldNotReturn` []

    it "should be able to explicitly store an int" . runTest $ do
      runFile "testdata/SetInt.sol"
      checkStorage `shouldNotReturn` []

    it "can reduce a modulus" . runTest $ do
      runFile "testdata/Modulo.sol"
      getFields ["x"] `shouldReturn` [BInteger 0xbe]


    it "should be able to store a string" . runTest $ do
      runFile "testdata/SetString.sol"
      checkStorage `shouldNotReturn` []

    it "should be able to store an array" . runTest $ do
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BDefault, BDefault]
      runFile "testdata/ArrayPush.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "nums", Field "length"]
             , [Field "nums", ArrayIndex 0]
             ] `shouldReturn` [BInteger 1, BInteger 3]

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runFile "testdata/ArrayRead.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 5) . length
      getAll
        [ [Field "xs", Field "length"]
        , [Field "xs", ArrayIndex 0]
        , [Field "xs", ArrayIndex 1]
        , [Field "xs", ArrayIndex 2]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [ BInteger 2
                         , BInteger 0x5577
                         , BInteger 0xffff
                         , BDefault
                         , BInteger 0x5577
                         , BInteger 0xffff]

    it "should be able to insert into a mapping" . runTest $ do
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingSet.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 3) . length
      getAll
        [ [Field "us"]
        , [Field "us", MapIndex (INum 22)]
        , [Field "us", MapIndex (INum 999999)]
        , [Field "us", MapIndex (INum 10)]
        ] `shouldReturn` [BMappingSentinel, BInteger 4, BInteger 21, BDefault]

    it "should be able to read from a map" . runTest $ do
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingRead.sol"
      st <- checkStorage
      -- The z assignment doesn't count, as at is set to the empty string
      st `shouldSatisfy` (== 4) . length
      getAll
        [ [Field "xs"]
        , [Field "xs", MapIndex (INum 400)]
        , [Field "y"]
        , [Field "z"]
        ] `shouldReturn` [BMappingSentinel, BInteger 343, BInteger 343, BDefault]

    it "should be able to set array length" . runTest $ do
      runFile "testdata/Length.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 1) . length
      getAll [[Field "xs", Field "length"]] `shouldReturn` [BInteger 24]

    it "should be able to read array length" . runTest $ do
      runFile "testdata/ReadLength.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll [ [Field "xs", Field "length"]
             , [Field "y"]
             ] `shouldReturn` [BInteger 0x400, BInteger 0x400]

    it "can delete" . runTest $ do
      runFile "testdata/Delete.sol"
      getFields ["x"] `shouldReturn` [BDefault]

    it "can delete arrays" . runTest $ do
      runFile "testdata/DeleteArray.sol"
      getAll
        [ [Field "x", Field "length"]
        , [Field "x", ArrayIndex 0]
        , [Field "x", ArrayIndex 1]
        , [Field "x", ArrayIndex 2]
        ] `shouldReturn` replicate 4 BDefault

    it "can run complicated constructors" . runTest $ do
      runFile "testdata/Constructor.sol"

    it "can exponentiate" . runTest $ do
      runFile "testdata/Exp.sol"
      getFields ["x"] `shouldReturn` [BInteger 25]

    it "can use addresses as map keys" . runTest $ do
      runFile "testdata/AddressMapping.sol"
      getAll [[Field "perms", MapIndex (iAddress 0xdeadbeef)]] `shouldReturn` [BInteger 0xfff]

    it "can hash correctly" . runTest $ do
      runFile "testdata/Keccak256.sol"
      getFields ["buf1", "buf2", "hash1", "hash2"] `shouldReturn`
        [ BString (B.replicate 32 0xfe)
        , BString (BC.replicate 32 'x')
        , BString (LabeledError.b16Decode "SolidVMSpec.hs" "59c3290d81fbdfe9ce1ffd3df2b61185e3089df0e3c49e0918e82a60acbed75a")
        , BString (LabeledError.b16Decode "SolidVMSpec.hs" "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868")
        ]

    it "can hash multiple arguments" . runTest $ do
      runBS [r|
contract qq {
  bytes32 hsh;
  constructor() public {
    string username = "uname";
    string nodeIp = "enode://8814738274@127.0.0.1:30303";
    string chainId = "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868";
    hsh = keccak256(username, nodeIp, chainId);
  }
}
|]
      getFields ["hsh"] `shouldReturn` [BString $ word256ToBytes 0x4ebc701886e9562cf7998b9ab563c6d3ca5ad243b547f11f31ae1ae156b2ff97]


    it "can create a struct" . runTest $ do
      runBS [r|
contract qq {
  struct X {
    int a;
    string b;
  }
  X x;
  constructor() {
    x.a = 900;
    x.b = "ok";
  }
}|]

      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 900, BString "ok"]

    it "can directy initialize a struct" . runTest $ do
      runBS [r|
contract qq {
  struct X {
    int a;
    int b;
  }
  X x = X(3, 4);
}|]
      getAll [ [Field "x", Field "a"]
             , [Field "x", Field "b"]] `shouldReturn` [BInteger 3, BInteger 4]

    it "can push a struct" . runTest $ do
      runBS [r|
contract qq {
  struct X {
    int a;
    int b;
  }
  X[] xs;
  constructor() {
    xs.push(X(88, 73));
  }
}
|]
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 88, BInteger 73]

    it "can explicitly push a struct" . runTest $ do
      runBS [r|
contract qq {
  struct X {
    uint a;
    uint b;
  }
  X[] xs;
  constructor() {
    X x;
    x.a = 9000;
    x.b = 3000;
    xs.push(x);
  }
}
|]
      getAll [ [Field "xs"]
             , [Field "xs", Field "length"]
             , [Field "xs", ArrayIndex 0, Field "a"]
             , [Field "xs", ArrayIndex 0, Field "b"]
             ] `shouldReturn` [BDefault, BInteger 1, BInteger 9000, BInteger 3000]
    it "can post increment" . runTest $ do
      runBS [r|
contract qq {
  uint x = 400000000;
  uint y;
  constructor() {
    y = x++;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 400000001, BInteger 400000000]

    it "can pre increment" . runTest $ do
      runBS [r|
contract qq {
 uint x = 99;
 uint y = 17;
 constructor() {
   y = ++x;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 100]

    it "can post decrement" . runTest $ do
      runBS [r|
contract qq {
  uint x = 10;
  uint y;
  constructor() {
    y = x--;

  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 9, BInteger 10]

    it "can pre decrement" . runTest $ do
      runBS [r|
contract qq {
  uint x = 20;
  uint y;
  constructor() {
    y = --x;
  }
}|]
      getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 19, BInteger 19]

    it "can declare negative numbers" . runTest $ do
      runBS [r|
pragma solidvm 3.0;
contract qq {
  uint x;
  uint y;
  constructor() {
    x = -1;
    y = -x;
  }
}|]
      getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger (-1), BInteger 1]

    it "can require" . runTest $ do
      runBS [r|
contract qq {
  constructor() {
    require(3 == 3, "Who is John Galt?");
  }
}|]

    it "can handle failed requirement with message" $ runTest (do
      runBS [r|
contract qq {
  constructor() {
    require(3 == 4, "Who is John Galt?");
  }
}|]) `shouldThrow` failedRequirementMsg "SString \"Who is John Galt?\""

    it "can handle failed requirement without message" $ runTest (do
      runBS [r|
contract qq {
  constructor() {
    require(3 == 4);
  }
}|]) `shouldThrow` failedRequirementNoMsg

    it "throw an error when there is an 'block_timestamp' variable name" $ runTest (do
      runBS [r|
contract qq {
   string block_timestamp;
   constructor()
   {
      block_timestamp = "hello";
   }
}|]) `shouldThrow` anyParseError

    it "throw an error when there is an 'block_hash' variable name" $ runTest (do
      runBS [r|
contract qq {
   string block_hash;
   constructor()
   {
      block_hash = "hello";
   }
}|]) `shouldThrow` anyParseError

    it "throw an error when there is an 'block_number' variable name" $ runTest (do
      runBS [r|
contract qq {
   string block_number;
   constructor()
   {
      block_number = "hello";
   }
}|]) `shouldThrow` anyParseError


    it "throw an error when there is an 'address' variable name" $ runTest (do
      runBS [r|
contract qq {
   uint address;
}|]) `shouldThrow` anyParseError

    it "throw an error when there is an 'record_id' variable name" $ runTest (do
      runBS [r|
contract qq {
   uint record_id;
}|]) `shouldThrow` anyParseError

    it "throw an error when there is an 'transaction_hash' variable name" $ runTest (do
      runBS [r|
contract qq {
   uint transaction_hash;
}|]) `shouldThrow` anyParseError

    it "throw an error when there is an 'transaction_sender' variable name" $ runTest (do
      runBS [r|
contract qq {
   uint transaction_sender;
}|]) `shouldThrow` anyParseError

    it "can multiline require" . runTest $ do
      runBS [r|
contract qq {
  constructor() public {
    require(
      3 == 3,
      "Who is John Galt????"
    );
  }
}|]

    it "can assert" . runTest $ do
      runBS [r|
contract qq {
  constructor() {
    assert(3 == 3);
  }
}|]

    it "can handle failed assertion" $ runTest (do
      runBS [r|
contract qq {
  constructor() {
    assert(3 == 4);
  }
}|]) `shouldThrow` failedAssertion

    it "can multiline assert" . runTest $ do
      runBS [r|
contract qq {
  constructor() public {
    assert(
      3 == 3
    );
  }
}|]

    it "can index into maps with bool" . runTest $ do
      runBS [r|
pragma solidvm 3.0;
contract qq {
  mapping(bool => uint) bs;
  constructor() public {
    bs[true] = 0x87324;
    bs[false] = 0x000;
  }
}|]
      getAll [ [Field "bs", MapIndex $ IBool False]
             , [Field "bs", MapIndex $ IBool True]] `shouldReturn` [BDefault, BInteger 0x87324]

    it "should be able to store a contract" . runTest $ do
      runBS [r|
contract X {}
contract qq {
  X x = X(0x999999);
}|]
      getAll [ [Field "x"] ] `shouldReturn` [bContract "X" 0x999999]

    it "should be able to return the time from the header" . runTest $ do
      runBS [r|
contract qq {
 uint ts1;
 uint ts2;
 constructor() {
   ts1 = block.timestamp;
   ts2 = now;
 }
}|]
      getFields ["ts1", "ts2"] `shouldReturn` [BInteger 0x4000, BInteger 0x4000]

    it "can parse one specific assembly block" . runTest $ do
      runBS [r|
contract qq {
  bytes32 stored;
  constructor() {
    string source = "alright.";
    bytes32 result;
    assembly {
          result := mload(add(source, 32))
    }
    stored = result;
  }
}|]
      getAll [ [Field "stored"] ] `shouldReturn` [BString "alright."]

  it "can handle nested mappings" . runTest $ do
    runBS [r|
contract qq {
  mapping(uint => mapping(uint => string)) xs;
  constructor() {
    xs[10][20] = "ok";
  }
}|]
    getAll [ [Field "xs", MapIndex (INum 10), MapIndex (INum 20)] ] `shouldReturn` [BString "ok"]

  it "can handle deeply nested mappings" . runTest $ do
    runBS [r|
contract X {}
contract qq {
  mapping (bytes32 => mapping(bytes32 => mapping(bool => X))) public ruleSets;

  constructor() {
    bytes32 profileName = "profileName";
    bytes32 ruleName = "ruleName";
    ruleSets[profileName][ruleName][true] = X(0xdeadbeef);
  }
}|]
    getAll [ [ Field "ruleSets"
             , MapIndex $ IText "profileName"
             , MapIndex $ IText "ruleName"
             , MapIndex $ IBool True ] ] `shouldReturn` [bContract "X" 0xdeadbeef]

  it "can default construct local arrays" . runTest $ do
    runBS [r|
contract qq {
  constructor() {
    bytes32[] mnames;
  }
}|]
    checkStorage `shouldReturn` []

  it "can array index with uninitialized numbers" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  uint[] xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [ [Field "y" ]] `shouldReturn` [BDefault]

  it "can map index with uninitialized numbers" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  mapping(uint => uint) xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [ [Field "y" ]] `shouldReturn` [BDefault]

  it "can map index with uninitialized strings 3.2" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  mapping(string => address) xs;
  address y;
  constructor() {
    string idx;
    y = xs[idx];
  }
}|]
    getFields ["y"] `shouldReturn` [BDefault]

  it "can access fields of structs from arrays" . runTest $ do
    runBS [r|
contract qq {
  struct S {
    uint f;
  }
  S[] ss;
  uint y;
  constructor() {
    ss.push(S(0xdeadbeef));
    S s = ss[0];
    y = s.f;
  }
}|]
    getFields ["y"] `shouldReturn` [BInteger 0xdeadbeef]

  it "should not treat local ints as references" . runTest $ do
    runBS [r|
contract qq {
  uint x = 20;
  constructor() {
    uint l = x;
    l += 10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 20]

  it "should remember modifications to locals" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() {
    uint l = 99;
    l += 101;
    x = l;
  }
}|]
    getFields ["x"]`shouldReturn` [BInteger 200]

  it "can assign a local struct" . runTest $ do
    runBS [r|
contract qq {
  uint z;
  struct X {
    uint a;
  }

  constructor() {
    X x = X(777);
    z = x.a;
  }
}|]
    getFields ["z"] `shouldReturn` [BInteger 777]

  it "can do arithmetic with defaults" . runTest $ do
    runBS [r|
contract qq {
  uint x = 0xf07;
  uint z;

  constructor() {
    uint q;
    z = x ^ q;
  }
}|]
    getFields ["x", "z"] `shouldReturn` [BInteger 0xf07, BInteger 0xf07]

  it "can read from struct references" . runTest $ do
    runBS [r|
contract qq {
  struct S {
    uint si;
  }
  S[] ss;
  uint z;
  constructor() public {
    ss.push(S(222222));
    S ref = ss[0];
    z = ref.si;
  }
}|]

    getAll [ [Field "ss", Field "length"]
           , [Field "ss", ArrayIndex 0, Field "si"]
           , [Field "z"]
           ] `shouldReturn` [BInteger 1, BInteger 222222, BInteger 222222]

  it "can detect nulls" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  mapping(uint => uint) ns;
  bool found;
  constructor() {
    found = ns[0x0ddba11] != 0x0;
  }
}|]
    getFields ["found"] `shouldReturn` [BDefault]

  it "supports boolean equality" . runTest $ do
    runBS [r|
contract qq {
  bool x = true;
  bool y = true;
  constructor() {
    assert(x == y);
  }
}|]

  it "supports boolean inequality" . runTest $ do
    runBS [r|
contract qq {
  bool x = true;
  bool y = false;
  constructor() {
    assert(x != y);
  }
}|]

  it "supports contract equality" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract A {
}
pragma solidvm 3.0;
contract qq {
  constructor() {
    A a1 = new A();
    A a2 = new A();
    A a3 = a2;
    assert (a1 != a2);
    assert (a2 == a3);
  }
}|]

  it "compares equal againts default" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
  uint x = 0;
  uint y;
  bool z;
  constructor() {
    z = x == y;
  }
}|]
    getFields ["x", "y", "z"] `shouldReturn` [BDefault, BDefault, BBool True]

  it "can check msg.sender" . runTest $ do
    runBS [r|
contract qq {
  address x;
  constructor() {
    x = msg.sender;
  }
}|]
    getFields ["x"] `shouldReturn` [bAccount sender]

  it "can read tx.origin" . runTest $ do
    runBS [r|
contract qq {
  address x;
  constructor() {
    x = tx.origin;
  }
}|]
    getFields ["x"] `shouldReturn` [bAccount origin]

  it "can infer types" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  function f() returns (uint) {
    return 12345;
  }
  constructor() {
    var z = f();
    x = z;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 12345]
  
  it "can throw exception if omitted parameter name and types are different" $ runTest (do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint x = 0;

  constructor() {
    x = f(6,5);   
  }
  function f(string, uint) public returns (uint) {
    return 7;
  }
}|]) `shouldThrow` anyException

  it "can handle omitted parameter names with correct types" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint x = 0;

  constructor() {
    x = f(6,5);   
  }
  function f(uint, uint) public returns (uint) {
    return 7;
  }
}|] 
    getFields ["x"] `shouldReturn` [BInteger 7]

  it "can unpack tuples" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    var (a, b) = (98, 7776234);
    x = a;
    y = b;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 98, BInteger 7776234]

  it "will run parent constructors" . runTest $ do
    runBS [r|
contract Parent {
  uint x;
  string name;
  constructor() public {
    x = 2346;
    name = "Sandman";
  }
}

contract qq is Parent {
  constructor() public Parent() {}
}|]
    getFields ["x", "name"] `shouldReturn` [BInteger 2346, BString "Sandman"]

  it "will pass arguments to constructors" . runTest $ do
    void $ runArgs "(0x6662346)" [r|
contract qq {
  address target;
  constructor(address _target) public {
    target = _target;
  }
}|]
    getFields ["target"] `shouldReturn` [bAddress 0x6662346]

  it "can create a reference to a map value" . runTest $ do
    runBS [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("1");
  }
}|]
    getAll [ [Field "ruleNames", MapIndex (IText "ok"), Field "length"]
           , [Field "ruleNames", MapIndex (IText "ok"), ArrayIndex 0]
           ] `shouldReturn` [BInteger 1, BString "1"]

  it "can back assign a reference" . runTest $ do
    runBS [r|
contract qq {
  bytes32[] src;
  bytes32[] dst;
  constructor() public {
    bytes32[] src2 = src;
    src2.push("red");
    dst = src2;
    // src2 still refers to src, but dst had a deep copy
    src2.push("blue");
  }
}|]
    getAll [ [Field "src", Field "length"]
           , [Field "src", ArrayIndex 0]
           , [Field "src", ArrayIndex 1]
           , [Field "dst", Field "length"]
           , [Field "dst", ArrayIndex 0]
           ] `shouldReturn` [ BInteger 2, BString "red", BString "blue"
                            , BInteger 1, BString "red"]

  it "can back assign a map value reference" . runTest $ do
    runBS [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("red");
    ruleNames["bad"] = names;
  }
}|]

  it "can continue in a for-loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i;
  constructor() public {
    for (uint j = 0; j < 4; j++) {
      if (j % 2 == 0) {
        continue;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 2]


  it "can continue in a while-loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i;
  constructor() public {
    int j = 0;
    while (j < 10) {
      j++;
      if (j % 2 == 0) {
        continue;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 5]

  it "can continue in a do-while-loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i;
  constructor() public {
    int j = 0;
    do {
      j++;
      if (j % 2 == 0) {
        continue;
      }
      i++;
    } while (j < 10);
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 6]

  it "can break from a for-loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i = 25;
  constructor() public {
    for (uint j = 0; j < 100; j++) {
      if (j == 4) {
        break;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 29]

  it "can break from a while-loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i = 0;
  constructor() public {
    while (i < 10) {
      if (i == 4) {
        break;
      }
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 4]

  it "can break from a do-while loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i = 0;
  constructor() public {
    do {
      if (i == 4) {
        break;
      }
      i++;
    } while (i < 10);
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 4]

  it "can break immediately from a loop" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint i = 25;
  constructor() public {
    for (uint j = 0; j < 100; j++) {
      break;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 25]

  it "can return from a loop" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (uint j = 0; j < 5; j++) {
      i++;
      return;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 1]

  it "can call functions on local contracts" . runTest $ do
    runBS [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == 0xdeadbeef;
  }
}

contract qq {
  bool auth;
  constructor() {
    Auth a = new Auth();
    auth = a.check(msg.sender);
  }
}|]
    getFields ["auth"] `shouldReturn` [BBool True]

  it "can call functions on stored contracts" . runTest $ do
    runBS [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == 0xdeadbeef;
  }
}

contract qq {
  Auth a;
  bool auth;
  constructor() {
    a = new Auth();
    auth = a.check(msg.sender);
  }
}|]
    getFields ["auth"] `shouldReturn` [BBool True]

  it "can inherit storage" . runTest $ do
    runBS [r|
contract Parent {
  uint public x = 3;
}

contract qq is Parent {
  uint y = 999;
}|]
    getFields ["x", "y"]` shouldReturn` [BInteger 3, BInteger 999]

  it "can call functions" . runTest $ do
    runCall "inc" "()" [r|
contract qq {
  uint x = 99;
  function inc() {
    x++;
  }
}|] `shouldReturn` Nothing
    getFields ["x"] `shouldReturn` [BInteger 100]

  it "can call external getters by variable name" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract S {
  string public s;
  constructor() public {
    s = "Blockapps";
  }
}
pragma solidvm 3.2;
contract qq {
  string local_s;
  S myS;
  constructor() {
    myS = new S();
    local_s = myS.s();
  }
}|] 
    getFields ["local_s"] `shouldReturn` [BString "Blockapps"]

  it "can cast address to contract" . runTest $ do
    runBS [r|
contract X {}
contract qq {
  X x;
  constructor() public {
    x = X(0xdeadbeef);
  }
}|]
    getFields ["x"] `shouldReturn` [bContract "X" 0xdeadbeef]


-- This test only works when BAccount has the payable flag
  {-it "can parse account payable type" . runTest $ do
    runBS [r|
contract qq {
  account y;
  account payable x;
  bool z;
  
  constructor() public {
    y = msg.sender;
    x = payable(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BAccount (NamedAccount 0xdeadbeef UnspecifiedChain)]
  -}

  it "can call methods of superclasses" . runTest $ do
    runBS [r|
contract P {
  function callable() public {}
}
contract qq is P {
  uint x;
  constructor() public {
    P.callable();
    x  = 774;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 774]

  it "can use super to call parent methods" . runTest $ do
    runBS [r|
contract P {
  function callable() public {}
}
contract qq is P {
  uint x;
  constructor() public {
    super.callable();
    x = 908;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 908]

  it "can treat 0 literals as strings" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
  bytes32 text = "ok";
  bytes32 notext = "";
  bytes32 zero = 0;
  bool nonempty;
  bool empty;
  constructor() {
    nonempty = text == 0;
    empty = notext == 0;
  }
}|]
    getFields ["text", "notext", "zero", "nonempty", "empty"] `shouldReturn`
              [BString "ok", BDefault, BDefault, BDefault, BBool True]

  it "can treat integer literals as addresses" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
  address a = 0xdeadbeef;
}|]
    getFields ["a"] `shouldReturn` [bAddress 0xdeadbeef]

  it "can pass arrays by reference to functions" . runTest $ do
    runBS [r|
contract qq {
  uint[] xs;
  uint x;
  function head(uint[] ts) returns (uint) {
    return ts[0];
  }
  constructor() public {
    xs.push(0x44444);
    x = head(xs);
  }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "x"]
           ] `shouldReturn` [BInteger 1, BInteger 0x44444, BInteger 0x44444]

  it "can pass arrays by reference to other contracts" . runTest $ do
    runBS [r|
contract H {
  function head(uint[] ts) returns (uint) {
    return ts[0];
  }
}
contract qq {
  uint[] xs;
  uint x;
  constructor() public {
    H h = new H();
    xs.push(23145);
    x = h.head(xs) + 1;
  }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "x"]
           ] `shouldReturn` [BInteger 1, BInteger 23145, BInteger 23146]

  it "can accept remote arrays" . runTest $ do
    runCall "addHead" "([10, 17])" [r|
contract qq {
  uint x;
  function addHead(uint[] ts) public {
    x += ts[0];
  }
}|] `shouldReturn` Nothing
    getFields ["x"] `shouldReturn` [BInteger 10]

  it "can push to memory arrays" . runTest $ do
    runCall "pushMem" "([3, 5])" [r|
pragma solidvm 3.2;
contract qq {
  uint x;
  function pushMem(uint[] memory ts) public {
    ts.push(7);
    uint[] cpy = ts; 
    x = cpy[2];
  }
}|] `shouldReturn` Nothing
    getFields ["x"] `shouldReturn` [BInteger 7]

  it "can store array literals" . runTest $ do
    runBS [r|
contract qq {
  uint[] xs = [10, 20, 90];
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "xs", ArrayIndex 1]
           , [Field "xs", ArrayIndex 2]
           ] `shouldReturn` [BInteger 3, BInteger 10, BInteger 20, BInteger 90]

  it "can accept nested arrays" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  bool[2][] pairs;

  function setPairs(bool[2][] _pairs) {
    pairs = _pairs;
  }
  constructor() public {
    setPairs([[true, false], [false, false], [true, true]]);
  }
}|]
    let subArrays = do
          pre <- map ArrayIndex [0, 1, 2]
          suf <- [Field "length", ArrayIndex 0, ArrayIndex 1]
          return [pre, suf]
    getAll (map (Field "pairs":) ([Field "length"]:subArrays))
           `shouldReturn` [ BInteger 3
                          , BInteger 2, BBool True, BDefault
                          , BInteger 2, BDefault, BDefault
                          , BInteger 2, BBool True, BBool True
                          ]

  it "can declare a local struct" . runTest $ do
    runBS [r|
contract qq {
  struct S {
    uint x;
    string s;
  }
  uint store_x;
  string store_s;
  constructor() {
    S memory str;
    str = S(0x777234, "Hello");
    store_x = str.x;
    store_s = str.s;
  }
}|]
    getFields ["store_x", "store_s"] `shouldReturn` [BInteger 0x777234, BString "Hello"]

  it "can cast contracts down" . runTest $ do
    runBS [r|
contract X {}
contract Y {}

contract qq {
  X public x;
  constructor() public {
    Y y = Y(0x7733624642);
    x = X(y);
  }
}|]
    getFields ["x"] `shouldReturn` [bContract "X" 0x7733624642]

  it "can cast int to int" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    uint y = 2347;
    x = uint(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2347]

  it "can <op>=" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    x |= 0xf0f;
    x &= 0xff0;
    x ^= 0xff0;
    x += 0xa;
    x -= 0x3;
    x *= 0x10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0xf70]

  it "can construct two copies" . runTest $ do
    let qq = [r|
contract qq {
  uint x;
  constructor(uint _x) public {
    x = _x;
  }
}|]
    void $ runArgs "(1234)" qq
    void $ runArgs "(887324)" qq
    getFields ["x"] `shouldReturn` [BInteger 1234]
    getFields2 ["x"] `shouldReturn` [BInteger 887324]

  it "can call a remote function" . runTest $ do
    let qq = [r|
pragma solidvm 3.0;
contract qq {
  qq x;
  uint num;
  constructor(address _x, uint _num) public {
    x = qq(_x);
    num = _num;
  }
  function a() public {
    num = x.b();
  }
  function b() public {
    return num + 1;
  }
}|]
    void $ runArgs "(0x0,99)" qq
    getFields ["x", "num"] `shouldReturn` [bContract "qq" 0x0, BInteger 99]

    void $ runArgs (T.pack $ printf "(0x%s,400)" $ show uploadAddress) qq
    getFields2 ["x", "num"] `shouldReturn` [bContract' "qq" uploadAddress, BInteger 400]

    call2 "a" "()" secondAddress `shouldReturn` Nothing
    getFields2 ["x", "num"] `shouldReturn` [bContract' "qq" uploadAddress, BInteger 100]

  it "can locally return locals" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  function f() returns (uint) {
    uint k = 85;
    return k;
  }

  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 85]

  it "can locally return tuples" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  string y;

  function f(uint k, string l) returns (uint, string) {
    return (k, l);
  }

  constructor() public {
    var (a, b) = f(444, "ok");
    x = a;
    y = b;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 444, BString "ok"]

  it "can externally return locals" . runTest $ do
    runCall "f" "()" [r|
contract qq {
  function f() returns (uint) {
    uint k = 99;
    return k;
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 99)

  it "can externally return tuples" . runTest $ do
    er <- runCall "f" "()" [r|
contract qq {
  function f() returns (uint, uint) {
    uint k = 0x0123456789abcdef0123456789abcdef;
    return (k, k);
  }
}|]
    let Right kBS = B16.decode "0123456789abcdef0123456789abcdef"
        zero = B.replicate 16 0
    er `shouldBe` Just (SB.toShort $ zero <> kBS <> zero <> kBS)


  it "can assign to tuples" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    (x, y) = (10, 17);
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 10, BInteger 17]

  it "can assign numeric to bytes32" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract qq {
   bytes32 x = 0x5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068;
}|]
    getFields ["x"] `shouldReturn`
      [BString "5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068"]

  it "can convert bytes32toString" . runTest $ do
    liftIO $ pendingWith "I'm not sure if this is correct"
    runBS [r|
contract Util {
  function bytes32ToString(bytes32 x) constant returns (string) {
      bytes memory bytesString = new bytes(32);
      uint charCount = 0;
      for (charCount = 0; charCount < 32; charCount++) {
        byte char = byte((uint(x) >> (32 - charCount - 1) * 8) & 0xFF);
        if (char == 0) {
          break;
        }
        bytesString[charCount] = char;
      }
      bytes memory bytesStringTrimmed = new bytes(charCount);
      for (uint j = 0; j < charCount; j++) {
          bytesStringTrimmed[j] = bytesString[j];
      }
      return string(bytesStringTrimmed);
  }
}

contract qq is Util {
  bytes32 bs = 0x32324f4354323000000000000000000000000000000000000000000000000000;
  string str;
  constructor() public {
    str = Util.bytes32ToString(bs);
  }
}|]
    getFields ["bs", "str"] `shouldReturn`
      [ BString "32324f4354323000000000000000000000000000000000000000000000000000"
      , BString "22OCT20"
      ]

  it "can read the length of new arrays" . runTest $ do
    runBS [r|
contract qq {
  uint public len;
  constructor() public {
    uint[] memory xs = new uint[](2);
    len = xs.length;
  }
}|]
    getFields ["len"] `shouldReturn` [BInteger 2]

  it "can pass local arrays as arguments" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract Validator {
  function isEmptyArray(bytes32[] memory _arr) pure internal returns (bool) {
    return _arr.length == 0;
  }
}

contract qq is Validator {
  bool public empty_is_empty;
  bool public nonempty_is_empty;
  uint public nonempty_length;
  constructor() public {
    bytes32[] memory empty;
    empty_is_empty = isEmptyArray(empty);

    bytes32[] memory nonempty = new bytes32[](1);
    nonempty_is_empty = isEmptyArray(nonempty);

  }
}
|]
    getFields ["empty_is_empty", "nonempty_is_empty"] `shouldReturn` [BBool True, BDefault]

  it "can resolve super" . runTest $ do
    let ctract = [r|
contract BaseContainer {
  function contains(uint x) internal returns (bool) {
    return x == 4;
  }
}

contract qq is BaseContainer {
  function contains(uint x) external returns (bool) {
    return super.contains(x);
  }
}|]
    runCall "contains" "(10)" ctract `shouldReturn`
        Just (SB.toShort $ B.replicate 32 0)
    runCall "contains" "(4)" ctract `shouldReturn`
        Just (SB.toShort $ B.replicate 31 0 <> B.singleton 1)

  it "selects the correct super with multiple parents" . runTest $ do
    runCall "value" "()" [r|
contract A {
    function value() public returns (uint) {
        return 0xa;
    }
}
contract B {
    function value() public returns (uint) {
        return 0xb;
    }
}
contract qq is A, B {
    function value() public returns (uint) {
        return super.value();
    }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 0xb)

  it "selects the correct super when parents are missing methods" . runTest $ do
    runCall "value" "()" [r|
contract A {
  function value() public returns (uint) {
    return 0xa;
  }
}
contract B {}
contract qq is A, B {
  function value() public returns (uint) {
    return super.value();
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0 <> B.singleton 0xa)

  it "can determine super instance by function name" . runTest $ do
    runBS [r|
contract A {
  function a() public pure returns (uint) { return 0xaaaa;}
}
contract B {
  function b() public pure returns (uint) { return 0xbbbb;}
}
contract qq is A, B{
  uint x;
  uint y;
  constructor() public {
    x = super.a();
    y = super.b();
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 0xaaaa, BInteger 0xbbbb]


  it "can use named return values" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  function f() public pure returns (uint _x) {
    _x = 887242634;
  }
  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 887242634]

  it "can return and used named returns" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  function f() public pure returns (uint _x) {
    if (true) {
      _x = 7272;
      return;
    }
    _x = 887;
  }
  constructor() public {
    x = f();
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 7272]

  it "can return early" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() {
    x = 343;
    return;
    x = 2401;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 343]

  it "can get an SContractItem value from another contract and compare the value via this.variableName" . runTest $ do
    runBS [r|
contract string_test {
  string v;
  constructor() {
    v = "test string";
  }
  function getTrueAndThisDotV() returns (bool, string) {
    return (true, this.v);
  }
}
contract qq {
  bool test;
  constructor(){ 
    test = it_getsTrueAndThisDotV();
  }
  function it_getsTrueAndThisDotV() external returns (bool) { // fails
    string_test y = new string_test();
    (bool b, string v) = y.getTrueAndThisDotV();
    return b && v == "test string" && (false == (v != "test string"));
  }
}|] 
    getFields ["test"] `shouldReturn` [BBool True]

  it "can initialize from constants" . runTest $ do
    runBS [r|
contract qq {
  uint constant c = 995;
  uint x = c;
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 995]

  it "can assign from constants" . runTest $ do
    runBS [r|
contract qq {
  uint constant c = 2007;
  uint x;
  constructor() public {
    x = c;
  }
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 2007]

  it "can read parent constants" . runTest $ do
    runBS [r|
contract Constants {
  uint constant VALIDATION_PASSED = 200;
}

contract qq is Constants {
  uint x;
  constructor() public {
    x = VALIDATION_PASSED;
  }
}|]

    getFields ["VALIDATION_PASSED", "x"] `shouldReturn` [BDefault, BInteger 200]

  it "can get the length of a string" . runTest $ do
    runBS [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = s.length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  it "can get the length of bytes" . runTest $ do
    runBS [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = bytes(s).length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  it "can call bytes32toString on literals" . runTest $ do
    runBS [r|
contract qq {
  string s;
  constructor() public {
    bytes32 x = "Will the real ";
    s = Util.bytes32ToString(x);
  }
}|]
    getFields ["s"] `shouldReturn` [BString "Will the real "]

  it "can return an address" . runTest $ do
    let want' = LabeledError.b16Decode "SolidVMSpec.hs" . BC.pack $ showHex (sender ^. accountAddress) ""
        want = B.replicate (32 - B.length want') 0x0 <> want'
    runCall "a" "()" [r|
contract qq {
  function a() public returns (address) {
    return msg.sender;
  }
}|] `shouldReturn` Just (SB.toShort want)

  it "can return an enum" . runTest $ do
    runCall "a" "()" [r|
contract qq {
  enum Letter { a, b, c }
  function a() public returns (Letter) {
    return Letter.c;
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 2)

  it "will initialize contracts as such" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract X {}

contract qq {
  X x;
}|]
    getFields ["x"] `shouldReturn` [bContract "X" 0x0]

  it "will initialize fields of indirect constructions" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS [r|
contract X {
  uint i;
  string s;
}

contract qq {
  X x;
  constructor() {
    x = new X();
  }
}|]
    [BContract "X" x] <- getFields ["x"]
    getSolidStorageKeyVal' (namedAccountToAccount Nothing x) (singleton "i") `shouldReturn` BDefault
    getSolidStorageKeyVal' (namedAccountToAccount Nothing x) (singleton "s") `shouldReturn` BDefault

  it "will create a sentinel for mappings" . runTest $ do
    liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
    runBS [r|
contract qq {
  mapping(string => uint) assoc;
}|]
    getFields ["assoc"] `shouldReturn` [BMappingSentinel]


  it "can compare contracts to int literals" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  bool eq;
  bool neq;
  constructor() public {
    qq q = qq(0);
    eq = q == 0x0;
    neq = q != 0x0;
  }
}|]
    getFields ["eq", "neq"] `shouldReturn` [BBool True, BDefault]

  it "can return a contract" . runTest $ do
    runCall "self" "()" [r|
contract qq {
  function self() public {
    return qq(this);
  }
}|] `shouldReturn` Just (SB.toShort . word256ToBytes $ coerce $ uploadAddress ^. accountAddress)

  it "merges actions for concurrent modifications" . runTest $ do
    xr <- runBS' [r|
contract Sub {
  uint x = 20;
  uint y = 40;

  function doubleY() public {
    y *= 2;
  }
}

contract qq {
  Sub s;

  constructor() public {
    s = new Sub();
    s.doubleY();
  }
}|]
    let diffs = fmap Action._actionDataStorageDiffs . Action._actionData <$> erAction xr
    diffs `shouldBe` Just (M.fromList
      [ (uploadAddress, Action.SolidVMDiff $ M.singleton ".s"
            (rlpSerialize $ rlpEncode $ bContract' "Sub" recursiveAddr))
      , (recursiveAddr, Action.SolidVMDiff $ M.fromList
          [ (".x", rlpSerialize $ rlpEncode $ BInteger 20)
          , (".y", rlpSerialize $ rlpEncode $ BInteger 80)
          ]
        )
      ])

  it "stores enum numbers" . runTest $ do
    runBS [r|
contract qq {
    enum E {A, B, C, D}
    E c = E.C;
}|]
    getFields ["c"] `shouldReturn` [BEnumVal "E" "C" 2]

  it "can cast ints to enums" . runTest $ do
    runCall "f" "(1)" [r|
contract qq {
  enum E {A, B, C, D}
  E e;
  function f(E _e) {
    e = _e;
  }
}|] `shouldReturn` Nothing
    getFields ["e"] `shouldReturn` [BEnumVal "E" "B" 1]

  it "can compare ints to enums" . runTest $ do
    runCall "f" "(1)" [r|
pragma solidvm 3.0;
contract qq {
  enum E {A, B, C, D}
  bool is_a;
  bool is_b;
  bool is_c;
  bool is_d;
  function f(E _e) {
    is_a = _e == E.A;
    is_b = _e == E.B;
    is_c = _e == E.C;
    is_d = _e == E.D;
  }
}|] `shouldReturn` Nothing
    getFields ["is_a", "is_b", "is_c", "is_d"] `shouldReturn`
      [BDefault, BBool True, BDefault, BDefault]



  it "can return single strings" . runTest $ do
    runCall "txt" "()" [r|
contract qq {
  function txt() public returns (string) {
    string ret = "Ticket ID already exists";
    return ret;
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL \NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\CANTicket ID already exists"


  it "can return tuples of strings" . runTest $ do
    runCall "txt" "()" [r|
contract qq {
  function txt() public returns (string, string, string) {
    return ("hey", "yo", "how are you?");
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL`\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\131\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\165\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\ETXhey\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\STXyo\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\fhow are you?" 


  it "can return tuples of mixed simple types and strings" . runTest $ do
    runCall "txt" "()" [r|
contract qq {
  function txt() public returns (string, uint, string, uint) {
    return ("hey", 42, "yo", 100);
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\128\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL*\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\163\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NULd\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\ETXhey\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\STXyo" 


  it "can return numeric bytes32" . runTest $ do
    runCall "num" "()" [r|
contract qq {
  function num() public returns (bytes32) {
    bytes32 ret = 0x5469636b657420494420616c7265616479206578697374730000000000000000;
    return ret;
  }
}|] `shouldReturn` Just "Ticket ID already exists\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL"

  it "can return state variables" . runTest $ do
    runCall "getS" "()" [r|
contract qq {
  string s = "The mitochondria is the powerhouse of the cell";
  function getS() public returns (string) {
    return s;
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL \NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL.The mitochondria is the powerhouse of the cell"

  it "can return state variables in tuples" . runTest $ do
    runCall "getSAndB" "()" [r|
pragma solidvm 3.2;
contract qq {
  string s = "The mitochondria is the powerhouse of the cell";
  function getSAndB() public returns (string, string) {
    return (s, s);
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL@\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\142\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL.The mitochondria is the powerhouse of the cell\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL.The mitochondria is the powerhouse of the cell"

  it "can accept string arguments" . runTest $ do
    runCall "set" "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")" [r|
contract qq {
  string st;
  function set(string _st) public {
    st = _st;
  }
}|] `shouldReturn` Nothing
    getFields ["st"] `shouldReturn` [BString "deadbeef00000000000000000000000000000000000000000000000000000000"]

  it "can accept Unicode string arguments" . runTest $ do
    runCall "set" "(\"4.11 g CO₂ / t · nm\")" [r|
contract qq {
  string st;
  function set(string _st) public {
    st = _st;
  }
}|] `shouldReturn` Nothing
    getFields ["st"] `shouldReturn` [BString (UTF8.fromString "4.11 g CO₂ / t · nm")]

  it "can encode Unicode strings in Solidtiy source" . runTest $ do
    runBS [r|
contract qq {
  string st = "4.11 g CO₂ / t · nm";
}|]
    getFields ["st"] `shouldReturn` [BString (UTF8.fromString "4.11 g CO₂ / t · nm")]

  it "can accept bytes32 arguments" . runTest $ do
    runCall "set" "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")" [r|
contract qq {
  bytes32 bs;
  function set(bytes32 _bs) public {
    bs = _bs;
  }
}|] `shouldReturn` Nothing
    getFields ["bs"] `shouldReturn` [BString "\xde\xad\xbe\xef"]

  it "should not compute remote arguments" $ runTest (do
    runCall "set" "(3 + block.timestamp)" [r|
contract qq {
  uint n;
  function set(uint _n) public {
    n = _n;
  }
}|]) `shouldThrow` anyParseError

  it "can call boolean arguments" . runTest $ do
    runCall "set" "(true,false)" [r|
pragma solidvm 3.0;
contract qq {
  bool a;
  bool b;
  function set(bool _a, bool _b) public {
    a = _a;
    b = _b;
  }
}|] `shouldReturn` Nothing
    getFields ["a", "b"] `shouldReturn` [BBool True, BDefault]

  it "sets the origin correctly" . runTest $ do
    runBS [r|
contract X {
  function trampoline() returns (address) {
    return tx.origin;
  }
}

contract qq {
  address resolved_origin;
  constructor() {
    X x = new X();
    resolved_origin = x.trampoline();
  }
}|]
    getFields ["resolved_origin"] `shouldReturn` [bAccount origin]

  it "sets the sender correctly" . runTest $ do
    runBS [r|
contract X {
    function remoteSender() public returns (address) {
        return msg.sender;
    }
}

contract qq {
    address public direct_set;
    address public local_call;
    address public remote_call;

    function localSender() public returns (address) {
        return msg.sender;
    }
    constructor() payable public {
        direct_set = msg.sender;
        local_call = localSender();
        X x = new X();
        remote_call = x.remoteSender();
    }
}|]
    getFields ["direct_set", "local_call", "remote_call"] `shouldReturn`
      [bAccount sender, bAccount sender, bAccount uploadAddress]

  it "can set owner from management contract" . runTest $ do
    runBS [r|
contract X {
  address public owner;
  constructor() public {
    owner = msg.sender;
  }
}

contract qq {
  X x;
  constructor() public {
    x = new X();
  }
}|]
    -- qq should become the `owner` in X
    getFields ["x"] `shouldReturn` [bContract' "X" recursiveAddr]
    getSolidStorageKeyVal' recursiveAddr (MS.singleton "owner") `shouldReturn`
      bAccount uploadAddress


  it "can cast from address" . runTest $ do
    runBS [r|
contract qq {
  address a;
  constructor() public {
    a = address(74);
  }
}|]
    getFields ["a"] `shouldReturn` [bAddress 74]

  it "can have a for loop with no fields" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
contract qq {
  uint i;
  constructor() public {
    for (;;) {
      i += 3;
      if (i % 5 == 0) {
        break;
      }
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 15]

  it "can have a while loop" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS [r|
pragma solidvm 3.0;
contract qq {
  uint i;
  constructor() public {
    while (i < 8) {
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 8]

  it "can accept modifiers" $ (runTest $ runBS [r| contract qq { modifier m() { _; } }|])
    `shouldReturn` ()

  it "catches parse errors" $ (runTest $ runBS [r| contract { |]) `shouldThrow` anyParseError

  it "catches arg parse errors" $ (runTest $ do
    runCall "f" "(" [r|
contract qq {
  function f() public {}
}|]) `shouldThrow` anyParseError

  it "throw an error when the 'account' reserved word is for a variable name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract A {
  uint account;
}|]) `shouldThrow` anyReservedWordError

  it "throw an error when the 'account' reserved word is for a contract name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract account {
  uint a;
}|]) `shouldThrow` anyReservedWordError

  it "throw an error when the 'account' reserved word is used for a function name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract A {
  function account() {
  }
}|]) `shouldThrow` anyReservedWordError

  it "catches missing function errors" $
    (runTest $ runCall "f" "()" [r|contract qq {}|]) `shouldThrow` anyUnknownFunc

  it "can cast to int" . runTest $ do
    runBS [r|
contract qq {
  int z;
  constructor() public {
    z = int(123456);
  }
}|]
    getFields ["z"] `shouldReturn` [BInteger 123456]

  it "can create storage references to structs" . runTest $ do
    runBS [r|
contract qq {
  struct Nom {
    string id;
    uint nomType;
  }
  Nom[] noms;

  constructor() public {
    noms.push(Nom("239847", 7777));
    Nom storage n = noms[0];
    n.nomType = 13;
  }
}|]
    getAll [ [Field "noms", Field "length"]
           , [Field "noms", ArrayIndex 0, Field "id" ]
           , [Field "noms", ArrayIndex 0, Field "nomType" ]
           ] `shouldReturn` [BInteger 1, BString "239847", BInteger 13]

  it "can create memory copies of structs" . runTest $ do
    liftIO $ pendingWith "add the memory keyword" --TODO- Jim
    runBS [r|
contract qq {
  struct Nom {
    string id;
    uint nomType;
  }
  Nom[] noms;
  uint newType;

  constructor() public {
    noms.push(Nom("ok", 41));
    Nom memory n = noms[0];
    n.nomType = 92;
    newType = n.nomType;
  }
}|]
    getAll [ [Field "noms", Field "length"]
           , [Field "noms", ArrayIndex 0, Field "id"]
           , [Field "noms", ArrayIndex 0, Field "nomType"]
           , [Field "newType"]
           ] `shouldReturn` [BInteger 1, BString "ok", BInteger 41, BInteger 92]

  it "can multiply return" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  string y;
  function f() public returns (uint, string) {
    return (24, "hello");
  }
  constructor() public {
    (x, y) = f();
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 24, BString "hello"]

  it "can set local vars" . runTest $ do
    runBS [r|
contract Rest {
  enum Status {
    OK,
    NOT_FOUND
  }
}

contract qq is Rest {
  uint sum;
  struct Permit {
    uint p;
  }
  function f() public returns (uint, uint) {
    Permit memory perm;
    perm.p = 400;
    return (uint(Status.OK), perm.p);
  }
  constructor() public {
    var (a, b) = f();
    sum = a + b;
  }
}
|]
    getFields ["sum"] `shouldReturn` [BInteger 400]

  it "does stuff after an if" . runTest $ do
    liftIO $ pendingWith "loop control fix"
    runBS [r|
contract qq {
  uint x = 40;
  constructor() public {
    x++;
    if (true) {
    } else {
    }
    x++;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 42]

  it "can parse a singleton tuple" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    var (z) = 247;
    x = z;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 247]

  it "doesn't need var for variables in scope" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  uint y;
  constructor() public {
    (x, y) = (10, 20);
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 10, BInteger 20]

  it "can array convert for index" . runTest $ do
    liftIO $ pendingWith "TODO: creating references into strings"
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    string txt = "hello, world";
    x = bytes(txt)[3];
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0x6c]

  it "can increment array members" . runTest $ do
    runBS [r|
contract qq {
    uint[] xs = [1,1,3];
    constructor() public {
        xs[1]++;
    }
}|]
    getAll [ [Field "xs", Field "length"]
           , [Field "xs", ArrayIndex 0]
           , [Field "xs", ArrayIndex 1]
           , [Field "xs", ArrayIndex 2]
           ] `shouldReturn` [BInteger 3, BInteger 1, BInteger 2, BInteger 3]

  it "can reference characters" . runTest $ do
    liftIO $ pendingWith "TODO: something"
    runBS [r|
contract qq {
    string public xs = "ok";
    constructor() public {
      bytes(xs)[0] = 't';
      bytes(xs)[1] = 'y';
    }
}|]
    getFields ["xs"] `shouldReturn` [BString "ty"]

  it "can parse named arguments" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  constructor() public {
    x = f({y: 99});
  }

  function f(uint y) public returns (uint) {
    return y + 2;
  }
}
|]
    getFields ["x"] `shouldReturn` [BInteger 101]

  it "can call named argument constructors" . runTest $ do
    runBS [r|
contract X {
  uint public y;
  string public z;

  constructor(uint _y, string _z) public {
    y = _y;
    z = _z;
  }
}

contract qq {
  X public x;
  constructor() public {
    x = new X({_z: "ok", _y: 0x777777});
  }
}|]
    getFields ["x"] `shouldReturn` [bContract' "X" recursiveAddr]
    mapM (getSolidStorageKeyVal' recursiveAddr) [MS.singleton "y", MS.singleton "z"]
      `shouldReturn` [BInteger 0x777777, BString "ok"]

  it "can cast a struct from named arguments" . runTest $ do
    runBS [r|
contract qq {
  struct S {
    uint x;
    uint y;
    string z;
  }
  S s;
  constructor() public {
    s = S({y: 87, z: "goodbye", x: 33});
  }
}|]
    getAll [ [Field "s", Field "x"]
           , [Field "s", Field "y"]
           , [Field "s", Field "z"]
           ] `shouldReturn` [BInteger 33, BInteger 87, BString "goodbye"]

  it "should be able to adjust arrayed structs" . runTest $ do
    runBS [r|
contract qq {
  struct X {
    uint x;
  }
  X[] xs;
  constructor() public {
    xs.push(X({x: 55}));
    xs[0].x *= 2;
  }
}|]
    getAll [ [Field "xs", ArrayIndex 0, Field "x" ]] `shouldReturn` [BInteger 110]

  it "can resolve variables for named arguments" . runTest $ do
    void $ runArgs "(\"stref\")" [r|
contract qq {
  struct X {
    string n;
  }
  X[] public names;
  constructor(string input_name) public {
    names.push(X({n: input_name}));
  }
}|]
    getAll [ [Field "names", ArrayIndex 0, Field "n"] ] `shouldReturn` [BString "stref"]

  it "can declare types for a tuple" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  string y;
  function f() returns (uint, string) {
    return (0x42, "ok");
  }

  constructor() public {
    (uint _x, string _y) = f();
    x = _x;
    y = _y;
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 0x42, BString "ok"]

  it "can create new bytes" . runTest $ do
    void $ runBS [r|
contract qq {
  bytes xs;
  constructor() public {
    xs = new bytes(3);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "\x00\x00\x00"]

  it "overrides addressToAsciiString" . runTest $ do
    void $ runBS [r|
contract qq {
  string xs;
  constructor() public {
    xs = addressToAsciiString(this);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe"]

  it "can cast empty bytes32 to int" . runTest $ do
    void $ runBS [r|
pragma solidvm 3.0;
contract qq {
  uint public x;
  constructor() public {
    x = uint(bytes(""));
  }
}|]
    getFields ["x"] `shouldReturn` [BDefault]

  it "can store nested structs" . runTest $ do
    void $ runBS [r|
contract qq {
  struct Inner {
    uint value;
  }
  struct Outer {
    Inner inner;
  }
  Outer public outer;
  constructor() public {
    Inner memory inner = Inner({value: 0x732});
    outer = Outer(inner);
  }
}
|]
    getAll [[Field "outer", Field "inner", Field "value"]] `shouldReturn` [BInteger 0x732]

  it "can not declare part of a tuple" . runTest $ do
    void $ runBS [r|
contract qq {
  uint x;
  function ab() returns (uint, uint) {
    return (71, 833);
  }
  constructor() public {
    var (_, b) = ab();
    x = b;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 833]

  it "can properly handle bytes setting" . runTest $ do
    void $ runBS [r|
pragma solidvm 3.2;
contract Bite_Test {
    bytes public b;
    function set(bytes _b) public {
        b = _b;
    }
}
pragma solidvm 3.2;
contract qq {
	Bite_Test bContract;
	bytes c;
	bytes d;	
	int  e;
	constructor (){
		bContract = new Bite_Test();
		d = 'ab';
		bContract.set(d);
		c = bContract.b();
		e = int(c) + int(d);	
		}
} |]
    getFields ["e"] `shouldReturn` [BInteger 342]


  it "rejects member access on primitives" $ (runTest (runBS [r|
contract qq {
  uint x = 0;
  uint y = x.mem;
}|])) `shouldThrow` anyTypeError

  it "rejects index access on primitives" $ (runTest (runBS [r|
contract qq {
  uint x = 0;
  uint y = x[1];
}|])) `shouldThrow` anyTypeError

  it "can emit events" . runTest $ do
    runBS [r|
contract qq {
  event x(uint v);
  constructor() {
    emit x(5);
  }
}|]

  it "can emit inherited events" . runTest $ do
    runBS [r|
contract parent {
  event x(uint v);
}

contract qq is parent {
  constructor() {
    emit x(6);
  }
}|]

  it "can assign directly to index of an array" . runTest $ do
    runBS [r|
contract qq {
  uint[] arr;
  uint x;

  constructor() {
    arr[0] = 42;
    x = arr[0];
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 42]

  it "can assign directly to index of a mapping" . runTest $ do
    runBS [r|
contract qq {
  mapping(bool => uint) bs;
  uint x;

  constructor() {
    bs[true] = 42;
    x = bs[true];
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 42]

  it "throws array index out of bounds exception" $ (runTest (runBS [r|
contract qq {
   uint x;
    
   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[5];
   }
}|])) `shouldThrow` anyIndexOOBError

  it "type checks the index value in array index access" $ (runTest (runBS [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[true];
   }
}|])) `shouldThrow` anyTypeError
 
  it "type checks the index value in array index assignment" $ (runTest (runBS [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      arr[true] = 2112;
   }
}|])) `shouldThrow` anyTypeError
 
  it "rejects empty index value on array index access" $ (runTest (runBS [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[];
   }
}|])) `shouldThrow` anyMissingFieldError
 
  it "rejects empty index value on mapping index access" $ (runTest (runBS [r|
contract qq {
   mapping(bool => uint) bs;
   uint x;

   constructor()
   {
      x = bs[];
   }
}|])) `shouldThrow` anyMissingFieldError
 
  it "rejects empty index value on array index assignment" $ (runTest (runBS [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      arr[] = 2112;
   }
}|])) `shouldThrow` anyMissingFieldError

  it "rejects empty index value on mapping index assignment" $ (runTest (runBS [r|
contract qq {
   mapping(bool => uint) bs;
   uint x;

   constructor()
   {
      bs[] = 42;
   }
}|])) `shouldThrow` anyMissingFieldError

  it "supports while loops" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  uint x = 0;

  constructor() {
    while ( x < 3 )
    {
          x++;
    }
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 3]

  it "can handle all expr combinations for logical AND clause " . runTest $ do
    runBS [r|
contract qq {
  uint x = 0;
  uint magic = 42;

  constructor() {
    if (magic == 0 && x == 0) {
      x++;
    }
    if (magic == 42 && x == 0) {
      x++;
    }
    if (magic == 100 && x == 1) {
      x++;
    }
    if (magic == 1000 && x == 0) {
      x++;
    }
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 1]

  it "RHS expr in an AND clause is not evaluated if the LHS expr evaluates to False" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  uint x = 0;
  uint magic = 42;

  constructor() {
    if (magic > 100 && ++x > 100)
    {
      return 0;
    }
    return 0;
  }

}|]
    getFields ["x"] `shouldReturn` [BDefault]

  it "can handle all expr combinations for logical OR clause " . runTest $ do
    runBS [r|
contract qq {
  uint x = 0;
  uint magic = 42;

  constructor() {
    if (magic == 0 || x == 0) {
      x++;
    }
    if (magic == 42 || x == 0) {
      x++;
    }
    if (magic == 100 || x == 2) {
      x++;
    }
    if (magic == 1000 || x == 0) {
      x++;
    }
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 3]

  it "RHS expr in an OR clause is not evaluated if the LHS expr evaluates to True" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  uint x = 0;
  uint magic = 42;

  constructor() {
    if (magic == 42 || ++x > 100)
    {
      return 0;
    }
    return 0;
  }

}|]
    getFields ["x"] `shouldReturn` [BDefault]

  it "rejects declared but undefined constructor" $ (runTest (runBS [r|
contract qq {
   constructor();
}|])) `shouldThrow` anyMissingFieldError

  it "rejects declared but undefined function" $ (runTest (runBS [r|
contract qq {
   function f();
   
   constructor()
   {
      f();
   }
}|])) `shouldThrow` anyMissingFieldError

  it "should accept multiple named return values" . runTest $ do
    runBS [r|
contract qq {
  uint x;
  string y;
  address z;
  function f() returns (uint _x, string _y, address _z) {
    _x = 123;
    _y = "456";
    _z = address(0x789);
  }
  constructor() {
    (x,y,z) = f();
  }
}|]
    getFields ["x","y","z"] `shouldReturn` [BInteger 123, BString "456", bAddress 0x789]

  it "catches division by zero error" $ (runTest (runBS [r|
contract qq {
  
   uint x = 42;
   uint y = 0;

   constructor()
   {
      return 42/0;
   }
}|])) `shouldThrow` anyDivideByZeroError 

  it "supports ternary operations" . runTest $ do
    runBS [r|
contract qq {
  
  uint x;
  uint y;

  constructor() {
    x = true == true ? 100 : 42;
    y = true == false ? 100 : 42;
  
  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 42]


  it "rejects illegal enum access" $ (runTest (runBS [r|
contract qq {
  
  enum Role { ADMIN, USER }
  uint[] perms;

  constructor() {
    perms[uint(Role.ADMIN)] = 10;
    perms[uint(Role.OTHER)] = 100;
  }
}|])) `shouldThrow` anyMissingTypeError

  it "can concatenate strings" . runTest $ do
    runCall "concat" "(\"Hello\",\" World!\")" [r|
contract qq {
  string c;
  function concat(string a, string b) public {
    c = a + b;
  }
}|] `shouldReturn` Nothing
    getFields ["c"] `shouldReturn` [BString "Hello World!"]

  it "can append to a string" . runTest $ do
    runCall "append" "(\" World!\")" [r|
contract qq {
  string a = "Hello";
  function append(string b) public {
    a += b;
  }
}|] `shouldReturn` Nothing
    getFields ["a"] `shouldReturn` [BString "Hello World!"]

  it "can cast accounts and addresses to string" . runTest $ do
    runBS [r|
contract qq {
  string ces;
  string cms;
  string cus;
  string ds;
  constructor() public {
    ces = string(account(0xdeadbeef, 0xfeedbeef));
    cms = string(account(0xdeadbeef, "main"));
    cus = string(account(0xdeadbeef));
    ds = string(address(0xdeadbeef));
  }
}|]
    getFields ["ces", "cms", "cus", "ds"] `shouldReturn`
      [ BString "00000000000000000000000000000000deadbeef:00000000000000000000000000000000000000000000000000000000feedbeef"
      , BString "00000000000000000000000000000000deadbeef:main"
      , BString "00000000000000000000000000000000deadbeef"
      , BString "00000000000000000000000000000000deadbeef"
      ]

  it "can cast ints to string" . runTest $ do
    runBS [r|
contract qq {
  string p;
  constructor() public {
    p = string(1234567890);
  }
}|]
    getFields ["p"] `shouldReturn`
      [ BString "1234567890"
      ]

  it "can cast bools to string" . runTest $ do
    runBS [r|
contract qq {
  string t;
  string f;
  constructor() public {
    t = string(true);
    f = string(false);
  }
}|]
    getFields ["t", "f"] `shouldReturn`
      [ BString "true"
      , BString "false"
      ]

  it "can cast strings to accounts and addresses" . runTest $ do
    runBS [r|
contract qq {
  account sce;
  account scm;
  account scu;
  address sde;
  address sdm;
  address sdu;
  constructor() public {
    sce = account("deadbeef:feedbeef");
    scm = account("deadbeef:main");
    scu = account("deadbeef");
    sde = address("deadbeef:feedbeef");
    sdm = address("deadbeef:main");
    sdu = address("deadbeef");
  }
}|]
    getFields ["sce", "scm", "scu", "sde", "sdm", "sdu"] `shouldReturn`
      [ BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedbeef)) 
      , BAccount (NamedAccount 0xdeadbeef MainChain) 
      , BAccount (NamedAccount 0xdeadbeef UnspecifiedChain) 
      , BAccount (NamedAccount 0xdeadbeef UnspecifiedChain) 
      , BAccount (NamedAccount 0xdeadbeef UnspecifiedChain) 
      , BAccount (NamedAccount 0xdeadbeef UnspecifiedChain) 
      ]
  
  it "can cast strings to chainIds" . runTest $ do
    runBS [r|
contract qq {
  account sce;
  account scm;
  account scu;
  
  constructor() public {
    sce = account("deadbeef:feedbeef");
    scm = account(address("deadbeef"), "0xfeedb33f");
    scu = account(0xdeadbeef, "0xf33dbeef");
  }
}|]
    getFields ["sce", "scm", "scu"] `shouldReturn`
      [ BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedbeef)) 
      , BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedb33f)) 
      , BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xf33dbeef)) 
      ]

  it "can cast strings to bool" . runTest $ do
    runBS [r|
pragma solidvm 3.0;
contract qq {
  bool control;
  bool t;
  bool f;
  constructor() public {
    control = bool(true);
    t = bool("true");
    f = bool("false");
  }
}|]
    getFields ["control", "t", "f"] `shouldReturn`
      [ BBool True
      , BBool True
      , BDefault
      ]

  it "will not transfer when there is not anything to transfer between account" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  uint bal;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function myTransfer() internal pure
    returns (uint){
      aPay.transfer(13);
      bal = aPay.balance;
      return bal;
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a) 
    getFields ["bal"] `shouldReturn` [ BInteger 13 ]

  it "will not over send (send when there is not enough gas)" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() internal pure
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 7 })
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a) 
    getFields ["success", "bal"] `shouldReturn` [ BDefault, BInteger 7 ]

  it "will allow for sending to self" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() internal pure
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a) 
    getFields ["success", "bal"] `shouldReturn` [ BBool True, BInteger 13 ]

  it "will not send when there is not anything to send between account" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() internal pure
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 0 })
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a) 
    getFields ["success", "bal"] `shouldReturn` [ BDefault, BDefault ]

  it "cannot send to a non account payable type" $ runTest (do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
  }
  function mySend() internal pure
    returns (uint, bool){
      success = a.send(13);
      bal = a.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 26 })
    -- Check return of balance
    (void $ call2 "mySend" "()" (namedAccountToAccount Nothing a))) `shouldThrow` anyTypeError 

  it "cannot transfer for non account payable types" $ runTest (do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
  }
  function myTransfer() internal pure
    returns (uint, bool){
      success = a.transfer(13);
      bal = a.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 26 })
    -- Check return of balance
    (void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a))) `shouldThrow` anyTypeError

  it "can handle a three account transfer (only transfer from `this` account into only one account, leaving the third account alone)" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  account b;
  account payable bPay;
  account c;
  account payable cPay;
  uint bala;
  uint balb;
  uint balc;
  constructor() public {
    Test t = new Test();
    a = account(this);
    aPay = payable(a);
    b = account(0xdeadbeef);
    bPay = payable(b);
    c = account(t);
    cPay = payable(c);
  }
  function myTransfer() internal pure
    returns (uint, uint, uint){
      bPay.transfer(13);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [ BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs { addressStateBalance = 13 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a) 
    getFields ["bala", "balb", "balc"] `shouldReturn` 
      [ BInteger 1,
        BInteger 26,
        BInteger 13 ]

  it "can handle a three account send (only send from `this` account into only one account, leaving the third account alone)" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  account b;
  account payable bPay;
  account c;
  account payable cPay;
  uint bala;
  uint balb;
  uint balc;
  bool success;
  constructor() public {
    Test t = new Test();
    a = account(this);
    aPay = payable(a);
    b = account(0xdeadbeef);
    bPay = payable(b);
    c = account(t);
    cPay = payable(c);
  }
  function mySend() internal pure
    returns (bool, uint, uint, uint){
      success = bPay.send(13);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (success, bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [ BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs { addressStateBalance = 13 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a) 
    getFields ["success", "bala", "balb", "balc"] `shouldReturn` [ BBool True, BInteger 1, BInteger 26, BInteger 13 ]

  it "cannot over transfer from an account." $ runTest (do
    runBS [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  account b;
  account payable bPay;
  account c;
  account payable cPay;
  uint bala;
  uint balb;
  uint balc;
  constructor() public {
    Test t = new Test();
    a = account(this);
    aPay = payable(a);
    b = account(0xdeadbeef);
    bPay = payable(b);
    c = account(t);
    cPay = account(c);
  }
  function myTransfer() internal pure
    returns (uint, uint, uint){
      bPay.transfer(1300);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [ BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs { addressStateBalance = 13 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs { addressStateBalance = 13 })
    -- Check return of balance
    (void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a))) `shouldThrow` anyPaymentError

  it "cannot over send from an account." . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  account b;
  account payable bPay;
  account c;
  account payable cPay;
  uint bala;
  uint balb;
  uint balc;
  bool success;
  constructor() public {
    Test t = new Test();
    a = account(this);
    aPay = payable(a);
    b = account(0xdeadbeef);
    bPay = payable(b);
    c = account(t);
    cPay = payable(c);
  }
  function mySend() internal pure
    returns (uint, uint, uint){
      success = bPay.send(1300);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [ BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs { addressStateBalance = 13 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields [ "success", "bala", "balb", "balc"] `shouldReturn` 
      [ BDefault,
        BInteger 14, 
        BInteger 13,
        BInteger 13 ]

  it "can get the chainId from the account type" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  account a1;
  account a2;
  account a3;
  account a4;
  uint cid1;
  uint cid2;
  uint cid3;
  uint cid4;
  constructor() public {
    a1 = account(0xdeadbeef, 0xfeedbeef);
    a2 = account(0x123, "main");    
    a3 = account(0x124);
    a4 = account(0xdeadbeef, "0xdeadbeef");
    cid1 = a1.chainId;
    cid2 = a2.chainId;
    cid3 = a3.chainId;
    cid4 = a4.chainId;
  }
}|]
    getFields ["cid1", "cid2", "cid3"] `shouldReturn`
      [ BInteger 0xfeedbeef
      , BDefault
      , BDefault
      ]
  it "can get the chainId directly from the account constructor" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint a1;
  uint a2;
  uint a3;
  uint a4;
  uint a5;
  constructor() public {
    a1 = account(0xdeadbeef, 0xfeedbeef).chainId;
    a2 = account(0x123, "main").chainId;
    a3 = account(0x124, "self").chainId;
    a4 = account(0x125).chainId;
    a5 = account(this, "self").chainId;
  }
}|]
    getFields ["a1", "a2", "a3", "a4", "a5"] `shouldReturn`
      [ BInteger 0xfeedbeef, BDefault, BDefault, BDefault, BDefault ]


  it "can get the balance from an address" . runTest $ do
    -- Post contract
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  uint bal;
  constructor() public {
    a = account(this);
  }
  function myBalance() {
    bal = a.balance;
  }
}|]
    -- Get the contract's account
    [ BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 13 })
    -- Check return of balance
    void $ call2 "myBalance" "()" (namedAccountToAccount Nothing a) 
    getFields ["bal"] `shouldReturn` [ BInteger 13 ]
  it "can get the codehash from an address" . runTest $ do
    let contract = [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}

pragma solidvm 3.2;
contract qq{
  string codeHashTest;
  constructor() public {
    Test t = new Test();
    codeHashTest = account(t).codehash;
  }
}|]
    runBS contract
    getFields ["codeHashTest", "codeHashTest"] `shouldReturn`
      [ BString $ BC.pack $ keccak256ToHex $ hash $ UTF8.fromString contract
      , BString "a37c4f1c44888f20d2b8dad57919efe0d6aec401ff8af47180e07e0b32096086" ]

  it "can the codehash from this an address" . runTest $ do
    let contract = [r|
pragma solidvm 3.2;
contract qq{
  string codeHashTest;
  constructor() public {
    codeHashTest = account(this).codehash;
  }
}|]
    runBS contract
    getFields ["codeHashTest", "codeHashTest"] `shouldReturn`
      [ BString $ BC.pack $  keccak256ToHex $ hash $ UTF8.fromString contract 
      , BString "657f5687fe89bd0bd3cee84e83c306c65458c0b13d13991087f9a7330474f2d8" ]

  it "can get the code from an address" . runTest $ do
    let contract :: String
        contract = [r|
pragma solidvm 3.2;
contract Test {
  constructor(){}
}

pragma solidvm 3.2;
contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code;
  }
}|]
    runBS contract
    getFields ["codeTest"] `shouldReturn`
      [ BString $ UTF8.fromString contract]

  it "can get the current contract code" . runTest $ do
    let contract :: String
        contract = [r|
pragma solidvm 3.2;
contract qq{
  string codeTest;
  constructor() public {
    codeTest = account(this).code;
  }
}|]
    runBS contract
    getFields ["codeTest"] `shouldReturn`
      [ BString $ UTF8.fromString contract]

  it "can transfer value from account a to account b" . runTest $ do
    -- Post contract
    runBS [r|
pragma solidvm 3.2;
contract qq{
  account a;
  account payable aPay;
  account b;
  account payable bPay;
  uint bala;
  uint balb;
  constructor() public {
    a = account(this);
    aPay = payable(a);
    b = account(0xdeadbeef);
    bPay = payable(b);
  }
  function myBalance() {
    //from the account address "a" transfer funds to the account address "b"
      //the full balance from account a
    bPay.transfer(13);
    bala = aPay.balance;
    balb = bPay.balance;
  }
}|]
    -- Get both of the contracts
    [ BAccount a] <- getFields ["a"]
    [ BAccount b] <- getFields ["b"]
    -- Set the balance and instantiate both of the accounts the accounts
    -- Account a should start with 13 and b should have 0 at the start.
    -- The transfer member should be able to send the balance of to account b
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs { addressStateBalance = 0 })

    -- Check return of balance
    void $ call2 "myBalance" "()" (namedAccountToAccount Nothing a) 
    getFields ["bala", "balb"] `shouldReturn` [ BInteger 1, BInteger 13  ]

  it "can't assign a value to an unallocated index in an array" $ (runTest (runBS [r|
pragma solidvm 3.0;
contract qq {
  uint z;
  uint[] x;
  uint[] myVar;
  constructor() {
    myVar = f();
    z = myVar[0];
  }
  function f() returns (uint[]) {
    // assignment of first value
    uint[] x;
    x[0] = 1;
    return x;
  }
  }|])) `shouldThrow` anyInvalidWriteError

  it "can run the typechecker when using pragma solidvm 3.2" $ (runTest (runBS [r|
pragma solidvm 3.2;
contract qq {
  uint x = "hello";
  string y = true;
  bool z = 8;
  address a = 42;
  string[] b = "array";
  enum RestStatus { W, X, Y, Z }
  struct Complex {
    uint re;
    uint im;
  }
  RestStatus r = Complex(0, 1);
  Complex i = RestStatus.Z;
}|])) `shouldThrow` anyTypeError




  it "can parse an X509 certificate" . runTest $ do
    runBS [r|
contract qq {

    string myNewCertificate = "-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----";

    string myCommonName         = "";
    string myCountry            = "";
    string myOrganization       = "";
    string myGroup              = "";
    string myOrganizationalUnit = "";
    string myPublicKey          = "";

    constructor() {
        myCommonName          = parseCert(myNewCertificate)["commonName"];
        myCountry             = parseCert(myNewCertificate)["country"];
        myOrganization        = parseCert(myNewCertificate)["organization"];
        myGroup               = parseCert(myNewCertificate)["group"];
        myOrganizationalUnit  = parseCert(myNewCertificate)["organizationalUnit"];
        myPublicKey           = parseCert(myNewCertificate)["publicKey"];
    }
}|]
    getFields ["myCommonName", "myCountry", "myOrganization", "myGroup", "myPublicKey"] `shouldReturn`
      [ BString "dan"
      , BString "USA"
      , BString "blockapps"
      , BString "engineering"
      , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEGOKeu5dSCBFHVQuy/q1A8BeTb99G83tD\nVecvHHne6sKfmBZN1AIjhpHGKO22vBfdq3dMn/QBqb2TdR9w3WvMXQ==\n-----END PUBLIC KEY-----\n"
      ]

    getFields ["myCommonName", "myCountry", "myOrganization", "myOrganizationalUnit", "myPublicKey"] `shouldReturn`
      [ BString "dan"
      , BString "USA"
      , BString "blockapps"
      , BString "engineering"
      , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEGOKeu5dSCBFHVQuy/q1A8BeTb99G83tD\nVecvHHne6sKfmBZN1AIjhpHGKO22vBfdq3dMn/QBqb2TdR9w3WvMXQ==\n-----END PUBLIC KEY-----\n"
      ]

  it "only a contract posted by the root user can call registerCert" $ (runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjjCCATKgAwIBAgIRANJH2FERGO/3JvoPHo52I3IwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyNTE0NTIwMloXDTIzMDQy\nNTE0NTIwMlowSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANIADBFAiEA\n9sjaARt+VEUCjZv3NAuEENoD744fZIuuUTt6qwM7fKQCIDLp02y/lSHtLfOOgCW5\n40qEIDYu2UO1JqSuyGvIUOoc\n-----END CERTIFICATE-----";
    constructor() {
        registerCert(myCertificate);
    }
}|]) `shouldThrow` anyInvalidWriteError

  it "can only post X509 certificates to the address of the public key" . runTest $ do
    void $ runArgsWithOrigin rootAcc sender "()" [r|
pragma solidvm 3.2;
contract qq {
    account public certAddr = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0, "main");
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
    string public certName;
    string public certOrg;
    constructor() {
        registerCert(myCertificate);
        certName = getUserCert(certAddr)["commonName"];
        certOrg = getUserCert(certAddr)["organization"];
    }
}|]
    getFields ["certName", "certOrg"] `shouldReturn`
      [ BString "Admin",
        BString "BlockApps"
      ]

  it "cannot post X509 certificates not signed by the BlockApps private key" $ (runTest $ do
    void $ runArgsWithOrigin rootAcc sender "()" [r|
pragma solidvm 3.2;
contract qq {
    account public certAddr = account(0xe79beda3078bcb66524f91f74de982d2fcc89287);
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjjCCATKgAwIBAgIRANJH2FERGO/3JvoPHo52I3IwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyNTE0NTIwMloXDTIzMDQy\nNTE0NTIwMlowSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANIADBFAiEA\n9sjaARt+VEUCjZv3NAuEENoD744fZIuuUTt6qwM7fKQCIDLp02y/lSHtLfOOgCW5\n40qEIDYu2UO1JqSuyGvIUOoc\n-----END CERTIFICATE-----";
    string public certName;
    string public certOrg;
    constructor() {
        registerCert(myCertificate);
        certName = getUserCert(certAddr)["commonName"];
        certOrg = getUserCert(certAddr)["organization"];
    }
}|]) `shouldThrow` anyInvalidCertError

  it "cannot register a x509 certificate on a private chain" $ (runTest $ do
    void $ runArgsWithOrigin rootAcc privateChainAcc "()" [r|
pragma solidvm 3.2;
contract qq {
    account myAccount = account("deadbeef:feedbeef");
    
    string myNewCertificate = "-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----";

    constructor() {
        registerCert(myNewCertificate); 
    }
}|]) `shouldThrow` anyInvalidWriteError

  it "cannot use old registerCert on solidvm 3.2" $ (runTest $ do
      (runBS [r|
  pragma solidvm 3.2;
  contract qq {
      account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
      string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
      string public certPubKey;
      constructor() {
          registerCert(certAddr, myCertificate);
          certPubKey = getUserCert(certAddr)["publicKey"];
      }
  }|])) `shouldThrow` anyUnknownFunc

  it "cannot use new registerCert(string _cert) on solidvm < 3.2" $ (runTest $ do
      (runBS [r|
  contract qq {
      account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
      string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
      string public certPubKey;
      constructor() {
          registerCert(myCertificate);
          certPubKey = getUserCert(certAddr)["publicKey"];
      }
  }|])) `shouldThrow` anyUnknownFunc
  
  it "cannot use new registerCert(string _cert, Certificate c) on solidvm < 3.2" $ (runTest $ do
      (runBS [r|
  contract Certificate {
    string name;
    constructor(string _name) {
      name = _name;
    }
  }
  contract qq {
      account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
      string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
      string public certPubKey;
      constructor() {
          Certificate c = new Certificate("foo");
          registerCert(myCertificate, c);
          certPubKey = getUserCert(certAddr)["publicKey"];
      }
  }|])) `shouldThrow` anyInvalidWriteError
  
  it "can only post X509 certificates to the address of the public key" . runTest $ do
    void $ runArgsWithOrigin rootAcc sender "()" [r|
pragma solidvm 3.2;
contract Certificate {
    string name;
    constructor(string _name) {
      name = _name;
    }
  }
contract qq {
    event CertificateRegistered(address userAddress, address contractAddress);
    account public certAddr = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0, "main");
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
    string public certName;
    string public certOrg;
    constructor() {
        Certificate c = new Certificate("foo");
        registerCert(myCertificate, c);
        certName = getUserCert(certAddr)["commonName"];
        certOrg = getUserCert(certAddr)["organization"];
    }
}|]
    getFields ["certName", "certOrg"] `shouldReturn`
      [ BString "Admin",
        BString "BlockApps"
      ]
  it "can get a users cert" . runTest $ do
    void $ runArgsWithOrigin rootAcc sender "()" [r|
pragma solidvm 3.2;
contract qq {
    account myAccount = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0);
    
    string myNewCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";


    string myUsername     = "";
    string myOrganization = "";
    string myGroup        = "";
    string myOrganizationalUnit  = "";
    string certificate    = "";
    string myCommonName   = "";
    string myCountry      = "";
    string myOrganization = "";
    string myGroup        = "";
    string myOrganizationalUnit  = "";
    string myPublicKey    = "";
    string myCertificate  = "";

    constructor() {
        registerCert(myNewCertificate); 

        myUsername     = tx.username;
        myOrganization = tx.organization;
        myGroup        = tx.group;
        myOrganizationalUnit = tx.organizationalUnit;
	
        certificate    = tx.certificate;
        myCommonName   = getUserCert(myAccount)["commonName"];
        myCountry      = getUserCert(myAccount)["country"];
        myOrganization = getUserCert(myAccount)["organization"];
        myGroup        = getUserCert(myAccount)["group"];
        myOrganizationalUnit  = getUserCert(myAccount)["organizationalUnit"];
        myPublicKey    = getUserCert(myAccount)["publicKey"];
        myCertificate  = getUserCert(myAccount)["certString"];
    }
}|]
    getFields ["myUsername", "myOrganization", "myGroup", "certificate","myCommonName", "myCountry", "myOrganization", "myGroup", "myPublicKey", "myCertificate"] `shouldReturn`
      [ BString "Admin"
      , BString "BlockApps"
      , BString "Engineering"
      , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
      , BString "Admin"
      , BString "USA"
      , BString "BlockApps"
      , BString "Engineering"
      , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----\n"
      , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
      ]
    getFields ["myUsername", "myOrganization", "myOrganizationalUnit", "certificate","myCommonName", "myCountry", "myOrganization", "myOrganizationalUnit", "myPublicKey", "myCertificate"] `shouldReturn`
      [ BString "Admin"
      , BString "BlockApps"
      , BString "Engineering"
      , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
      , BString "Admin"
      , BString "USA"
      , BString "BlockApps"
      , BString "Engineering"
      , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----\n"
      , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
      ]
  -- TODO change test to use new vm version once it is decided on


  it "can call builtin function verifyCert" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
    bool isValid = false;
    constructor() {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|] 
    getFields ["isValid"] `shouldReturn` [ BBool True ]

  it "verifyCert fails for hex-encoded public keys" $ (runTest $ do
    (runBS [r|
pragma solidvm 3.2;
contract qq {
  bool isValid = false;
    constructor () {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "04521251e31fb06625fec592b69bfa70378d1cbc24b4500ed9d0307bb27cb966734bc38dc980acf45110d8db260e3e4868200a7114af5453705ce014403435a675";
      isValid = verifyCert(cert, pubkey);
    }
}|])) `shouldThrow` anyMalformedDataError

  it "verifyCert succeeds with a chained cert" . runTest $ do
    let cert = T.pack $ filter (\c -> not (isSpace c) || c == ' ') [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
JN1cZoLJ4yhjGrEHRxzPNDAMBggqhkjOPQQDAgUAMEMx\nDjAMBgNVBAMMBUNOT25lMREwDwYDVQQKDAhDTk9uZU9yZzEQMA4GA1UECwwHT25l\nVW5pdDE
MMAoGA1UEBgwDVVNBMB4XDTIyMDUxMDE5MTcwMloXDTIzMDUxMDE5MTcw\nMlowQzEOMAwGA1UEAwwFQ05Ud28xETAPBgNVBAoMCENOVHdvT3JnMRAwDgYD
VQQL\nDAdUd29Vbml0MQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUrgQQACgNCAATk\niocODuRYeg5AZT80BwIAdH+ScbFdsUG9xhjOfG82c4TeuCM
soUslu4JsvL6MfaV8\nU7l8Lw0M6yiTGb0DPveZMAwGCCqGSM49BAMCBQADSAAwRQIhAKr7MLKSXJ1bOpGO\nfbLV+n+dzQjd2gQXXqP0OMIIDjuGAiBaea
dbSMOTJRYIJ4PV9C0oyyk/Xrvv4/R/\nEyun8du+BQ==\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIBiTCCAS2gAwIBA
gIRAN7G0Wzu8Z4GkKgUUNkz4kEwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdp
bmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDUxMDE5MTY1OVoXDTIzMDUx\nMDE5MTY1OVowQzEOMAwGA1UEAwwFQ05PbmUxETAPBgNVBAoMCENOT25lT
3JnMRAw\nDgYDVQQLDAdPbmVVbml0MQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAARaBoYAP4TNHMD7Nkgs8PNHMMmJRF9Nhhn89iPH
bppw4AooeNfoeQ1SVWAn\nQ3/Wh4w9hGFeba0MaBm3pVtLWJ/zMAwGCCqGSM49BAMCBQADSAAwRQIhAPmPkkFv\n5nGnvprxgxOqW9xQiuCdTzBSTGELvlz
we2CIAiBFjj1qyTywdRej7fSOfG9il421\ndB2DWeHbCK7C6S6PvQ==\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIBjT
CCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQ
LDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBA
oMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6c
DeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf
2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----|]
        contract = T.unpack $ T.replace "$CERT" cert [r|
pragma solidvm 3.2;
contract qq {
    bool isValid = false;
    constructor() {
      string cert = "$CERT";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|] 
    runBS contract
    getFields ["isValid"] `shouldReturn` [ BBool True ]

  it "verifyCert fails with a chained cert and the wrong public key" . runTest $ do
    let cert = T.pack $ filter (\c -> not (isSpace c) || c == ' ') [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
JN1cZoLJ4yhjGrEHRxzPNDAMBggqhkjOPQQDAgUAMEMx\nDjAMBgNVBAMMBUNOT25lMREwDwYDVQQKDAhDTk9uZU9yZzEQMA4GA1UECwwHT25l\nVW5pdDE
MMAoGA1UEBgwDVVNBMB4XDTIyMDUxMDE5MTcwMloXDTIzMDUxMDE5MTcw\nMlowQzEOMAwGA1UEAwwFQ05Ud28xETAPBgNVBAoMCENOVHdvT3JnMRAwDgYD
VQQL\nDAdUd29Vbml0MQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUrgQQACgNCAATk\niocODuRYeg5AZT80BwIAdH+ScbFdsUG9xhjOfG82c4TeuCM
soUslu4JsvL6MfaV8\nU7l8Lw0M6yiTGb0DPveZMAwGCCqGSM49BAMCBQADSAAwRQIhAKr7MLKSXJ1bOpGO\nfbLV+n+dzQjd2gQXXqP0OMIIDjuGAiBaea
dbSMOTJRYIJ4PV9C0oyyk/Xrvv4/R/\nEyun8du+BQ==\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIBiTCCAS2gAwIBA
gIRAN7G0Wzu8Z4GkKgUUNkz4kEwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdp
bmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDUxMDE5MTY1OVoXDTIzMDUx\nMDE5MTY1OVowQzEOMAwGA1UEAwwFQ05PbmUxETAPBgNVBAoMCENOT25lT
3JnMRAw\nDgYDVQQLDAdPbmVVbml0MQwwCgYDVQQGDANVU0EwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAARaBoYAP4TNHMD7Nkgs8PNHMMmJRF9Nhhn89iPH
bppw4AooeNfoeQ1SVWAn\nQ3/Wh4w9hGFeba0MaBm3pVtLWJ/zMAwGCCqGSM49BAMCBQADSAAwRQIhAPmPkkFv\n5nGnvprxgxOqW9xQiuCdTzBSTGELvlz
we2CIAiBFjj1qyTywdRej7fSOfG9il421\ndB2DWeHbCK7C6S6PvQ==\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nMIIBjT
CCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQ
LDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBA
oMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6c
DeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf
2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----|]
        contract = T.unpack $ T.replace "$CERT" cert [r|
pragma solidvm 3.2;
contract qq {
    bool isValid = false;
    constructor() {
      string cert = "$CERT";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEAlGfMOmhI+AjQlfxve8YoEXhZErFdkCx\nc8OkTB1TP6giwof4fWG+Fua8b2W0YjOQkrQojwnKbBDt3CQeqU+bPA==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|] 
    runBS contract
    getFields ["isValid"] `shouldReturn` [ BDefault ]

  it "can call builtin function verifySignature" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]  
    getFields ["isValid"] `shouldReturn` [ BBool True ]
  
  it "verifySignature fails for an incorrect message hash" $ (runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "I am not the message hash";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]) `shouldThrow` anyMalformedDataError

  it "verifySignature fails for an incorrect signature" $ (runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "30450220ac3c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]) `shouldThrow` anyMalformedDataError
  
  it "verifySignature fails for a hex-encoded public key" $ (runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "04521251e31fb06625fec592b69bfa70378d1cbc24b4500ed9d0307bb27cb966734bc38dc980acf45110d8db260e3e4868200a7114af5453705ce014403435a675";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]) `shouldThrow` anyMalformedDataError

  it "can properly preform complex tuple destructuring" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
    uint index;
    uint xr;
    uint yr;
    function f() public pure returns (uint, bool, uint) {
        return (7, true, 2);
    }

    constructor() public {
        // Variables declared with type and assigned from the returned tuple,
        // not all elements have to be specified (but the number must match).
        (uint x, , uint y) = f();
        // Common trick to swap values -- does not work for non-value storage types.
        (x, y) = (y, x);
        // Components can be left out (also for variable declarations).
        (index, , ) = f(); // Sets the index to 7
        (xr, yr) = (x, y);
        return;
    }
}|]
    getFields ["index","xr", "yr"] `shouldReturn` [BInteger 7, BInteger 2, BInteger 7 ]

  it "can use the attributes of the block variable e.g. block.coinbase, block.timestamp, block.number, block.difficulty and block.gaslimit" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  uint blockNumber;
  account payable a1;
  uint timestamp;
  uint gaslimit;
  uint diff;
  constructor() public {
    blockNumber = block.number;
    a1 = block.coinbase;
    timestamp = block.timestamp;
    gaslimit = block.gaslimit;
    diff = block.difficulty;
    return;        
  }
}|]
    getFields ["blockNumber", "a1", "timestamp", "gaslimit", "diff"] `shouldReturn` [BInteger 8033, BDefault, BInteger 16384, BInteger 1000000, BInteger 900]

  it "can use the builtin addmod function" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
    uint x;
    constructor() public returns (uint) {
        x = addmod(8, 2, 3);
    }
}|]
    getFields ["x"] `shouldReturn` [BInteger 1]

  it "can use the builtin mulmod function" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
    uint x;
    constructor() public returns (uint) {
        x = mulmod(7, 2, 3);
    }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2]

  it "can set values in a mapping that's a member of a struct" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  struct Data {
    mapping(uint => bool) flags;
  }
  function a() public returns (bool) {
    Data d;
    d.flags[1] = true;
    return d.flags[1];
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 1)

  it "can set values in a mapping that's a local variable" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  function a() public returns (bool) {
    mapping(int => bool) flags;
    flags[1] = true;
    return flags[1];
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 1)

  it "can set values in a mapping that's a contract variable" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  mapping(int => bool) flags;
  function a() public returns (bool) {
    flags[1] = true;
    return flags[1];
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 1)

  it "can use string.concat(x,y) to concatenate any amount of strings" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  function a() public {
    string x = "hello";
    string y = "world";
    string z = " and friends";
    string s = string.concat(x, y);
    string w = string.concat(x, y, z);
    assert(s == "helloworld");
    assert(w == "helloworld and friends");
  }
}|] 

  it "can use the builtin keccak256 function with any amount of string arguments" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  function a() public returns (bytes32) {
    return keccak256("hello", "world");
  }
}|] `shouldReturn` Just "\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL \NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL1\195\186&\195\155|\194\168^\194\173\&9\194\146\SYN\195\167\195\134\&1k\195\133\SO\195\146C\194\147\195\131\DC2+X'5\195\167\195\179\194\176\195\185\ESC\194\147\195\176"

  it "cant use  a commented pragma" . runTest $ do
    runCall "a" "()" [r|
//pragma solidvm 3.2;
contract qq {
  function a() public returns (string) {
    return 2;
  }
}|] `shouldReturn` Just (SB.toShort $ B.replicate 31 0x0 <> B.singleton 2)

  it "can declare a custom modifier and use it in a contract" $ (runTest $ do
    (runBS [r|
pragma solidvm 3.2;
contract qq {
  modifier myModifier() {  // line 4
    require(false);
    _;

  }

  constructor() public myModifier returns (bool) {
    return true;
  }
}|])) `shouldThrow` failedRequirementNoMsg


  it "can declare a custom modifier and use it in a contract" $ (runTest $ do
    (runBS [r|
pragma solidvm 3.2;
contract qq {
  modifier myModifier() {  // line 4
    return 7;
    require(false);
    _;

  }

  constructor() public myModifier returns (bool) {
    return true;
  }
}|])) `shouldThrow` anyModifierError



  it "can use a modifier as part of a function" . runTest $ do
    runCall "decrement" "(1)" [r|
pragma solidvm 3.2;
contract qq {
    // We will use these variables to demonstrate how to use
    // modifiers.
    address public host;
    uint public x = 10;
    bool public locked;

    constructor() public {
        // Set the transaction sender as the Host of the contract.
        host = msg.sender;
    }

    modifier onlyHost() {
        require(msg.sender == host, "Not Host");
        
        _;
    }

   //Inputs can be passed to a modiier
    modifier validAddress(address _addr) {
        require(_addr != address(0), "Not valid address");
        _;
    }

    function changeHost(address _newHost) public onlyHost {
        host = _newHost;
    }

    // Modifiers can be called before and / or after a function.
    // This modifier prevents a function from being called while
    // it is still executing.
    modifier noReentrancy() {
        require(!locked, "No reentrancy");

        locked = true;
        _;
        locked = false;
    }

    function decrement(uint i) public noReentrancy returns (uint) {
        x -= i;

        if (i > 1) {
          decrement(i - 1);
        }
    }

}|] `shouldReturn` Nothing




  it "can use a modifier and require something after and before the function is run" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint x = 3;
  modifier myModifier() {  
    require(x == 3 , string.concat('x is not 3 : ', string(x)));
    x = 4;
    _;
    require(x == 5 , 'x is not 5');
  }

  constructor() public myModifier {
    x = 5;
    return;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 5]

  it "can use a modifier multiple modifiers and they occur in order" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  uint x = 3;
  modifier myModifier() {  
    require(x == 3 , string.concat('x is not 3 : ', string(x)));
    x = 4;
    _;
    require(x == 5 , 'x is not 5');
  }

  modifier anotherModifier() {
    require(x == 4 , string.concat('x is not 4 : ', string(x)));
    _;
    require(x == 5 , 'x is not 5');
  }

  constructor() public myModifier anotherModifier {
    x = x + 1;
    return;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 5]


  it "can use a modifier  that takes arguments as part of a function" . runTest $ do
    runCall "a" "()" [r|
pragma solidvm 3.2;
contract qq {
  uint x = 3;
  modifier myModifier(uint _x) {  
    require(_x == 3 , string.concat('x is not 3 : ', string(_x)));
    x = 4;
    _;
    require(x == 5 , 'x is not 5');
  }

  function a() public myModifier(3) {
    x = 5;
    return;
  }
}|] `shouldReturn` Nothing

{-

  it "can use a modifier that takes in arguments" . runTest $ do
    runBS [r|
contract qq {
  uint x = 3;
  modifier myModifier(uint _x) {  
    require(_x == 3 , string.concat('x is not 3 : ', string(_x)));
    x = 4;
    _;
    require(x == 5 , 'x is not 5');
  }

  constructor() public myModifier(3) {
    x = 5;
    return;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 5]

-}

  it "cannot allow negative block number" $ runTest (do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  constructor() public returns (bytes32) {
    return blockhash(-1);
  }
}|]) `shouldThrow` anyInvalidArgumentsError

  it "can use builtin sha256 function" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bytes32 hsh;
  constructor() public {
    string username = "uname";
    hsh = sha256(username);
  }
}
|]
    getFields ["hsh"] `shouldReturn` [BString $ word256ToBytes 0x5C0BE87ED7434D69005F8BBD84CAD8AE6ABFD49121B4AAEEB4C1F4A2E2987711]
    
  it "can use the builtin ripemd160 function" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq {
  bytes20 hsh;
  constructor() public {
    string username = "uname";
    hsh = ripemd160(username);
  }
}|]
    getFields ["hsh"] `shouldReturn` [BString $ B.pack $ word160ToBytes 0x63f4a6f6005b0ded8c5fc7e62ddf2550e9320410]

  it "can use the selfdestruct function" . runTest $ do
    let contract = [r|
pragma solidvm 3.2;
contract qq {
  account contract';
  account payable contractPay;
  account owner;
  account payable ownerPay;

  constructor() public {
    contract' = account(this);
    contractPay = payable(contract');
    owner = account(0xdeadbeef);
    ownerPay = payable(owner);
  }

  function selfDestructThis() internal {
    selfdestruct(ownerPay);
  } 
}|]
    runBS contract
    -- Get the contract's accounts
    [ BAccount contract', BAccount owner] <- getFields ["contract'", "owner"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing contract') (\as -> pure $ as { addressStateBalance = 14 })
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing owner) (\bs -> pure $ bs { addressStateBalance = 10 })
    -- Check return of balance
    void $ call2 "selfDestructThis" "()" (namedAccountToAccount Nothing contract') 
    getFields ["contract'", "contractPay", "owner", "ownerPay"] `shouldReturn` 
      [ BDefault
      , BDefault
      , BDefault
      , BDefault
      ]
  
  it "throw an error when the 'account' reserved word is for a variable name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract A {
  uint account;
}|]) `shouldThrow` anyReservedWordError

  it "throw an error when the 'account' reserved word is for a contract name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract account {
  uint a;
}|]) `shouldThrow` anyReservedWordError

  it "throw an error when the 'account' reserved word is used for a function name." $ runTest (do
      runBS [r|
pragma solidvm 3.2;
contract A {
  function account() {
  }
}|]) `shouldThrow` anyReservedWordError
  it "can use 1e_ notation to get a number" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  uint mynum;
  constructor() public {
    mynum = 1e12;
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 1000000000000]

  it "can use ether number unit suffixes" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  uint weiUnit;
  uint szaboUnit;
  uint finneyUnit;
  uint etherUnit;
  constructor() public {
    weiUnit = 2 wei;
    szaboUnit = 2 szabo;
    finneyUnit = 2 finney;
    etherUnit = 2 ether;
  }
}|]
    getFields ["weiUnit", "szaboUnit", "finneyUnit", "etherUnit"] `shouldReturn` [BInteger 2, BInteger 2000000000000, BInteger 2000000000000000, BInteger 2000000000000000000]

  it "can use a try catch statment to catch a divide by zero error the SolidVM Way (trademark pending)" . runTest $ do
    runBS [r|
pragma solidvm 3.2;
contract qq{
  uint mynum = 5;
  constructor() public {
    try {
      mynum = 1 / 0;
    } catch DivideByZero {
      mynum = 3;
    }
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 3]

  it "can use a try catch statment to catch a divide by zero error the Solidity Way (trademark very much in effect)" . runTest $ do
    runBS [r| 
pragma solidvm 3.2;
contract Divisor {
  function doTheDivide() public returns (uint) {
    return (1 / 0);
  }
}

contract qq {
  uint myNum = 5;
  uint otherNum = 7;
  uint errorCount = 0;
  constructor() public returns (uint,bool) {
    Divisor d =  new Divisor();
    try d.doTheDivide() returns (uint v) {
          return (v, true);
        } catch Error(string memory amsg) { 
            // This is executed in case
            // revert was called inside getData
            // and a reason string was provided.
            errorCount++;
            return (0, false);
        } catch Panic(uint errCode) {
            // This is executed in case of a panic,
            // i.e. a serious error like division by zero
            // or overflow. The error code can be used
            // to determine the kind of error.
            errorCount++;
            myNum = 3;
            otherNum = errCode;
            return (0, false);
        } catch (bytes bigTest) {
            // This is executed in case revert() was used.
            errorCount++;
            return (0, false);
        }
  }
}|]
    getFields ["myNum", "otherNum", "errorCount"] `shouldReturn` [BInteger 3, BInteger 12, BInteger 1]

