{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module SolidVMSpec where

import BlockApps.Logging

import BlockApps.X509.Certificate
import BlockApps.X509.Keys as X509
import Blockchain.Bagger (processNewBestBlock)
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ExecResults
import Blockchain.Data.GenesisInfo
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as TXO
import Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.SQLDB
import Blockchain.GenesisBlock
import Blockchain.Sequencer.Event
import qualified Blockchain.SolidVM as SVM
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address as MA
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Blockchain.VMOptions ()
import Blockchain.Wiring ()
import Control.Concurrent
import Control.Concurrent.Async
import Control.Exception
import Control.Lens (view, (^.))
import Control.Monad
import Control.Monad.Change.Alter
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Crypto.Util (i2bs_unsized)
import qualified Data.Aeson as Ae
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.UTF8 as UTF8
import Data.Char
import qualified Data.List as L
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import qualified Data.Map.Ordered as OMap
import Data.Text.Encoding
import Data.Time.Clock.POSIX
import Executable.EVMFlags ()
import qualified LabeledError
import qualified Numeric (readHex, showHex)
import SolidVM.Model.SolidString
import SolidVM.Model.Storable as MS
import Test.Hspec (Selector, Spec, anyException, it, pendingWith, shouldThrow, xdescribe, xit)
import Test.Hspec.Expectations.Lifted
import Text.Printf
import Text.RawString.QQ

-- The newtype distinguishes uncaught SolidExceptions and
-- those that are returned in ExecResults
newtype HandledException = HE SolidException deriving (Show, Exception)

anyTODO :: Selector HandledException
anyTODO (HE TODO {}) = True
anyTODO _ = False

anyParseError :: Selector HandledException
anyParseError (HE ParseError {}) = True
anyParseError _ = False

anyRevertError :: Selector HandledException
anyRevertError (HE Blockchain.SolidVM.Exception.RevertError {}) = True
anyRevertError _ = False

anyUnknownFunc :: Selector HandledException
anyUnknownFunc (HE UnknownFunction {}) = True
anyUnknownFunc _ = False

anyUnknownVariableError :: Selector HandledException
anyUnknownVariableError (HE Blockchain.SolidVM.Exception.UnknownVariable {}) = True
anyUnknownVariableError _ = False

anyTypeError :: Selector HandledException
anyTypeError (HE Blockchain.SolidVM.Exception.TypeError {}) = True
anyTypeError _ = False

anyInvalidWriteError :: Selector HandledException
anyInvalidWriteError (HE Blockchain.SolidVM.Exception.InvalidWrite {}) = True
anyInvalidWriteError _ = False

anyInvalidArgumentsError :: Selector HandledException
anyInvalidArgumentsError (HE Blockchain.SolidVM.Exception.InvalidArguments {}) = True
anyInvalidArgumentsError _ = False

anyRequireError :: Selector HandledException
anyRequireError (HE Blockchain.SolidVM.Exception.Require {}) = True
anyRequireError _ = False

anyInternalError :: Selector HandledException
anyInternalError (HE Blockchain.SolidVM.Exception.InternalError {}) = True
anyInternalError _ = False

anyIndexOOBError :: Selector HandledException
anyIndexOOBError (HE Blockchain.SolidVM.Exception.IndexOutOfBounds {}) = True
anyIndexOOBError _ = False

anyMissingFieldError :: Selector HandledException
anyMissingFieldError (HE Blockchain.SolidVM.Exception.MissingField {}) = True
anyMissingFieldError _ = False

anyDivideByZeroError :: Selector HandledException
anyDivideByZeroError (HE Blockchain.SolidVM.Exception.DivideByZero {}) = True
anyDivideByZeroError _ = False

anyCustomError :: Selector HandledException
anyCustomError (HE Blockchain.SolidVM.Exception.CustomError {}) = True
anyCustomError _ = False

anyMissingTypeError :: Selector HandledException
anyMissingTypeError (HE Blockchain.SolidVM.Exception.MissingType {}) = True
anyMissingTypeError _ = False

anyInvalidCertError :: Selector HandledException
anyInvalidCertError (HE Blockchain.SolidVM.Exception.InvalidCertificate {}) = True
anyInvalidCertError _ = False

anyMalformedDataError :: Selector HandledException
anyMalformedDataError (HE Blockchain.SolidVM.Exception.MalformedData {}) = True
anyMalformedDataError _ = False

anyTooMuchGasError :: Selector HandledException
anyTooMuchGasError (HE Blockchain.SolidVM.Exception.TooMuchGas {}) = True
anyTooMuchGasError _ = False

anyTooManyCooks :: Selector HandledException
anyTooManyCooks (HE Blockchain.SolidVM.Exception.TooManyCooks {}) = True
anyTooManyCooks _ = False

anyPaymentError :: Selector HandledException
anyPaymentError (HE Blockchain.SolidVM.Exception.PaymentError {}) = True
anyPaymentError _ = False

anyModifierError :: Selector HandledException
anyModifierError (HE Blockchain.SolidVM.Exception.ModifierError {}) = True
anyModifierError _ = False

anyReservedWordError :: Selector HandledException
anyReservedWordError (HE Blockchain.SolidVM.Exception.ReservedWordError {}) = True
anyReservedWordError _ = False

anyDuplicateContractError :: Selector HandledException
anyDuplicateContractError (HE Blockchain.SolidVM.Exception.DuplicateContract {}) = True
anyDuplicateContractError _ = False

anyImmutableError :: Selector HandledException
anyImmutableError (HE Blockchain.SolidVM.Exception.ImmutableError {}) = True
anyImmutableError _ = False

specificTypeError :: String -> Selector HandledException
specificTypeError str (HE (Blockchain.SolidVM.Exception.TypeError _ mes)) = mes == str
specificTypeError _ _ = False 

failedToAttainRunTimCodeError :: Selector HandledException
failedToAttainRunTimCodeError (HE Blockchain.SolidVM.Exception.FailedToAttainRunTimCode {}) = True
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

proposer :: Address
proposer = Address 0xdeadbeef2

privateChainAcc :: Account
privateChainAcc = Account 0xdeadbeef (Just 0x776622233444)

rootAcc :: Account
rootAcc = Account (fromPublicKey X509.rootPubKey) Nothing

getCert :: X509Certificate
getCert = fromMaybe (error $ "no idea what's happening") $ either (const Nothing) Just . bsToCert . BC.pack $ myCertString

myCertString :: String
myCertString =
  unlines
    [ "-----BEGIN CERTIFICATE-----",
      "MIIBmzCCAT+gAwIBAgIRANb5NRwudlj4jP0tr0HzN1MwDAYIKoZIzj0EAwIFADBI",
      "MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF",
      "bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIzMDExODIyMzczMVoXDTI0MDEx",
      "ODIyMzczMVowVTEYMBYGA1UEAwwPQmVuamFtaW4gUHJldm9yMRIwEAYDVQQKDAlC",
      "bG9ja0FwcHMxFDASBgNVBAsMC0VuZ2luZWVyaW5nMQ8wDQYDVQQGDAZCb3NuaWEw",
      "VjAQBgcqhkjOPQIBBgUrgQQACgNCAASp0wOm0j7rUI5iND920n8W0Tr+xzvXUQAR",
      "awtjibPT2lWg6nXSHSg4U/NZrDJb57BJdlPQFOTlIrzz/T+beXFoMAwGCCqGSM49",
      "BAMCBQADSAAwRQIhAMkrvSxLDSBpxh9hQfSQNQOuYDB8kqO6nYJMPOb9XN1LAiAE",
      "oWRBt6vwZLbHy5GTLH1+QtzeePss8Mo7w7ed0C08vQ==",
      "-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----",
      "MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI",
      "MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF",
      "bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy",
      "MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU",
      "MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG",
      "BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs",
      "9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8",
      "R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n",
      "N8txKc8G9R27ZYAUuz15zF0=",
      "-----END CERTIFICATE-----"
    ]

origin :: Account
origin = Account (userAddress $ x509CertToCertInfoState getCert) Nothing

uploadAddress :: Account
uploadAddress = Account (getNewAddress_unsafe (sender ^. accountAddress) 0) Nothing

secondAddress :: Account
secondAddress = Account (getNewAddress_unsafe (sender ^. accountAddress) 1) Nothing

recursiveAddr :: Account
recursiveAddr = Account (getNewAddress_unsafe (uploadAddress ^. accountAddress) 0) Nothing

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

runTest :: ContextM a -> IO ()
runTest = runTestWithTimeout 5000000

generateGBlock :: (MonadLogger m, HasStateDB m) => GenesisInfo -> m (Block, OutputBlock)
generateGBlock gi = do
  sr <- A.lookupWithDefault (Proxy @StateRoot) (Nothing :: Maybe Word256)
  let bData =
        BlockHeader
          { parentHash = genesisInfoParentHash gi,
            ommersHash = genesisInfoUnclesHash gi,
            beneficiary = genesisInfoCoinbase gi,
            stateRoot = sr,
            transactionsRoot = genesisInfoTransactionRoot gi,
            receiptsRoot = genesisInfoReceiptsRoot gi,
            logsBloom = genesisInfoLogBloom gi,
            difficulty = genesisInfoDifficulty gi,
            number = genesisInfoNumber gi,
            gasLimit = genesisInfoGasLimit gi,
            gasUsed = genesisInfoGasUsed gi,
            timestamp = genesisInfoTimestamp gi,
            extraData = i2bs_unsized $ genesisInfoExtraData gi,
            mixHash = genesisInfoMixHash gi,
            nonce = genesisInfoNonce gi
          }
  return
    ( Block
        { blockBlockData = bData,
          blockReceiptTransactions = [],
          blockBlockUncles = []
        },
      OutputBlock
        { obOrigin = TXO.Direct,
          obBlockData = bData,
          obReceiptTransactions = [],
          obBlockUncles = []
        }
    )

writeBlockSummary :: HasBlockSummaryDB m => OutputBlock -> m ()
writeBlockSummary block =
  let sha = outputBlockHash block
      header = obBlockData block
      txCnt = fromIntegral $ length (obReceiptTransactions block)
   in putBSum sha (blockHeaderToBSum header txCnt)

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT Context m) where
  accessEnv = fmap (view $ dbs . sqldb) accessEnv

runTestWithTimeout :: Int -> ContextM a -> IO ()
runTestWithTimeout timeout f = do
  result <- race (threadDelay timeout) $
    runLoggingT . runTestContextM $ do
      let eAdmins = Ae.eitherDecodeStrict (BC.pack "[{\"orgName\":\"BlockApps\",\"orgUnit\":\"Engineering\",\"commonName\":\"Blockstanbul Admin\"}]") :: Either String [ChainMemberParsedSet]
          !admins = either error id eAdmins
          eVals = Ae.eitherDecodeStrict (BC.pack "[{\"orgName\":\"BlockApps\",\"orgUnit\":\"Engineering\",\"commonNames\":\"Test\"}]") :: Either String [ChainMemberParsedSet]
          !vals = either error id eVals
          gi = "{ \"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\", \"accountInfo\":[ [\"e1fd0d4a52b75a694de8b55528ad48e2e2cf7859\",1809251394333065553493296640760748560207343510400633813116524750123642650624] ], \"transactionRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\", \"extraData\":0, \"gasUsed\":0, \"gasLimit\":22517998136852480000000000000000, \"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\", \"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\", \"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\", \"number\":0, \"difficulty\":8192, \"timestamp\":\"1970-01-01T00:00:00.000Z\", \"coinbase\":\"00000000000000000000\", \"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\", \"nonce\":42 }"
          eInput = Ae.eitherDecodeStrict (BC.pack gi)
          !input = either error id eInput
          cert = getCert
          gi' = buildGenesisInfo [] [cert] vals admins input

      (blockCreated, outputBlock) <- generateGBlock gi'
      MP.initializeBlank
      setStateDBStateRoot Nothing $ stateRoot $ blockBlockData $ blockCreated
      writeBlockSummary outputBlock
      let genHash = rlpHash $ (blockCreated)
      bhr <- bootstrapChainDB genHash [(Nothing, (stateRoot $ blockBlockData $ blockCreated))]
      putContextBestBlockInfo $ ContextBestBlockInfo genHash (blockBlockData $ blockCreated) 0
      Mod.put (Mod.Proxy @BlockHashRoot) $ bhr
      processNewBestBlock genHash (blockBlockData $ blockCreated) [] -- bootstrap Bagger with genesis block
      withCurrentBlockHash genHash $ do
        let certKey addr = ((Account addr Nothing),) . encodeUtf8
            certRegistryKey = certKey (Address 0x509)
            rlpWrap = rlpSerialize . rlpEncode
            ua = userAddress $ x509CertToCertInfoState getCert
            certsub = fromJust $ getCertSubject cert
        insert (Proxy @RawStorageValue) (certRegistryKey . T.pack $ ".addressToCertMap<a:" <> formatAddressWithoutColor ua <> ">") ((rlpWrap $ BAccount $ NamedAccount (Address 0xdeadbeef) MainChain)) --(encodeUtf8 $ T.pack (formatAddressWithoutColor (Address 0xdeadbeef)))
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".certificateString") (rlpWrap $ BString $ BC.pack myCertString)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".userAddress") ((rlpWrap $ BAccount $ NamedAccount ua MainChain))
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".owner") (rlpWrap $ BAccount (NamedAccount ((fromJust . stringAddress) "509") UnspecifiedChain))
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".commonName") (rlpWrap . BString . BC.pack . subCommonName $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".country") (rlpWrap . BString . BC.pack . fromJust . subCountry $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".organization") (rlpWrap . BString . BC.pack . subOrg $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".organizationalUnit") (rlpWrap . BString . BC.pack . fromJust . subUnit $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".group") (rlpWrap . BString . BC.pack . fromJust . subUnit $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".publicKey") (rlpWrap . BString . pubToBytes . subPub $ certsub)
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".isValid") (rlpWrap (BBool True))
        insert (Proxy @RawStorageValue) (certKey (Address 0xdeadbeef) ".parent") ((rlpWrap $ BAccount $ NamedAccount (fromMaybe (Address 0x0) $ getParentUserAddress cert) MainChain))
        f
  case result of
    Left {} -> expectationFailure $ printf "test case timed out after %ds" (timeout `div` 1000000)
    Right {} -> return ()

runFile :: FilePath -> ContextM ()
runFile fp = void $ runBS =<< liftIO (readFile fp)

runFileArgs :: T.Text -> FilePath -> ContextM ()
runFileArgs args fp = void $ runArgs args =<< liftIO (readFile fp)

runBS :: String -> ContextM ()
runBS = void . runBS'

runBSBeef :: String -> ContextM ()
runBSBeef = void . runBSBeef'

runBS' :: String -> ContextM ExecResults
runBS' = runArgs "()"

runBSBeef' :: String -> ContextM ExecResults
runBSBeef' = runArgs "()"

rethrowEx :: ExecResults -> ContextM ()
rethrowEx ExecResults {erException = Just ex} = either (liftIO . throwIO . HE) (void . return) ex
rethrowEx _ = return ()

--Adds a contract to the 0xfeedbeef chain
runArgsWithSenderBeef :: Account -> T.Text -> String -> ContextM ExecResults
runArgsWithSenderBeef acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Just 0xfeedbeef
      metadata = Just $ M.fromList [("name", "qq"), ("args", args)]

  newAddress <- getNewAddress acc
  er <-
    SVM.create
      isTest
      isHomestead
      suicides
      blockData
      callDepth
      sender
      origin
      proposer
      value
      gasPrice
      availableGas
      newAddress
      code
      txHash
      chainId
      metadata
  rethrowEx er
  return er

--Adds contract to the "main chain"
runArgsWithSender :: Account -> T.Text -> String -> ContextM ExecResults
runArgsWithSender acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Nothing
      metadata = Just $ M.fromList [("name", "qq"), ("args", args)]
  
  insert (Proxy @BlockSummary) (unsafeCreateKeccak256FromWord256 0x0) (blockHeaderToBSum blockData 1)

  newAddress <- getNewAddress acc
  er <-
    SVM.create
      isTest
      isHomestead
      suicides
      blockData
      callDepth
      sender
      origin
      proposer
      value
      gasPrice
      availableGas
      newAddress
      code
      txHash
      chainId
      metadata
  rethrowEx er
  return er

runArgsWithOrigin :: Account -> Account -> T.Text -> String -> ContextM ExecResults
runArgsWithOrigin orig acc args bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0x776622233444
      chainId = Nothing
      metadata = Just $ M.fromList [("name", "qq"), ("args", args)]

  newAddress <- getNewAddress acc
  er <-
    SVM.create
      isTest
      isHomestead
      suicides
      blockData
      callDepth
      sender
      orig
      proposer
      value
      gasPrice
      availableGas
      newAddress
      code
      txHash
      chainId
      metadata
  rethrowEx er
  return er

runArgsWithCertificateRegistry :: String -> ContextM ExecResults
runArgsWithCertificateRegistry rawString =
  runArgsWithOrigin rootAcc sender "()" $
    [r|

contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    mapping(address => address) addressToCertMap;

    bool initialized;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);
    event CertificateRegistryInitialized();
    string rootCert;

    constructor() {
        require(account(this, "self").chainId == 0, "You must post this contract on the main chain!");

        initialized = false;
        rootCert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBIMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtFbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQyMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEUMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
        initializeCertificateRegistry(rootCert);
    }

    function initializeCertificateRegistry(string _rootCert) returns () {
        require(!initialized, "The CertificateRegistry has already been initialized!");

        // Create the Certificate record
        Certificate c = new Certificate(_rootCert);

        // Register the root certificates and emit event
        addressToCertMap[c.userAddress()] = address(c);
        emit CertificateRegistered(_rootCert);


        initialized = true;
        emit CertificateRegistryInitialized();



    }

    function registerCertificate(string newCertificateString) returns (address) {
        // Create the new Certificate record
        Certificate c = new Certificate(newCertificateString);
        addressToCertMap[c.userAddress()] = address(c);
        emit CertificateRegistered(newCertificateString);
        return c.userAddress();

    }

    function getUserCert(address _address) returns (Certificate) {
        return Certificate(addressToCertMap[account(_address)]);
    }

}|]
      ++ rawString

runArgs :: T.Text -> String -> ContextM ExecResults
runArgs = runArgsWithSender sender

runArgsBeef :: T.Text -> String -> ContextM ExecResults
runArgsBeef = runArgsWithSenderBeef sender

runCall :: T.Text -> T.Text -> String -> ContextM (Maybe String)
runCall funcName callArgs bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      isRCC = False
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0x234962
      chainId = Nothing
      createMetadata = Just $ M.fromList [("name", "qq"), ("args", "()")]
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  newAddress <- getNewAddress sender
  $logErrorS "runCall" "Beginning create"
  er1 <-
    SVM.create
      isTest
      isHomestead
      suicides
      blockData
      callDepth
      sender
      origin
      proposer
      value
      gasPrice
      availableGas
      newAddress
      code
      txHash
      chainId
      createMetadata
  $logErrorS "runCall" "Returned from create"
  rethrowEx er1
  $logErrorS "runCall" "Beginning call"
  er2 <-
    SVM.call
      isTest
      isHomestead
      noValueTransfer
      isRCC
      suicides
      blockData
      callDepth
      receiveAddress
      newAddress
      sender
      proposer
      value
      gasPrice
      theData
      availableGas
      origin
      txHash
      chainId
      callMetadata
  $logErrorS "runCall" "Returned from call"
  rethrowEx er2
  return $ erReturnVal er2

-- SolidVM returns String instead of ByteString, test it by using the new function runCall' instead of the function runCall
-- compare the returned value (but got) with expected value (expected) in the test case
runCall' :: T.Text -> T.Text -> String -> ContextM (Maybe String)
runCall' funcName callArgs bs = do
  let code = Code $ UTF8.fromString bs
      isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      isRCC = False
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0x234962
      chainId = Nothing
      createMetadata = Just $ M.fromList [("name", "qq"), ("args", "()")]
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  newAddress <- getNewAddress sender
  $logErrorS "runCall" "Beginning create"
  er1 <-
    SVM.create
      isTest
      isHomestead
      suicides
      blockData
      callDepth
      sender
      origin
      proposer
      value
      gasPrice
      availableGas
      newAddress
      code
      txHash
      chainId
      createMetadata
  $logErrorS "runCall" "Returned from create"
  rethrowEx er1
  $logErrorS "runCall" "Beginning call"
  er2 <-
    SVM.call
      isTest
      isHomestead
      noValueTransfer
      isRCC
      suicides
      blockData
      callDepth
      receiveAddress
      newAddress
      sender
      proposer
      value
      gasPrice
      theData
      availableGas
      origin
      txHash
      chainId
      callMetadata
  $logErrorS "runCall" "Returned from call"
  rethrowEx er2
  return $ erReturnVal er2

-- lastN' 32

lastN' :: Int -> [a] -> [a]
lastN' n xs = L.foldl' (const . drop 1) xs (drop n xs)

call2 :: T.Text -> T.Text -> Account -> ContextM (Maybe String)
call2 funcName callArgs contractAddress = do
  let isTest = error "TODO: isTest"
      isHomestead = error "TODO: isHomestead"
      isRCC = False
      suicides = error "TODO: suicides"
      blockData =
        BlockHeader
          { parentHash = unsafeCreateKeccak256FromWord256 0x0,
            ommersHash = unsafeCreateKeccak256FromWord256 0x0,
            beneficiary = emptyChainMember,
            stateRoot = "",
            transactionsRoot = "",
            receiptsRoot = "",
            logsBloom = "",
            difficulty = 900,
            number = 8033,
            gasLimit = 1000000,
            gasUsed = 10000,
            extraData = "",
            nonce = 22,
            mixHash = unsafeCreateKeccak256FromWord256 0x0,
            timestamp = posixSecondsToUTCTime 0x4000
          }
      callDepth = 0
      value = error "TODO: value"
      gasPrice = error "TODO: gasPrice"
      availableGas = Gas 99969480
      txHash = unsafeCreateKeccak256FromWord256 0xddba11
      chainId = Nothing
      noValueTransfer = error "TODO: noValueTransfer"
      receiveAddress = error "TODO: receiveAddress"
      theData = error "TODO: theData"
      callMetadata = Just $ M.fromList [("funcName", funcName), ("args", callArgs)]
  er <-
    SVM.call
      isTest
      isHomestead
      noValueTransfer
      isRCC
      suicides
      blockData
      callDepth
      receiveAddress
      contractAddress
      sender
      proposer
      value
      gasPrice
      theData
      availableGas
      origin
      txHash
      chainId
      callMetadata
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
  xdescribe "Ballot" $ do
    it "can be created" . runTest $ do
      runFileArgs [r|(["a","b","c"])|] "testdata/Ballot.sol"

  xdescribe "Create" $ do
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
      getAll
        [ [Field "nums", Field "length"],
          [Field "nums", ArrayIndex 0]
        ]
        `shouldReturn` [BDefault, BDefault]
      runFile "testdata/ArrayPush.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "nums", Field "length"],
          [Field "nums", ArrayIndex 0]
        ]
        `shouldReturn` [BInteger 1, BInteger 3]

    it "should be able to read an array" . runTest $ do
      checkStorage `shouldReturn` []
      runFile "testdata/ArrayRead.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 5) . length
      getAll
        [ [Field "xs", Field "length"],
          [Field "xs", ArrayIndex 0],
          [Field "xs", ArrayIndex 1],
          [Field "xs", ArrayIndex 2],
          [Field "y"],
          [Field "z"]
        ]
        `shouldReturn` [ BInteger 2,
                         BInteger 0x5577,
                         BInteger 0xffff,
                         BDefault,
                         BInteger 0x5577,
                         BInteger 0xffff
                       ]

    it "should be able to insert into a mapping" . runTest $ do
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingSet.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 3) . length
      getAll
        [ [Field "us"],
          [Field "us", MapIndex (INum 22)],
          [Field "us", MapIndex (INum 999999)],
          [Field "us", MapIndex (INum 10)]
        ]
        `shouldReturn` [BMappingSentinel, BInteger 4, BInteger 21, BDefault]

    it "should be able to read from a map" . runTest $ do
      liftIO $ pendingWith "deal with BMappingSentinel" --TODO- Jim
      runFile "testdata/MappingRead.sol"
      st <- checkStorage
      -- The z assignment doesn't count, as at is set to the empty string
      st `shouldSatisfy` (== 4) . length
      getAll
        [ [Field "xs"],
          [Field "xs", MapIndex (INum 400)],
          [Field "y"],
          [Field "z"]
        ]
        `shouldReturn` [BMappingSentinel, BInteger 343, BInteger 343, BDefault]

    it "should be able to set array length" . runTest $ do
      runFile "testdata/Length.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 1) . length
      getAll [[Field "xs", Field "length"]] `shouldReturn` [BInteger 24]

    it "should be able to read array length" . runTest $ do
      runFile "testdata/ReadLength.sol"
      st <- checkStorage
      st `shouldSatisfy` (== 2) . length
      getAll
        [ [Field "xs", Field "length"],
          [Field "y"]
        ]
        `shouldReturn` [BInteger 0x400, BInteger 0x400]

    it "can delete" . runTest $ do
      runFile "testdata/Delete.sol"
      getFields ["x"] `shouldReturn` [BDefault]

    it "can delete arrays" . runTest $ do
      runFile "testdata/DeleteArray.sol"
      getAll
        [ [Field "x", Field "length"],
          [Field "x", ArrayIndex 0],
          [Field "x", ArrayIndex 1],
          [Field "x", ArrayIndex 2]
        ]
        `shouldReturn` replicate 4 BDefault

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
      getFields ["buf1", "buf2", "hash1", "hash2"]
        `shouldReturn` [ BString (B.replicate 32 0xfe),
                         BString (BC.replicate 32 'x'),
                         BString (LabeledError.b16Decode "SolidVMSpec.hs" "59c3290d81fbdfe9ce1ffd3df2b61185e3089df0e3c49e0918e82a60acbed75a"),
                         BString (LabeledError.b16Decode "SolidVMSpec.hs" "5601c4475f2f6aa73d6a70a56f9c756f24d211a914cc7aff3fb80d2d8741c868")
                       ]

    it "can hash multiple arguments" . runTest $ do
      runBS
        [r|
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
      runBS
        [r|
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

      getAll
        [ [Field "x", Field "a"],
          [Field "x", Field "b"]
        ]
        `shouldReturn` [BInteger 900, BString "ok"]

    it "can directy initialize a struct" . runTest $ do
      runBS
        [r|
contract qq {
  struct X {
    int a;
    int b;
  }
  X x = X(3, 4);
}|]
      getAll
        [ [Field "x", Field "a"],
          [Field "x", Field "b"]
        ]
        `shouldReturn` [BInteger 3, BInteger 4]

    it "can push a struct" . runTest $ do
      runBS
        [r|
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
      getAll
        [ [Field "xs"],
          [Field "xs", Field "length"],
          [Field "xs", ArrayIndex 0, Field "a"],
          [Field "xs", ArrayIndex 0, Field "b"]
        ]
        `shouldReturn` [BDefault, BInteger 1, BInteger 88, BInteger 73]

    it "can explicitly push a struct" . runTest $ do
      runBS
        [r|
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
      getAll
        [ [Field "xs"],
          [Field "xs", Field "length"],
          [Field "xs", ArrayIndex 0, Field "a"],
          [Field "xs", ArrayIndex 0, Field "b"]
        ]
        `shouldReturn` [BDefault, BInteger 1, BInteger 9000, BInteger 3000]
    it "can post increment" . runTest $ do
      runBS
        [r|
contract qq {
  uint x = 400000000;
  uint y;
  constructor() {
    y = x++;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 400000001, BInteger 400000000]

    it "can pre increment" . runTest $ do
      runBS
        [r|
contract qq {
 uint x = 99;
 uint y = 17;
 constructor() {
   y = ++x;
  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 100]

    it "can post decrement" . runTest $ do
      runBS
        [r|
contract qq {
  uint x = 10;
  uint y;
  constructor() {
    y = x--;

  }
}|]
      getFields ["x", "y"] `shouldReturn` [BInteger 9, BInteger 10]

    it "can pre decrement" . runTest $ do
      runBS
        [r|
contract qq {
  uint x = 20;
  uint y;
  constructor() {
    y = --x;
  }
}|]
      getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 19, BInteger 19]

    it "can declare negative numbers" . runTest $ do
      runBS
        [r|
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
      runBS
        [r|
contract qq {
  constructor() {
    require(3 == 3, "Who is John Galt?");
  }
}|]

    it "can handle failed requirement with message" $
      runTest
        ( do
            runBS
              [r|
contract qq {
  constructor() {
    require(3 == 4, "Who is John Galt?");
  }
}|]
        )
        `shouldThrow` failedRequirementMsg "SString \"Who is John Galt?\""

    it "can handle failed requirement without message" $
      runTest
        ( do
            runBS
              [r|
contract qq {
  constructor() {
    require(3 == 4);
  }
}|]
        )
        `shouldThrow` failedRequirementNoMsg

    it "throw an error when there is an 'block_timestamp' variable name" $
      runTest
        ( do
            runBS
              [r|

contract qq {
   string block_timestamp;
   constructor()
   {
      block_timestamp = "hello";
   }
}|]
        )
        `shouldThrow` anyReservedWordError

    it "throw an error when there is an 'block_hash' variable name" $
      runTest
        ( do
            runBS
              [r|

contract qq {
   string block_hash;
   constructor()
   {
      block_hash = "hello";
   }
}|]
        )
        `shouldThrow` anyReservedWordError

    it "throw an error when there is an 'block_number' variable name" $
      runTest
        ( do
            runBS
              [r|

contract qq {
   string block_number;
   constructor()
   {
      block_number = "hello";
   }
}|]
        )
        `shouldThrow` anyReservedWordError

    it "throw an error when there is an 'address' variable name" $
      runTest
        ( do
            runBS
              [r|
contract qq {
   uint address;
}|]
        )
        `shouldThrow` anyParseError

    it "throw an error when there is an 'transaction_hash' variable name" $
      runTest
        ( do
            runBS
              [r|

contract qq {
   uint transaction_hash;
}|]
        )
        `shouldThrow` anyReservedWordError

    it "throw an error when there is an 'transaction_sender' variable name" $
      runTest
        ( do
            runBS
              [r|

contract qq {
   uint transaction_sender;
}|]
        )
        `shouldThrow` anyReservedWordError

    it "can multiline require" . runTest $ do
      runBS
        [r|
contract qq {
  constructor() public {
    require(
      3 == 3,
      "Who is John Galt????"
    );
  }
}|]

    it "can assert" . runTest $ do
      runBS
        [r|
contract qq {
  constructor() {
    assert(3 == 3);
  }
}|]

    it "can handle failed assertion" $
      runTest
        ( do
            runBS
              [r|
contract qq {
  constructor() {
    assert(3 == 4);
  }
}|]
        )
        `shouldThrow` failedAssertion

    it "can multiline assert" . runTest $ do
      runBS
        [r|
contract qq {
  constructor() public {
    assert(
      3 == 3
    );
  }
}|]

    it "can index into maps with bool" . runTest $ do
      runBS
        [r|
contract qq {
  mapping(bool => uint) bs;
  constructor() public {
    bs[true] = 0x87324;
    bs[false] = 0x000;
  }
}|]
      getAll
        [ [Field "bs", MapIndex $ IBool False],
          [Field "bs", MapIndex $ IBool True]
        ]
        `shouldReturn` [BDefault, BInteger 0x87324]

    it "should be able to store a contract" . runTest $ do
      runBS
        [r|
contract X {}
contract qq {
  X x = X(0x999999);
}|]
      getAll [[Field "x"]] `shouldReturn` [bContract "X" 0x999999]

    it "should be able to return the time from the header" . runTest $ do
      runBS
        [r|
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
      runBS
        [r|
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
      getAll [[Field "stored"]] `shouldReturn` [BString "alright."]

  it "can handle nested mappings" . runTest $ do
    runBS
      [r|
contract qq {
  mapping(uint => mapping(uint => string)) xs;
  constructor() {
    xs[10][20] = "ok";
  }
}|]
    getAll [[Field "xs", MapIndex (INum 10), MapIndex (INum 20)]] `shouldReturn` [BString "ok"]

  it "can handle deeply nested mappings" . runTest $ do
    runBS
      [r|
contract X {}
contract qq {
  mapping (bytes32 => mapping(bytes32 => mapping(bool => X))) public ruleSets;

  constructor() {
    bytes32 profileName = "profileName";
    bytes32 ruleName = "ruleName";
    ruleSets[profileName][ruleName][true] = X(address(0xdeadbeef));
  }
}|]
    getAll
      [ [ Field "ruleSets",
          MapIndex $ IText "profileName",
          MapIndex $ IText "ruleName",
          MapIndex $ IBool True
        ]
      ]
      `shouldReturn` [bContract "X" 0xdeadbeef]

  xit "can default construct local arrays" . runTest $ do
    runBS
      [r|
contract qq {
  constructor() {
    bytes32[] mnames;
  }
}|]
    checkStorage `shouldReturn` []

  it "can array index with uninitialized numbers" . runTest $ do
    runBS
      [r|
contract qq {
  uint[] xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [[Field "y"]] `shouldReturn` [BDefault]

  it "can map index with uninitialized numbers" . runTest $ do
    runBS
      [r|
contract qq {
  mapping(uint => uint) xs;
  uint y;
  constructor() public {
    uint idx;
    y = xs[idx];
  }
}|]
    getAll [[Field "y"]] `shouldReturn` [BDefault]

  it "can map index with uninitialized strings 3.2" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint x = 20;
  constructor() {
    uint l = x;
    l += 10;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 20]

  it "should remember modifications to locals" . runTest $ do
    runBS
      [r|
contract qq {
  uint x;
  constructor() {
    uint l = 99;
    l += 101;
    x = l;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 200]

  it "can assign a local struct" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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

    getAll
      [ [Field "ss", Field "length"],
        [Field "ss", ArrayIndex 0, Field "si"],
        [Field "z"]
      ]
      `shouldReturn` [BInteger 1, BInteger 222222, BInteger 222222]

  it "can detect nulls" . runTest $ do
    runBS
      [r|
contract qq {
  mapping(uint => uint) ns;
  bool found;
  constructor() {
    found = ns[0x0ddba11] != 0x0;
  }
}|]
    getFields ["found"] `shouldReturn` [BDefault]

  it "supports boolean equality" . runTest $ do
    runBS
      [r|
contract qq {
  bool x = true;
  bool y = true;
  constructor() {
    assert(x == y);
  }
}|]

  it "supports boolean inequality" . runTest $ do
    runBS
      [r|
contract qq {
  bool x = true;
  bool y = false;
  constructor() {
    assert(x != y);
  }
}|]

  it "supports contract equality" . runTest $ do
    runBS
      [r|
contract A {
}
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
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  address x;
  constructor() {
    x = msg.sender;
  }
}|]
    getFields ["x"] `shouldReturn` [bAccount sender]

  it "can read tx.origin" . runTest $ do
    runBS
      [r|
contract qq {
  address x;
  constructor() {
    x = tx.origin;
  }
}|]
    getFields ["x"] `shouldReturn` [bAccount origin]

  it "can infer types" . runTest $ do
    runBS
      [r|
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

  it "can throw exception if omitted parameter name and types are different" $
    runTest
      ( do
          runBS
            [r|
contract qq {
  uint x = 0;

  constructor() {
    x = f(6,5);
  }
  function f(string, uint) public returns (uint) {
    return 7;
  }
}|]
      )
      `shouldThrow` anyException

  it "can handle omitted parameter names with correct types" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    void $
      runArgs
        "(0x6662346)"
        [r|
contract qq {
  address target;
  constructor(address _target) public {
    target = _target;
  }
}|]
    getFields ["target"] `shouldReturn` [bAddress 0x6662346]

  it "can create a reference to a map value" . runTest $ do
    runBS
      [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("1");
  }
}|]
    getAll
      [ [Field "ruleNames", MapIndex (IText "ok"), Field "length"],
        [Field "ruleNames", MapIndex (IText "ok"), ArrayIndex 0]
      ]
      `shouldReturn` [BInteger 1, BString "1"]

  it "can back assign a reference" . runTest $ do
    runBS
      [r|
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
    getAll
      [ [Field "src", Field "length"],
        [Field "src", ArrayIndex 0],
        [Field "src", ArrayIndex 1],
        [Field "dst", Field "length"],
        [Field "dst", ArrayIndex 0]
      ]
      `shouldReturn` [ BInteger 2,
                       BString "red",
                       BString "blue",
                       BInteger 1,
                       BString "red"
                     ]

  it "can back assign a map value reference" . runTest $ do
    runBS
      [r|
contract qq {
  mapping (bytes32 => bytes32[]) ruleNames;

  constructor() public {
    bytes32[] names = ruleNames["ok"];
    names.push("red");
    ruleNames["bad"] = names;
  }
}|]

  it "can continue in a for-loop" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == address(0xdeadbeef);
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
    runBS
      [r|
contract Auth {
  function check(address _to_check) public returns (bool) {
    return _to_check == address(0xdeadbeef);
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
    runBS
      [r|
contract Parent {
  uint public x = 3;
}

contract qq is Parent {
  uint y = 999;
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 3, BInteger 999]

  it "can call functions" . runTest $ do
    runCall'
      "inc"
      "()"
      [r|
contract qq {
  uint x = 99;
  function inc() {
    x++;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["x"] `shouldReturn` [BInteger 100]

  it "can call external getters by variable name" . runTest $ do
    runBS
      [r|
contract S {
  string public s;
  constructor() public {
    s = "Blockapps";
  }
}
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
    runBS
      [r|
contract X {}
contract qq {
  X x;
  constructor() public {
    x = X(address(0xdeadbeef));
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    getFields ["text", "notext", "zero", "nonempty", "empty"]
      `shouldReturn` [BString "ok", BDefault, BDefault, BDefault, BBool True]

  it "can treat integer literals as addresses" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS
      [r|
contract qq {
  address a = 0xdeadbeef;
}|]
    getFields ["a"] `shouldReturn` [bAddress 0xdeadbeef]

  it "can pass arrays by reference to functions" . runTest $ do
    runBS
      [r|
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
    getAll
      [ [Field "xs", Field "length"],
        [Field "xs", ArrayIndex 0],
        [Field "x"]
      ]
      `shouldReturn` [BInteger 1, BInteger 0x44444, BInteger 0x44444]

  it "can pass arrays by reference to other contracts" . runTest $ do
    runBS
      [r|
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
    getAll
      [ [Field "xs", Field "length"],
        [Field "xs", ArrayIndex 0],
        [Field "x"]
      ]
      `shouldReturn` [BInteger 1, BInteger 23145, BInteger 23146]

  it "can accept remote arrays" . runTest $ do
    runCall'
      "addHead"
      "([10, 17])"
      [r|
contract qq {
  uint x;
  function addHead(uint[] ts) public {
    x += ts[0];
  }
}|]
      `shouldReturn` Just "()"
    getFields ["x"] `shouldReturn` [BInteger 10]

  it "can push to memory arrays" . runTest $ do
    runCall'
      "pushMem"
      "([3, 5])"
      [r|
contract qq {
  uint x;
  function pushMem(uint[] memory ts) public {
    ts.push(7);
    uint[] cpy = ts;
    x = cpy[2];
  }
}|]
      `shouldReturn` Just "()"
    getFields ["x"] `shouldReturn` [BInteger 7]

  it "can store array literals" . runTest $ do
    runBS
      [r|
contract qq {
  uint[] xs = [10, 20, 90];
}|]
    getAll
      [ [Field "xs", Field "length"],
        [Field "xs", ArrayIndex 0],
        [Field "xs", ArrayIndex 1],
        [Field "xs", ArrayIndex 2]
      ]
      `shouldReturn` [BInteger 3, BInteger 10, BInteger 20, BInteger 90]

  it "can accept nested arrays" . runTest $ do
    runBS
      [r|
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
    getAll (map (Field "pairs" :) ([Field "length"] : subArrays))
      `shouldReturn` [ BInteger 3,
                       BInteger 2,
                       BBool True,
                       BDefault,
                       BInteger 2,
                       BDefault,
                       BDefault,
                       BInteger 2,
                       BBool True,
                       BBool True
                     ]

  it "can declare a local struct" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
contract X {}
contract Y {}

contract qq {
  X public x;
  constructor() public {
    Y y = Y(address(0x7733624642));
    x = X(address(y));
  }
}|]
    getFields ["x"] `shouldReturn` [bContract "X" 0x7733624642]

  it "can cast int to int" . runTest $ do
    runBS
      [r|
contract qq {
  uint x;
  constructor() public {
    uint y = 2347;
    x = uint(y);
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2347]

  it "can <op>=" . runTest $ do
    runBS
      [r|
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
    let qq =
          [r|
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
    let qq =
          [r|
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
  function b() public returns (uint) {
    return num + 1;
  }
}|]
    void $ runArgs "(0x0,99)" qq
    getFields ["x", "num"] `shouldReturn` [bContract "qq" 0x0, BInteger 99]

    void $ runArgs (T.pack $ printf "(0x%s,400)" $ show uploadAddress) qq
    getFields2 ["x", "num"] `shouldReturn` [bContract' "qq" uploadAddress, BInteger 400]

    call2 "a" "()" secondAddress `shouldReturn` Just "()"
    getFields2 ["x", "num"] `shouldReturn` [bContract' "qq" uploadAddress, BInteger 100]

  it "can locally return locals" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runCall'
      "f"
      "()"
      [r|
contract qq {
  function f() returns (uint) {
    uint k = 99;
    return k;
  }
}|]
      `shouldReturn` Just "(99)"

  it "can externally return tuples" . runTest $ do
    er <-
      runCall'
        "f"
        "()"
        [r|
contract qq {
  function f() returns (uint, uint) {
    uint k = 0x0123456789abcdef0123456789abcdef;
    return (k, k);
  }
}|]
    --let dec =  show $ Numeric.readHex "0123456789abcdef0123456789abcdef"

    let dec = case Numeric.readHex "0123456789abcdef0123456789abcdef" of
          [(n, "")] -> show (n :: Integer)
          _ -> error "Error parsing Hex: 0123456789abcdef0123456789abcdef"
        result = "(" ++ dec ++ "," ++ dec ++ ")"
    er `shouldBe` Just result

  it "can assign to tuples" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
contract qq {
   bytes32 x = 0x5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068;
}|]
    getFields ["x"]
      `shouldReturn` [BString "5816f723b08edfdb4148b98e7be9d2e8000bab79b78e4e1615865eb92b1d7068"]

  it "can convert bytes32toString" . runTest $ do
    liftIO $ pendingWith "I'm not sure if this is correct"
    runBS
      [r|
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
      }a ByteString of length n with x the value of every element. The follow
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
    getFields ["bs", "str"]
      `shouldReturn` [ BString "32324f4354323000000000000000000000000000000000000000000000000000",
                       BString "22OCT20"
                     ]

  xit "can read the length of new arrays" . runTest $ do
    runBS
      [r|
contract qq {
  uint public len;
  constructor() public {
    uint[] memory xs = new uint[](2);
    len = xs.length;
  }
}|]
    getFields ["len"] `shouldReturn` [BInteger 2]

  xit "can pass local arrays as arguments" . runTest $ do
    runBS
      [r|
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
    let ctract =
          [r|
contract BaseContainer {
  function contains(uint x) internal virtual returns (bool) {
    return x == 4;
  }
}

contract qq is BaseContainer {
  function contains(uint x) external override returns (bool) {
    return super.contains(x);
  }
}|]
    -- SolidVM returns String instead of ByteString, test it by using the new function runCall' instead of the decprecated function runCall
    runCall' "contains" "(10)" ctract
      `shouldReturn` Just "(false)"
    runCall' "contains" "(4)" ctract
      `shouldReturn` Just "(true)"

  it "selects the correct super with multiple parents" . runTest $ do
    runCall'
      "value"
      "()"
      [r|
contract A {
    function value() public virtual returns (uint) {
        return 0xa;
    }
}
contract B {
    function value() public virtual returns (uint) {
        return 0xb;
    }
}
contract qq is A, B {
    function value() public override(B) returns (uint) {
        return super.value();
    }
}|]
      `shouldReturn` Just ("(" ++ show (MA.parseHex "b") ++ ")")

  it "selects the correct super when parents are missing methods" . runTest $ do
    runCall'
      "value"
      "()"
      [r|
contract A {
  function value() public virtual returns (uint) {
    return 0xa;
  }
}
contract B {}
contract qq is A, B {
  function value() public override returns (uint) {
    return super.value();
  }
}|]
      `shouldReturn` Just ("(" ++ show (MA.parseHex "a") ++ ")")

  it "can determine super instance by function name" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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

  it "can use hexadecimal string literals" . runTest $ do
    runBS
      [r|
contract qq {
  string x;
  constructor() public {
    x = hex'AF32';
  }
}|]
    getFields ["x"] `shouldReturn` [BString "\194\175\&2"]

  it "can use hexadecimal string literals double quotes" . runTest $ do
    runBS
      [r|
contract qq {
  string x;
  constructor() public {
    x = hex"68656c6c6f";
  }
}|]
    getFields ["x"] `shouldReturn` [BString "hello"]

  it "should not allow an odd amount in a string literal" $
    runTest
      ( do
          runCall'
            "func"
            "()"
            [r|
contract qq {
  string x;
  function func() public returns (string) {
    x = hex"AF3";
  }
}|]
      )
      `shouldThrow` anyParseError

  it "parser can accept variable names without consuming hex" . runTest $ do
    runBS
      [r|
contract qq {
  string hexString;
  constructor() public {
    hexString = hex"1234";
  }
}|]
    getFields ["hexString"] `shouldReturn` [BString "\DC24"]

  xit "can return and used named returns" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
contract string_test {
  string public v;
  constructor() {
    v = "test string";
  }
  function getTrueAndThisDotV() returns (bool, string) {
    return (true, string_test(this).v());
  }
}
contract qq {
  bool test;
  constructor(){
    test = it_getsTrueAndThisDotV();
  }
  function it_getsTrueAndThisDotV() private returns (bool) { // fails
    string_test y = new string_test();
    (bool b, string v) = y.getTrueAndThisDotV();
    return b && v == "test string" && (false == (v != "test string"));
  }
}|]
    getFields ["test"] `shouldReturn` [BBool True]

  it "can initialize from constants" . runTest $ do
    runBS
      [r|
contract qq {
  uint constant c = 995;
  uint x = c;
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 995]

  xit "can assign from constants" . runTest $ do
    runBS
      [r|
contract qq {
  uint constant c = 2007;
  uint x;
  constructor() public {
    x = c;
  }
}|]
    getFields ["c", "x"] `shouldReturn` [BDefault, BInteger 2007]

  xit "can read parent constants" . runTest $ do
    runBS
      [r|
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

  xit "can get the length of a string" . runTest $ do
    runBS
      [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = s.length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  xit "can get the length of bytes" . runTest $ do
    runBS
      [r|
contract qq {
  uint strlen;
  constructor() public {
    string s = "hello, world";
    strlen = bytes(s).length;
  }
}|]
    getFields ["strlen"] `shouldReturn` [BInteger 12]

  it "can call bytes32toString on literals" . runTest $ do
    runBS
      [r|
contract qq {
  string s;
  constructor() public {
    bytes32 x = "Will the real ";
    s = Util.bytes32ToString(x);
  }
}|]
    getFields ["s"] `shouldReturn` [BString "Will the real "]

  it "can return an address" . runTest $ do
    --works for address type
    let want' = Numeric.showHex (sender ^. accountAddress) ""
        want = replicate (40 - length want') '0' ++ want' --etherum address has 40 bytes followed by 0x, short byte string has 32 bytes
    runCall'
      "a"
      "()"
      [r|
contract qq {
  function a() public returns (address) {
    return msg.sender;
  }
}|]
      `shouldReturn` Just ("(\"" ++ want ++ "\")")

  it "can return an enum" . runTest $ do
    runCall'
      "a"
      "()"
      [r|
contract qq {
  enum Letter { a, b, c }
  function a() public returns (Letter) {
    return Letter.c;
  }
}|]
      `shouldReturn` Just "(2)"

  it "will initialize contracts as such" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS
      [r|
contract X {}

contract qq {
  X x;
}|]
    getFields ["x"] `shouldReturn` [bContract "X" 0x0]

  it "will initialize fields of indirect constructions" . runTest $ do
    liftIO $ pendingWith "add static typing" --TODO- Jim
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  mapping(string => uint) assoc;
}|]
    getFields ["assoc"] `shouldReturn` [BMappingSentinel]

  it "can compare contracts to int literals" . runTest $ do
    runBS
      [r|
contract qq {
  bool eq;
  bool neq;
  constructor() public {
    qq q = qq(address(0));
    eq = q == qq(address(0x0));
    neq = q != qq(address(0x0));
  }
}|]
    getFields ["eq", "neq"] `shouldReturn` [BBool True, BDefault]

  it "can return a contract" . runTest $ do
    --works for address type
    let want' = Numeric.showHex (uploadAddress ^. accountAddress) ""
        want = replicate (40 - length want') '0' ++ want'
    runCall'
      "self"
      "()"
      [r|
contract qq {
  function self() public returns (qq) {
    return qq(this);
  }
}|]
      `shouldReturn` Just ("(\"" ++ want ++ "\")")

  it "merges actions for concurrent modifications" . runTest $ do
    xr <-
      runBS'
        [r|
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
    diffs
      `shouldBe` Just
        ( OMap.fromList
            [ ( uploadAddress,
                Action.SolidVMDiff $
                  M.singleton
                    ".s"
                    (rlpSerialize $ rlpEncode $ bContract' "Sub" recursiveAddr)
              ),
              ( recursiveAddr,
                Action.SolidVMDiff $
                  M.fromList
                    [ (".x", rlpSerialize $ rlpEncode $ BInteger 20),
                      (".y", rlpSerialize $ rlpEncode $ BInteger 80)
                    ]
              )
            ]
        )

  it "stores enum numbers" . runTest $ do
    runBS
      [r|
contract qq {
    enum E {A, B, C, D}
    E c = E.C;
}|]
    getFields ["c"] `shouldReturn` [BEnumVal "E" "C" 2]

  it "can cast ints to enums" . runTest $ do
    runCall'
      "f"
      "(1)"
      [r|
contract qq {
  enum E {A, B, C, D}
  E e;
  function f(E _e) {
    e = _e;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["e"] `shouldReturn` [BEnumVal "E" "B" 1]

  it "can compare ints to enums" . runTest $ do
    runCall'
      "f"
      "(1)"
      [r|
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
}|]
      `shouldReturn` Just "()"
    getFields ["is_a", "is_b", "is_c", "is_d"]
      `shouldReturn` [BDefault, BBool True, BDefault, BDefault]

  it "can return single strings" . runTest $ do
    runCall'
      "txt"
      "()"
      [r|
contract qq {
  function txt() public returns (string) {
    string ret = "Ticket ID already exists";
    return ret;
  }
}|]
      `shouldReturn` Just "(\"Ticket ID already exists\")"

  it "can return tuples of strings" . runTest $ do
    runCall'
      "txt"
      "()"
      [r|
contract qq {
  function txt() public returns (string, string, string) {
    return ("hey", "yo", "how are you?");
  }
}|]
      `shouldReturn` Just "(\"hey\",\"yo\",\"how are you?\")"

  it "can return tuples of mixed simple types and strings" . runTest $ do
    runCall'
      "txt"
      "()"
      [r|
contract qq {
  function txt() public returns (string, uint, string, uint) {
    return ("hey", 42, "yo", 100);
  }
}|]
      `shouldReturn` Just "(\"hey\",42,\"yo\",100)"

  xit "can return numeric bytes32" . runTest $ do
    runCall'
      "num"
      "()"
      [r|
contract qq {
  function num() public returns (bytes32) {
    bytes32 ret = bytes32(0x5469636b657420494420616c7265616479206578697374730000000000000000);
    return ret;
  }
}|]
      `shouldReturn` Just "(Ticket ID already exists)"

  it "can return state variables" . runTest $ do
    runCall'
      "getS"
      "()"
      [r|
contract qq {
  string s = "The mitochondria is the powerhouse of the cell";
  function getS() public returns (string) {
    return s;
  }
}|]
      `shouldReturn` Just "(\"The mitochondria is the powerhouse of the cell\")"

  it "can return state variables in tuples" . runTest $ do
    runCall'
      "getSAndB"
      "()"
      [r|
contract qq {
  string s = "The mitochondria is the powerhouse of the cell";
  function getSAndB() public returns (string, string) {
    return (s, s);
  }
}|]
      `shouldReturn` Just "(\"The mitochondria is the powerhouse of the cell\",\"The mitochondria is the powerhouse of the cell\")"

  it "can accept string arguments" . runTest $ do
    runCall
      "set"
      "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")"
      [r|
contract qq {
  string st;
  function set(string _st) public {
    st = _st;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["st"] `shouldReturn` [BString "deadbeef00000000000000000000000000000000000000000000000000000000"]

  it "can accept Unicode string arguments" . runTest $ do
    runCall
      "set"
      "(\"4.11 g CO₂ / t · nm\")"
      [r|
contract qq {
  string st;
  function set(string _st) public {
    st = _st;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["st"] `shouldReturn` [BString (UTF8.fromString "4.11 g CO₂ / t · nm")]

  it "can encode Unicode strings in Solidtiy source" . runTest $ do
    runBS
      [r|
contract qq {
  string st = "4.11 g CO₂ / t · nm";
}|]
    getFields ["st"] `shouldReturn` [BString (UTF8.fromString "4.11 g CO₂ / t · nm")]

  it "can accept bytes32 arguments" . runTest $ do
    runCall
      "set"
      "(\"deadbeef00000000000000000000000000000000000000000000000000000000\")"
      [r|
contract qq {
  bytes32 bs;
  function set(bytes32 _bs) public {
    bs = _bs;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["bs"] `shouldReturn` [BString "\xde\xad\xbe\xef"]

  it "should not compute remote arguments" $
    runTest
      ( do
          runCall
            "set"
            "(3 + block.timestamp)"
            [r|
contract qq {
  uint n;
  function set(uint _n) public {
    n = _n;
  }
}|]
      )
      `shouldThrow` anyParseError

  it "can call boolean arguments" . runTest $ do
    runCall
      "set"
      "(true,false)"
      [r|
contract qq {
  bool a;
  bool b;
  function set(bool _a, bool _b) public {
    a = _a;
    b = _b;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["a", "b"] `shouldReturn` [BBool True, BDefault]

  it "sets the origin correctly" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    getFields ["direct_set", "local_call", "remote_call"]
      `shouldReturn` [bAccount sender, bAccount sender, bAccount uploadAddress]

  it "can set owner from management contract" . runTest $ do
    runBS
      [r|
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
    getSolidStorageKeyVal' recursiveAddr (MS.singleton "owner")
      `shouldReturn` bAccount uploadAddress

  it "can cast from address" . runTest $ do
    runBS
      [r|
contract qq {
  address a;
  constructor() public {
    a = address(74);
  }
}|]
    getFields ["a"] `shouldReturn` [bAddress 74]

  it "can have a for loop with no fields" . runTest $ do
    liftIO $ pendingWith "re-fix loops"
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint i;
  constructor() public {
    while (i < 8) {
      i++;
    }
  }
}|]
    getFields ["i"] `shouldReturn` [BInteger 8]

  it "can accept modifiers" $
    runTest
      ( do
          runBS
            [r|
  contract qq {
    modifier m() {
       _;
      }
}|]
      )
      `shouldReturn` ()

  it "catches parse errors" $ (runTest $ runBS [r| contract { |]) `shouldThrow` anyParseError

  it "catches arg parse errors" $
    ( runTest $ do
        runCall
          "f"
          "("
          [r|
contract qq {
  function f() public {}
}|]
    )
      `shouldThrow` anyParseError

  it "throw an error when the 'account' reserved word is for a variable name." $
    runTest
      ( do
          runBS
            [r|
contract A {
  uint account;
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "throw an error when the 'account' reserved word is for a contract name." $
    runTest
      ( do
          runBS
            [r|
contract account {
  uint a;
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "throw an error when the 'account' reserved word is used for a function name." $
    runTest
      ( do
          runBS
            [r|
contract A {
  function account() {
  }
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "catches missing function errors" $
    (runTest $ runCall "f" "()" [r|contract qq {}|]) `shouldThrow` anyUnknownFunc

  it "can cast to int" . runTest $ do
    runBS
      [r|
contract qq {
  int z;
  constructor() public {
    z = int(123456);
  }
}|]
    getFields ["z"] `shouldReturn` [BInteger 123456]

  it "can create storage references to structs" . runTest $ do
    runBS
      [r|
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
    getAll
      [ [Field "noms", Field "length"],
        [Field "noms", ArrayIndex 0, Field "id"],
        [Field "noms", ArrayIndex 0, Field "nomType"]
      ]
      `shouldReturn` [BInteger 1, BString "239847", BInteger 13]

  it "can create memory copies of structs" . runTest $ do
    liftIO $ pendingWith "add the memory keyword" --TODO- Jim
    runBS
      [r|
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
    getAll
      [ [Field "noms", Field "length"],
        [Field "noms", ArrayIndex 0, Field "id"],
        [Field "noms", ArrayIndex 0, Field "nomType"],
        [Field "newType"]
      ]
      `shouldReturn` [BInteger 1, BString "ok", BInteger 41, BInteger 92]

  it "can multiply return" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint x;
  constructor() public {
    var (z) = 247;
    x = z;
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 247]

  it "doesn't need var for variables in scope" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint x;
  constructor() public {
    string txt = "hello, world";
    x = bytes(txt)[3];
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 0x6c]

  it "can increment array members" . runTest $ do
    runBS
      [r|
contract qq {
    uint[] xs = [1,1,3];
    constructor() public {
        xs[1]++;
    }
}|]
    getAll
      [ [Field "xs", Field "length"],
        [Field "xs", ArrayIndex 0],
        [Field "xs", ArrayIndex 1],
        [Field "xs", ArrayIndex 2]
      ]
      `shouldReturn` [BInteger 3, BInteger 1, BInteger 2, BInteger 3]

  it "can reference characters" . runTest $ do
    liftIO $ pendingWith "TODO: something"
    runBS
      [r|
contract qq {
    string public xs = "ok";
    constructor() public {
      bytes(xs)[0] = 't';
      bytes(xs)[1] = 'y';
    }
}|]
    getFields ["xs"] `shouldReturn` [BString "ty"]

  xit "can parse named arguments" . runTest $ do
    runBS
      [r|
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

  xit "can call named argument constructors" . runTest $ do
    runBS
      [r|
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

  xit "can cast a struct from named arguments" . runTest $ do
    runBS
      [r|
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
    getAll
      [ [Field "s", Field "x"],
        [Field "s", Field "y"],
        [Field "s", Field "z"]
      ]
      `shouldReturn` [BInteger 33, BInteger 87, BString "goodbye"]

  xit "should be able to adjust arrayed structs" . runTest $ do
    runBS
      [r|
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
    getAll [[Field "xs", ArrayIndex 0, Field "x"]] `shouldReturn` [BInteger 110]

  xit "can resolve variables for named arguments" . runTest $ do
    void $
      runArgs
        "(\"stref\")"
        [r|
contract qq {
  struct X {
    string n;
  }
  X[] public names;
  constructor(string input_name) public {
    names.push(X({n: input_name}));
  }
}|]
    getAll [[Field "names", ArrayIndex 0, Field "n"]] `shouldReturn` [BString "stref"]

  it "can declare types for a tuple" . runTest $ do
    void $
      runBS
        [r|
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

  xit "can create new bytes" . runTest $ do
    void $
      runBS
        [r|
contract qq {
  bytes xs;
  constructor() public {
    xs = new bytes(3);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "\x00\x00\x00"]

  xit "overrides addressToAsciiString" . runTest $ do
    void $
      runBS
        [r|
contract qq {
  string xs;
  constructor() public {
    xs = addressToAsciiString(this);
  }
}|]
    getFields ["xs"] `shouldReturn` [BString "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe"]

  it "can cast bytes32 to int" . runTest $ do
    void $
      runBS
        [r|
contract qq {
  uint public x;
  constructor() public {
    x = uint(bytes(0x1234));
  }
}|]
    getFields ["x"] `shouldReturn` [BInteger 4660]

  xit "can store nested structs" . runTest $ do
    void $
      runBS
        [r|
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
    void $
      runBS
        [r|
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
    void $
      runBS
        [r|
contract Bite_Test {
    bytes public b;
    function set(bytes _b) public {
        b = _b;
    }
}
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

  it "rejects member access on primitives" $
    ( runTest
        ( runBS
            [r|
contract qq {
  uint x = 0;
  uint y = x.mem;
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "rejects index access on primitives" $
    ( runTest
        ( runBS
            [r|
contract qq {
  uint x = 0;
  uint y = x[1];
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "can emit events" . runTest $ do
    runBS
      [r|
contract qq {
  event x(uint v);
  constructor() {
    emit x(5);
  }
}|]

  it "can emit inherited events" . runTest $ do
    runBS
      [r|
contract parent {
  event x(uint v);
}

contract qq is parent {
  constructor() {
    emit x(6);
  }
}|]

  it "can assign directly to index of an array" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  mapping(bool => uint) bs;
  uint x;

  constructor() {
    bs[true] = 42;
    x = bs[true];
  }

}|]
    getFields ["x"] `shouldReturn` [BInteger 42]

  it "throws array index out of bounds exception" $
    ( runTest
        ( runBS
            [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[5];
   }
}|]
        )
    )
      `shouldThrow` anyIndexOOBError

  it "type checks the index value in array index access" $
    ( runTest
        ( runBS
            [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[true];
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "type checks the index value in array index assignment" $
    ( runTest
        ( runBS
            [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      arr[true] = 2112;
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "rejects empty index value on array index access" $
    ( runTest
        ( runBS
            [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      x = arr[];
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "rejects empty index value on mapping index access" $
    ( runTest
        ( runBS
            [r|
contract qq {
   mapping(bool => uint) bs;
   uint x;

   constructor()
   {
      x = bs[];
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "rejects empty index value on array index assignment" $
    ( runTest
        ( runBS
            [r|
contract qq {
   uint x;

   constructor()
   {
      uint[] arr = [42, 2020];
      arr[] = 2112;
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "rejects empty index value on mapping index assignment" $
    ( runTest
        ( runBS
            [r|
contract qq {
   mapping(bool => uint) bs;
   uint x;

   constructor()
   {
      bs[] = 42;
   }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "supports while loops" . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint x = 0;
  uint magic = 42;
  uint z = 0;

  constructor() {
    if (magic > 100 && ++x > 100)
    {
      z++;
    }
    z++;
  }

}|]
    getFields ["x"] `shouldReturn` [BDefault]

  it "can handle all expr combinations for logical OR clause " . runTest $ do
    runBS
      [r|
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
    runBS
      [r|
contract qq {
  uint x = 0;
  uint magic = 42;
  uint z = 0;

  constructor() {
    if (magic == 42 || ++x > 100)
    {
      z++;
    }
    z++;
  }

}|]
    getFields ["x"] `shouldReturn` [BDefault]

  it "rejects declared but undefined constructor" $
    ( runTest
        ( runBS
            [r|
contract qq {
   constructor();
}|]
        )
    )
      `shouldThrow` anyMissingFieldError

  it "rejects declared but undefined function" $
    ( runTest
        ( runBS
            [r|
contract qq {
   function f();

   constructor()
   {
      f();
   }
}|]
        )
    )
      `shouldThrow` anyMissingFieldError

  it "should accept multiple named return values" . runTest $ do
    runBS
      [r|
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
    getFields ["x", "y", "z"] `shouldReturn` [BInteger 123, BString "456", bAddress 0x789]

  it "catches division by zero error" $
    ( runTest
        ( runBS
            [r|
contract qq {

   uint x = 42;
   uint y = 0;
   uint z;

   constructor()
   {
      z = 42/0;
   }
}|]
        )
    )
      `shouldThrow` anyDivideByZeroError

  it "supports ternary operations" . runTest $ do
    runBS
      [r|
contract qq {

  uint x;
  uint y;

  constructor() {
    x = true == true ? 100 : 42;
    y = true == false ? 100 : 42;

  }
}|]
    getFields ["x", "y"] `shouldReturn` [BInteger 100, BInteger 42]

  it "rejects illegal enum access" $
    ( runTest
        ( runBS
            [r|
contract qq {

  enum Role { ADMIN, USER }
  uint[] perms;

  constructor() {
    perms[uint(Role.ADMIN)] = 10;
    perms[uint(Role.OTHER)] = 100;
  }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "can concatenate strings" . runTest $ do
    runCall'
      "concat"
      "(\"Hello\",\" World!\")"
      [r|
contract qq {
  string c;
  function concat(string a, string b) public {
    c = a + b;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["c"] `shouldReturn` [BString "Hello World!"]

  it "can append to a string" . runTest $ do
    runCall'
      "append"
      "(\" World!\")"
      [r|
contract qq {
  string a = "Hello";
  function append(string b) public {
    a += b;
  }
}|]
      `shouldReturn` Just "()"
    getFields ["a"] `shouldReturn` [BString "Hello World!"]

  it "can cast accounts and addresses to string" . runTest $ do
    runBS
      [r|
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
    getFields ["ces", "cms", "cus", "ds"]
      `shouldReturn` [ BString "00000000000000000000000000000000deadbeef:00000000000000000000000000000000000000000000000000000000feedbeef",
                       BString "00000000000000000000000000000000deadbeef:main",
                       BString "00000000000000000000000000000000deadbeef",
                       BString "00000000000000000000000000000000deadbeef"
                     ]

  it "can cast ints to string" . runTest $ do
    runBS
      [r|
contract qq {
  string p;
  constructor() public {
    p = string(1234567890);
  }
}|]
    getFields ["p"]
      `shouldReturn` [ BString "1234567890"
                     ]

  it "can cast bools to string" . runTest $ do
    runBS
      [r|
contract qq {
  string t;
  string f;
  constructor() public {
    t = string(true);
    f = string(false);
  }
}|]
    getFields ["t", "f"]
      `shouldReturn` [ BString "true",
                       BString "false"
                     ]

  it "can cast strings to accounts and addresses" . runTest $ do
    runBS
      [r|
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
    getFields ["sce", "scm", "scu", "sde", "sdm", "sdu"]
      `shouldReturn` [ BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedbeef)),
                       BAccount (NamedAccount 0xdeadbeef MainChain),
                       BAccount (NamedAccount 0xdeadbeef UnspecifiedChain),
                       BAccount (NamedAccount 0xdeadbeef UnspecifiedChain),
                       BAccount (NamedAccount 0xdeadbeef UnspecifiedChain),
                       BAccount (NamedAccount 0xdeadbeef UnspecifiedChain)
                     ]

  it "can cast strings to chainIds" . runTest $ do
    runBS
      [r|
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
    getFields ["sce", "scm", "scu"]
      `shouldReturn` [ BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedbeef)),
                       BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xfeedb33f)),
                       BAccount (NamedAccount 0xdeadbeef (ExplicitChain 0xf33dbeef))
                     ]

  it "can cast strings to bool" . runTest $ do
    runBS
      [r|
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
    getFields ["control", "t", "f"]
      `shouldReturn` [ BBool True,
                       BBool True,
                       BDefault
                     ]

  it "will not transfer when there is not anything to transfer between account" . runTest $ do
    runBS
      [r|
contract qq{
  account a;
  account payable aPay;
  uint bal;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function myTransfer() external payable
    returns (uint){
      aPay.transfer(13);
      bal = aPay.balance;
      return bal;
    }
}|]
    -- Get the contract's account
    [BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a)
    getFields ["bal"] `shouldReturn` [BInteger 13]

  it "will not over send (send when there is not enough gas)" . runTest $ do
    runBS
      [r|
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() external
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 7})
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields ["success", "bal"] `shouldReturn` [BDefault, BInteger 7]

  it "will allow for sending to self" . runTest $ do
    runBS
      [r|
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() external
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields ["success", "bal"] `shouldReturn` [BBool True, BInteger 13]

  it "will not send when there is not anything to send between account" . runTest $ do
    runBS
      [r|
contract qq{
  account a;
  account payable aPay;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
    aPay = payable(a);
  }
  function mySend() external
    returns (uint, bool){
      success = aPay.send(13);
      bal = aPay.balance;
      return (bal, success);
    }
}|]
    -- Get the contract's account
    [BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 0})
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields ["success", "bal"] `shouldReturn` [BDefault, BDefault]

  it "cannot send to a non account payable type" $
    runTest
      ( do
          runBS
            [r|
contract qq{
  account a;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
  }
  function mySend() external pure
    returns (uint, bool){
      success = a.send(13);
      bal = a.balance;
      return (bal, success);
    }
}|]
          -- Get the contract's account
          [BAccount a] <- getFields ["a"]
          -- Set the balance
          adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 26})
          -- Check return of balance
          (void $ call2 "mySend" "()" (namedAccountToAccount Nothing a))
      )
      `shouldThrow` anyTypeError

  it "cannot transfer for non account payable types" $
    runTest
      ( do
          runBS
            [r|
contract qq{
  account a;
  uint bal;
  bool success;
  constructor() public {
    a = account(this);
  }
  function myTransfer() external pure
    returns (uint, bool){
      success = a.transfer(13);
      bal = a.balance;
      return (bal, success);
    }
}|]
          -- Get the contract's account
          [BAccount a] <- getFields ["a"]
          -- Set the balance
          adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 26})
          -- Check return of balance
          (void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a))
      )
      `shouldThrow` anyTypeError

  it "can handle a three account transfer (only transfer from `this` account into only one account, leaving the third account alone)" . runTest $ do
    runBS
      [r|
contract Test {
  constructor(){}
}
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
  function myTransfer() external payable
    returns (uint, uint, uint){
      bPay.transfer(13);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 14})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs {addressStateBalance = 13})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a)
    getFields ["bala", "balb", "balc"]
      `shouldReturn` [ BInteger 1,
                       BInteger 26,
                       BInteger 13
                     ]

  it "can handle a three account send (only send from `this` account into only one account, leaving the third account alone)" . runTest $ do
    runBS
      [r|
contract Test {
  constructor(){}
}
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
  function mySend() external
    returns (bool, uint, uint, uint){
      success = bPay.send(13);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (success, bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 14})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs {addressStateBalance = 13})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields ["success", "bala", "balb", "balc"] `shouldReturn` [BBool True, BInteger 1, BInteger 26, BInteger 13]

  it "cannot over transfer from an account." $
    runTest
      ( do
          runBS
            [r|
contract Test {
  constructor(){}
}
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
  function myTransfer() external payable
    returns (uint, uint, uint){
      bPay.transfer(1300);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
          -- Get the contract's accounts
          [BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
          -- Adjust the preset balances
          adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 14})
          adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs {addressStateBalance = 13})
          adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs {addressStateBalance = 13})
          -- Check return of balance
          (void $ call2 "myTransfer" "()" (namedAccountToAccount Nothing a))
      )
      `shouldThrow` anyPaymentError

  it "cannot over send from an account." . runTest $ do
    runBS
      [r|
contract Test {
  constructor(){}
}
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
  function mySend() external
    returns (uint, uint, uint){
      success = bPay.send(1300);
      bala = aPay.balance;
      balb = bPay.balance;
      balc = cPay.balance;
      return (bala, balb, balc);
    }
}|]
    -- Get the contract's accounts
    [BAccount a, BAccount b, BAccount c] <- getFields ["a", "b", "c"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 14})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing c) (\cs -> pure $ cs {addressStateBalance = 13})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "mySend" "()" (namedAccountToAccount Nothing a)
    getFields ["success", "bala", "balb", "balc"]
      `shouldReturn` [ BDefault,
                       BInteger 14,
                       BInteger 13,
                       BInteger 13
                     ]

  it "can get the chainId from the account type" . runTest $ do
    runBS
      [r|
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
    getFields ["cid1", "cid2", "cid3"]
      `shouldReturn` [ BInteger 0xfeedbeef,
                       BDefault,
                       BDefault
                     ]
  it "can get the chainId directly from the account constructor" . runTest $ do
    runBS
      [r|
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
    getFields ["a1", "a2", "a3", "a4", "a5"]
      `shouldReturn` [BInteger 0xfeedbeef, BDefault, BDefault, BDefault, BDefault]

  it "can get the balance from an address" . runTest $ do
    -- Post contract
    runBS
      [r|
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
    [BAccount a] <- getFields ["a"]
    -- Set the balance
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 13})
    -- Check return of balance
    void $ call2 "myBalance" "()" (namedAccountToAccount Nothing a)
    getFields ["bal"] `shouldReturn` [BInteger 13]
  it "can get the codehash from an address" . runTest $ do
    let contract =
          [r|
contract Test {
  constructor(){}
}

contract qq{
  string codeHashTest;
  constructor() public {
    Test t = new Test();
    codeHashTest = account(t).codehash;
  }
}|]
    runBS contract
    getFields ["codeHashTest", "codeHashTest"]
      `shouldReturn` [ BString $ BC.pack $ keccak256ToHex $ hash $ UTF8.fromString contract,
                       BString "75dde029db795d07c2fed3b5d14443cf540520397ffc250b19567c80ff8e17fc"
                     ]

  it "can the codehash from this an address" . runTest $ do
    let contract =
          [r|
contract qq{
  string codeHashTest;
  constructor() public {
    codeHashTest = account(this).codehash;
  }
}|]
    runBS contract
    getFields ["codeHashTest", "codeHashTest"]
      `shouldReturn` [ BString $ BC.pack $ keccak256ToHex $ hash $ UTF8.fromString contract,
                       BString "bd03e87420032a4d4ac1653f8af8f4c42ae85bf8d07d02ff2433c7052d6d4fbb"
                     ]

  it "can get structs from the '.code' function" . runTest $ do
    let testCode :: String
        testCode =
          [r|struct point {
  uint x;
  uint y;
}
|]
        codeSnippet :: String
        codeSnippet =
          [r|

contract Test {
  uint bana = 13;
  uint x = 6;
  uint y = 7;
  struct point {
    uint x;
    uint y;
  }
  constructor () {
  }
}

contract qq {
  string codePiece = "";
  constructor () {
    Test t = new Test();
    codePiece = account(t).code("point");
  }
}|]
    runBS codeSnippet
    getFields ["codePiece"]
      `shouldReturn` [BString $ UTF8.fromString testCode]

  it "can get overloaded function using the .code parameter" . runTest $ do
    let testCode :: String
        testCode =
          [r|function addToNum (uint x, uint y) public {
    myNum += x + y;
    }
function addToNum (uint x, bool y) public {
    myNum += x;
    myStatus = y;
    }
function addToNum (uint x, string z) public {
    myNum += x;
    myString = z;
    }

|]
        codeSnippet :: String
        codeSnippet =
          [r|

contract Test {
  uint myNum = 13;
  bool myStatus;
  string myString = "butts";

  function randomFunc(uint x) public returns (uint){
    return x;
  }

  function addToNum(uint x, uint y) {
    myNum += x + y;
  }

  function addToNum(uint x, bool y) {
    myNum += x;
    myStatus = y;
  }

  function addToNum(uint x, string z) {
    myNum += x;
    myString = z;
  }
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("addToNum");
  }
}|]
    runBS codeSnippet
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString testCode]

  it "can get events from the '.code' function" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|event x(
    uint v);
|]
        contract :: String
        contract =
          [r|

contract Test {
  event x(uint v);
  constructor(){
    emit x(13);
  }
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("x");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can get external modifiers using the '.code' function" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|modifier anotherModifier() {
        require(x == 4,string.concat("x is not 4 : ",string(x)));
    _;
    require(x == 5,"x is not 5");
    }
|]
        contract :: String
        contract =
          [r|

contract anotherThing {
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
}


contract qq{
  string codeTest;
  constructor() public {
    anotherThing oc = new anotherThing();
    codeTest = account(oc).code("anotherModifier");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can get the code for a contract if supplied an empty string" . runTest $ do
    let codeSnippet :: String
        codeSnippet = [r|contract Test {
  
  constructor () public {
    }
}
|]
        contract :: String
        contract =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can search for an enum body within a codeCollection using .code" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|enum FreshJuiceSize {
  SMALL,
  MEDIUM,
  LARGE
}
|]
        contract :: String
        contract =
          [r|

contract Test {
  enum FreshJuiceSize{ SMALL, MEDIUM, LARGE }
}


contract qq {
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("FreshJuiceSize");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can search for any public variable in a contract initialized value using .code" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|uint public testVar = 1;
|]
        contract :: String
        contract =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  uint public testVar = 13*56-3+8/158*8*555*65+65-65-65+59/65-8+10-661;
  constructor() public {
    codeTest = account(this).code("testVar");
    testVar = 5;
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can search for a constant and get its initial code. using .code" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|uint public constant testConst = 136546546541654654324765441651684354646468435468;
|]
        contract :: String
        contract =
          [r|

contract Test {
  uint constant public testConst = 136546546541654654324765441651684354646468435468;
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("testConst");

  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "can get the current contract code without supplying anything to the code using .code" . runTest $ do
    let codeSnippet :: String
        codeSnippet =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code;
  }
}|]
        contract :: String
        contract =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code;
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "Code won't return anything if the thing is not in the file, using .code" . runTest $ do
    let contract :: String
        contract =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("nothing");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BDefault]

  it "Can search for the contract in a given file using the search procedure using .code" . runTest $ do
    let contractqq :: String
        contractqq =
          [r|contract qq {
  string codeTest;
  constructor () public {
    Test t = new Test();
    codeTest = account(this).code("qq");
    }
}
|]
        collection :: String
        collection =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(this).code("qq");
  }
}|]
    runBS collection
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString contractqq]

  it "can properly add the final } to a contract without a constructor using the code member function using .code" . runTest $ do
    let myContract :: String
        myContract =
          [r|contract Test {
  uint sixtyNine = 69;
  // no constructor found
}
|]
        contract :: String
        contract =
          [r|

contract Test {
  uint sixtyNine = 69;
}


contract qq {
  string codeTest;
  constructor(){
    Test t = new Test();
    codeTest = account(t).code("Test");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString myContract]

  it "can properly add the final } to a contract with a constructor but information after the constructor using the code member function using .code" . runTest $ do
    let myContract :: String
        myContract =
          [r|contract Test {
  uint seventyNine = 79;
  uint sixtyNine = 69;
  uint weed = 11;
  constructor () public {
    weed = 420;
    }
}
|]
        contract :: String
        contract =
          [r|

contract Test {
  uint sixtyNine = 69;
  uint weed = 11;
  constructor () {
    weed = 420;
  }
  uint seventyNine = 79;
}


contract qq {
  string codeTest;
  constructor(){
    Test t = new Test();
    codeTest = account(t).code("Test");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString myContract]

  it "Can find a function within a codeCollection using .code" . runTest $ do
    let myFunxion :: String
        myFunxion =
          [r|function myFunction () public returns (uint ) {
    uint x = 13;
    uint y = 13;
    uint z = x + y;
    uint w = z + 13;
    uint u = w + 13;
    return u;
    }
|]
        contract :: String
        contract =
          [r|

contract Test {
  function myFunction() public returns (uint) {
    uint x = 13;
    uint y = 13;
    uint z = x + y;
    uint w = z + 13;
    uint u = w + 13;
    return u;
  }
  constructor(){}
}


contract qq {
  string codeTest;
  constructor(){
    Test t = new Test();
    codeTest = account(t).code("myFunction");
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString myFunxion]

  it "Can avoid getting confused if two functions with the same name are in the same codeCollection using .code" . runTest $ do
    let myFunxion :: String
        myFunxion =
          [r|function myFunction () public returns (uint ) {
    uint x = 13;
    uint y = 13;
    uint z = x + y;
    uint w = z + 13;
    uint u = w + 13;
    return u;
    }
|]
        contract :: String
        contract =
          [r|

contract Test {
  function myFunction() public returns (uint) {
    uint x = 13;
    uint y = 13;
    uint z = x + y;
    uint w = z + 13;
    uint u = w + 13;
    return u;
  }
  constructor(){}
}


contract qq {
  string codeTest;
  constructor(){
    Test t = new Test();
    codeTest = account(t).code("myFunction");
  }
  function myFunction() public returns (uint) {
    uint x = 26;
    uint y = 26;
    uint z = x + y;
    uint w = z + 26;
    uint u = w + 26;
    return u;
  }
}
|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString myFunxion]

  it "Can get just the contract if empty string is fed to the code function. using .code" . runTest $ do
    let codeSnippet :: String
        codeSnippet = [r|contract Test {
  
  constructor () public {
    }
}
|]
        contract :: String
        contract =
          [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("");
  }

  function myFunction() public returns (uint) {
    return 13;
  }
}|]
    runBS contract
    getFields ["codeTest"]
      `shouldReturn` [BString $ UTF8.fromString codeSnippet]

  it "Can throw an error if more than one item is given to the code member function, using .code" $
    ( runTest
        ( runBS
            [r|

contract Test {
  constructor(){}
}


contract qq{
  string codeTest;
  constructor() public {
    Test t = new Test();
    codeTest = account(t).code("one", "two");
  }

  function myFunction() public returns (uint) {
    return 13;
  }
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "can't assign a value to an unallocated index in an array" $
    ( runTest
        ( runBS
            [r|

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
  }|]
        )
    )
      `shouldThrow` anyInvalidWriteError

  it "can transfer value from account a to account b" . runTest $ do
    -- Post contract
    runBS
      [r|

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
    [BAccount a] <- getFields ["a"]
    [BAccount b] <- getFields ["b"]
    -- Set the balance and instantiate both of the accounts the accounts
    -- Account a should start with 13 and b should have 0 at the start.
    -- The transfer member should be able to send the balance of to account b
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing a) (\as -> pure $ as {addressStateBalance = 14})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing b) (\bs -> pure $ bs {addressStateBalance = 0})

    -- Check return of balance
    void $ call2 "myBalance" "()" (namedAccountToAccount Nothing a)
    getFields ["bala", "balb"] `shouldReturn` [BInteger 1, BInteger 13]

  it "can't assign a value to an unallocated index in an array" $
    ( runTest
        ( runBS
            [r|

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
  }|]
        )
    )
      `shouldThrow` anyInvalidWriteError

  it "can run the typechecker" $
    ( runTest
        ( runBS
            [r|

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
}|]
        )
    )
      `shouldThrow` anyTypeError

  it "can parse an X509 certificate" . runTest $ do
    runBS
      [r|

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
    getFields ["myCommonName", "myCountry", "myOrganization", "myGroup", "myPublicKey"]
      `shouldReturn` [ BString "dan",
                       BString "USA",
                       BString "blockapps",
                       BString "engineering",
                       BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEGOKeu5dSCBFHVQuy/q1A8BeTb99G83tD\nVecvHHne6sKfmBZN1AIjhpHGKO22vBfdq3dMn/QBqb2TdR9w3WvMXQ==\n-----END PUBLIC KEY-----\n"
                     ]

    getFields ["myCommonName", "myCountry", "myOrganization", "myOrganizationalUnit", "myPublicKey"]
      `shouldReturn` [ BString "dan",
                       BString "USA",
                       BString "blockapps",
                       BString "engineering",
                       BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEGOKeu5dSCBFHVQuy/q1A8BeTb99G83tD\nVecvHHne6sKfmBZN1AIjhpHGKO22vBfdq3dMn/QBqb2TdR9w3WvMXQ==\n-----END PUBLIC KEY-----\n"
                     ]

  --   it "only a contract posted by the root user can call registerCert" $ (runTest $ do
  --     runBS [r|
  --
  -- contract qq {
  --     string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjjCCATKgAwIBAgIRANJH2FERGO/3JvoPHo52I3IwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyNTE0NTIwMloXDTIzMDQy\nNTE0NTIwMlowSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANIADBFAiEA\n9sjaARt+VEUCjZv3NAuEENoD744fZIuuUTt6qwM7fKQCIDLp02y/lSHtLfOOgCW5\n40qEIDYu2UO1JqSuyGvIUOoc\n-----END CERTIFICATE-----";
  --     constructor() {
  --         registerCert(myCertificate);
  --     }
  -- }|]) `shouldThrow` anyInvalidWriteError

  xit "can only post X509 certificates to the address of the public key" . runTest $ do
    void $
      runArgsWithCertificateRegistry
        [r|

contract Certificate {
    address public userAddress;

    // Store all the fields of a certificate in a Cirrus record
    string public commonName;
    string public organization;

    constructor(string _certificateString) {

        mapping(string => string) parsedCert = parseCert(_certificateString);

        commonName = parsedCert["commonName"];
        organization = parsedCert["organization"];
    }
}

contract qq is CertificateRegistry{
    account public certAddr = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0, "main");
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
    string public certName;
    string public certOrg;
    address public certRegAddr;
    Certificate userCert;
    CertificateRegistry certReg;
    constructor() {
        certReg = new CertificateRegistry();
        certRegAddr = certReg.registerCertificate(myCertificate);
        userCert = certReg.getUserCert(certRegAddr);
        certName = userCert.commonName();
        certOrg = userCert.organization();
    }
}|]
    getFields ["certName", "certOrg"]
      `shouldReturn` [ BString "Admin",
                       BString "BlockApps"
                     ]

  --   it "cannot post X509 certificates not signed by the BlockApps private key" $ (runTest $ do
  --     void $ runArgsWithOrigin rootAcc sender "()" [r|
  --
  -- contract qq {
  --     account public certAddr = account(0xe79beda3078bcb66524f91f74de982d2fcc89287);
  --     string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjjCCATKgAwIBAgIRANJH2FERGO/3JvoPHo52I3IwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyNTE0NTIwMloXDTIzMDQy\nNTE0NTIwMlowSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANIADBFAiEA\n9sjaARt+VEUCjZv3NAuEENoD744fZIuuUTt6qwM7fKQCIDLp02y/lSHtLfOOgCW5\n40qEIDYu2UO1JqSuyGvIUOoc\n-----END CERTIFICATE-----";
  --     string public certName;
  --     string public certOrg;
  --     constructor() {
  --         registerCert(myCertificate);
  --         certName = getUserCert(certAddr)["commonName"];
  --         certOrg = getUserCert(certAddr)["organization"];
  --     }
  -- }|]) `shouldThrow` anyInvalidCertError

  --   it "cannot register a x509 certificate on a private chain" $ (runTest $ do
  --     void $ runArgsWithOrigin rootAcc privateChainAcc "()" [r|
  --
  -- contract qq {
  --     account myAccount = account("deadbeef:feedbeef");

  --     string myNewCertificate = "-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----";

  --     constructor() {
  --         registerCert(myNewCertificate);
  --     }
  -- }|]) `shouldThrow` anyInvalidWriteError

  -- it "cannot use old registerCert on solidvm 3.2" $ (runTest $ do
  --     (runBS [r|
  --
  -- contract qq {
  --     account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
  --     string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
  --     string public certPubKey;
  --     constructor() {
  --         registerCert(certAddr, myCertificate);
  --         certPubKey = getUserCert(certAddr)["publicKey"];
  --     }
  -- }|])) `shouldThrow` anyUnknownFunc

  -- it "cannot use new registerCert(string _cert) on solidvm < 3.2" $ (runTest $ do
  --     (runBS [r|
  -- contract qq {
  --     account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
  --     string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
  --     string public certPubKey;
  --     constructor() {
  --         registerCert(myCertificate);
  --         certPubKey = getUserCert(certAddr)["publicKey"];
  --     }
  -- }|])) `shouldThrow` anyUnknownFunc

  -- it "cannot use new registerCert(string _cert, Certificate c) on solidvm < 3.2" $ (runTest $ do
  --     (runBS [r|
  -- contract Certificate {
  --   string name;
  --   constructor(string _name) {
  --     name = _name;
  --   }
  -- }
  -- contract qq {
  --     account public certAddr = account(0x622EB3792DaA3d3770E3D27D02e53755408aE00b);
  --     string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBizCCAS+gAwIBAgIQejfmUC0VeygSTQ0htwpDbzAMBggqhkjOPQQDAgUAMEcx\nDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIGA1UECwwLRW5n\naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTAeFw0yMjA0MTQyMTI4NDdaFw0yMzA0MTQy\nMTI4NDdaMEcxDTALBgNVBAMMBFRyb3kxEjAQBgNVBAoMCUJsb2NrYXBwczEUMBIG\nA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuB\nBAAKA0IABCSwiVfrLj1MCa+1bcBXOnGhnLxS5DYo3/1udE/LYFi2hFgDCPQxKYqP\n7LmHV2W35B3ZZw5SQVf1FxjWE0tZqswwDAYIKoZIzj0EAwIFAANIADBFAiEAvbGZ\nqma5fKnHnzpGCI5lc4VYdHBfgqfG7CwqJ5ii66YCIFUT+eXA1fS9q4/jJ+eULQwH\neXbEHHtO6nBOorRsoG3H\n-----END CERTIFICATE-----";
  --     string public certPubKey;
  --     constructor() {
  --         Certificate c = new Certificate("foo");
  --         registerCert(myCertificate, c);
  --         certPubKey = getUserCert(certAddr)["publicKey"];
  --     }
  -- }|])) `shouldThrow` anyInvalidWriteError

  xit "can only post X509 certificates to the address of the public key" . runTest $ do
    void $
      runArgsWithCertificateRegistry
        [r|

contract Certificate {
    address public userAddress;

    // Store all the fields of a certificate in a Cirrus record
    string public commonName;
    string public organization;

    constructor(string _certificateString) {

        mapping(string => string) parsedCert = parseCert(_certificateString);

        commonName = parsedCert["commonName"];
        organization = parsedCert["organization"];
    }
}

contract qq is CertificateRegistry{
    event CertificateRegistered(address userAddress, address contractAddress);
    account public certAddr = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0, "main");
    string public myCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
    string public certName;
    string public certOrg;
    address public certRegAddr;
    Certificate userCert;
    CertificateRegistry certReg;
    constructor() {
        certReg = new CertificateRegistry();
        certRegAddr = certReg.registerCertificate(myCertificate);
        userCert = certReg.getUserCert(certRegAddr);
        certName = userCert.commonName();
        certOrg = userCert.organization();
    }
}|]
    getFields ["certName", "certOrg"]
      `shouldReturn` [ BString "Admin",
                       BString "BlockApps"
                     ]
  --   it "can get a users cert" . runTest $ do
  --     void $ runArgsWithCertificateRegistry [r|

  -- contract Certificate {
  --     address public userAddress;

  --     // Store all the fields of a certificate in a Cirrus record
  --     string public commonName;
  --     string public organization;
  --     string public country;
  --     string public group;
  --     string public organizationalUnit;
  --     string public publicKey;
  --     string public certString;

  --     constructor(string _certificateString) {

  --         mapping(string => string) parsedCert = parseCert(_certificateString);

  --         commonName = parsedCert["commonName"];
  --         organization = parsedCert["organization"];
  --         country = parsedCert["country"];
  --         group = parsedCert["group"];
  --         organizationalUnit = parsedCert["organizationalUnit"];
  --         publicKey = parsedCert["publicKey"];
  --         certString = parsedCert["certString"];

  --     }
  -- }
  -- contract qq is CertificateRegistry{
  --     account myAccount = account(0x74f014FEF932D2728c6c7E2B4d3B88ac37A7E1d0);

  --     string myNewCertificate = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";

  --     address public certRegAddr;
  --     Certificate userCert;
  --     CertificateRegistry certReg;

  --     string myUsername     = "";
  --     string myOrganization = "";
  --     string myGroup        = "";
  --     string myOrganizationalUnit  = "";
  --     string certificate    = "";
  --     string myCommonName   = "";
  --     string myCountry      = "";
  --     string myOrganization = "";
  --     string myGroup        = "";
  --     string myOrganizationalUnit  = "";
  --     string myPublicKey    = "";
  --     string myCertificate  = "";

  --     constructor() {
  --         certReg = new CertificateRegistry();
  --         certRegAddr = certReg.registerCertificate(myNewCertificate);
  --         userCert = certReg.getUserCert(certRegAddr);

  --         myUsername     = tx.username;
  --         myOrganization = tx.organization;
  --         myGroup        = tx.group;
  --         myOrganizationalUnit = tx.organizationalUnit;

  --         certificate    = tx.certificate;
  --         myCommonName   = userCert.commonName();
  --         myCountry      = userCert.country();
  --         myOrganization = userCert.organization();
  --         myGroup        = userCert.group();
  --         myOrganizationalUnit  = userCert.organizationalUnit();
  --         myPublicKey    = userCert.publicKey();
  --         myCertificate  = userCert.certString();
  --     }
  -- }|]
  --     getFields ["myUsername", "myOrganization", "myGroup", "certificate","myCommonName", "myCountry", "myOrganization", "myGroup", "myPublicKey", "myCertificate"] `shouldReturn`
  --       [ BString "Admin"
  --       , BString "BlockApps"
  --       , BString "Engineering"
  --       , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
  --       , BString "Admin"
  --       , BString "USA"
  --       , BString "BlockApps"
  --       , BString "Engineering"
  --       , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----\n"
  --       , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----"
  --       ]
  --     getFields ["myUsername", "myOrganization", "myOrganizationalUnit", "certificate","myCommonName", "myCountry", "myOrganization", "myOrganizationalUnit", "myPublicKey", "myCertificate"] `shouldReturn`
  --       [ BString "Admin"
  --       , BString "BlockApps"
  --       , BString "Engineering"
  --       , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----\n"
  --       , BString "Admin"
  --       , BString "USA"
  --       , BString "BlockApps"
  --       , BString "Engineering"
  --       , BString "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----\n"
  --       , BString "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----"
  --       ]
  -- TODO change test to use new vm version once it is decided on

  it "can call builtin function verifyCert" . runTest $ do
    runBS
      [r|

contract qq {
    bool isValid = false;
    constructor() {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|]
    getFields ["isValid"] `shouldReturn` [BBool True]

  it "verifyCert fails for hex-encoded public keys" $
    ( runTest $ do
        ( runBS
            [r|

contract qq {
  bool isValid = false;
    constructor () {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "04521251e31fb06625fec592b69bfa70378d1cbc24b4500ed9d0307bb27cb966734bc38dc980acf45110d8db260e3e4868200a7114af5453705ce014403435a675";
      isValid = verifyCert(cert, pubkey);
    }
}|]
          )
    )
      `shouldThrow` anyMalformedDataError

  it "verifyCert succeeds with a chained cert" . runTest $ do
    let cert =
          T.pack $
            filter
              (\c -> not (isSpace c) || c == ' ')
              [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
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
        contract =
          T.unpack $
            T.replace
              "$CERT"
              cert
              [r|

contract qq {
    bool isValid = false;
    constructor() {
      string cert = "$CERT";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|]
    runBS contract
    getFields ["isValid"] `shouldReturn` [BBool True]

  it "verifyCert fails with a chained cert and the wrong public key" . runTest $ do
    let cert =
          T.pack $
            filter
              (\c -> not (isSpace c) || c == ' ')
              [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
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
        contract =
          T.unpack $
            T.replace
              "$CERT"
              cert
              [r|

contract qq {
    bool isValid = false;
    constructor() {
      string cert = "$CERT";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEAlGfMOmhI+AjQlfxve8YoEXhZErFdkCx\nc8OkTB1TP6giwof4fWG+Fua8b2W0YjOQkrQojwnKbBDt3CQeqU+bPA==\n-----END PUBLIC KEY-----";
      isValid = verifyCert(cert, pubkey);
    }
}|]
    runBS contract
    getFields ["isValid"] `shouldReturn` [BDefault]

  it "can call builtin function verifyCertSignedBy" . runTest $ do
    runBS
      [r|

contract qq {
    bool isValid = false;
    constructor() {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
      isValid = verifyCertSignedBy(cert, pubkey);
    }
}|]
    getFields ["isValid"] `shouldReturn` [BBool True]

  it "verifyCertSignedBy fails for hex-encoded public keys" $
    ( runTest $ do
        ( runBS
            [r|

contract qq {
  bool isValid = false;
    constructor () {
      string cert = "-----BEGIN CERTIFICATE-----\nMIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI\nMQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF\nbmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy\nMDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU\nMBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG\nBSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs\n9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8\nR0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n\nN8txKc8G9R27ZYAUuz15zF0=\n-----END CERTIFICATE-----";
      string pubkey = "04521251e31fb06625fec592b69bfa70378d1cbc24b4500ed9d0307bb27cb966734bc38dc980acf45110d8db260e3e4868200a7114af5453705ce014403435a675";
      isValid = verifyCertSignedBy(cert, pubkey);
    }
}|]
          )
    )
      `shouldThrow` anyMalformedDataError

  it "verifyCertSignedBy succeeds with a chained cert" . runTest $ do
    let cert =
          T.pack $
            filter
              (\c -> not (isSpace c) || c == ' ')
              [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
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
        contract =
          T.unpack $
            T.replace
              "$CERT"
              cert
              [r|

contract qq {
  bool isValid = false;
  constructor() {
    string cert = "$CERT";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEWgaGAD+EzRzA+zZILPDzRzDJiURfTYYZ\n/PYjx26acOAKKHjX6HkNUlVgJ0N/1oeMPYRhXm2tDGgZt6VbS1if8w==\n-----END PUBLIC KEY-----";
    isValid = verifyCertSignedBy(cert, pubkey);
  }
}|]
    runBS contract
    getFields ["isValid"] `shouldReturn` [BBool True]

  it "verifyCertSignedBy fails with a chained cert and the wrong public key" . runTest $ do
    let cert =
          T.pack $
            filter
              (\c -> not (isSpace c) || c == ' ')
              [r|-----BEGIN CERTIFICATE-----\nMIIBgzCCASegAwIBAgIQ
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
        contract =
          T.unpack $
            T.replace
              "$CERT"
              cert
              [r|

contract qq {
    bool isValid = false;
    constructor() {
      string cert = "$CERT";
      string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEAlGfMOmhI+AjQlfxve8YoEXhZErFdkCx\nc8OkTB1TP6giwof4fWG+Fua8b2W0YjOQkrQojwnKbBDt3CQeqU+bPA==\n-----END PUBLIC KEY-----";
      isValid = verifyCertSignedBy(cert, pubkey);
    }
}|]
    runBS contract
    getFields ["isValid"] `shouldReturn` [BDefault]

  it "can call builtin function verifySignature" . runTest $ do
    runBS
      [r|

contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]
    getFields ["isValid"] `shouldReturn` [BBool True]

  it "verifySignature fails for an incorrect message hash" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "I am not the message hash";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]
    )
      `shouldThrow` anyMalformedDataError

  it "verifySignature fails for an incorrect signature" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "30450220ac3c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "-----BEGIN PUBLIC KEY-----\nMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEUhJR4x+wZiX+xZK2m/pwN40cvCS0UA7Z\n0DB7sny5ZnNLw43JgKz0URDY2yYOPkhoIApxFK9UU3Bc4BRANDWmdQ==\n-----END PUBLIC KEY-----";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]
    )
      `shouldThrow` anyMalformedDataError

  it "verifySignature fails for a hex-encoded public key" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  bool isValid = false;
  constructor () {
    string msgHash = "68410110452c1179af159f85d3a4ae72aed12101fcb55372bc97c5108ef6e4d7";
    string signature = "304402203c47450445065b177a8952de40d1915fd99981d25fd93e322f337f3780e177c702206f16d0f0d2e40c47b699627fa9ae2737cb7129cf06f51dbb658014bb3d79cc5d";
    string pubkey = "04521251e31fb06625fec592b69bfa70378d1cbc24b4500ed9d0307bb27cb966734bc38dc980acf45110d8db260e3e4868200a7114af5453705ce014403435a675";
    isValid = verifySignature(msgHash, signature, pubkey);
  }
}|]
    )
      `shouldThrow` anyMalformedDataError

  it "can properly preform complex tuple destructuring" . runTest $ do
    runBS
      [r|

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
    getFields ["index", "xr", "yr"] `shouldReturn` [BInteger 7, BInteger 2, BInteger 7]

  it "can use the attributes of the block variable e.g. block.coinbase, block.timestamp, block.number, block.difficulty and block.gaslimit" . runTest $ do
    runBS
      [r|

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
    runBS
      [r|

contract qq{
    uint x;
    constructor() public returns (uint) {
        x = addmod(8, 2, 3);
    }
}|]
    getFields ["x"] `shouldReturn` [BInteger 1]

  it "can use the builtin mulmod function" . runTest $ do
    runBS
      [r|

contract qq{
    uint x;
    constructor() public returns (uint) {
        x = mulmod(7, 2, 3);
    }
}|]
    getFields ["x"] `shouldReturn` [BInteger 2]

  it "can set values in a mapping that's a member of a struct" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

contract qq {
  struct Data {
    mapping(uint => bool) flags;
  }
  function a() public returns (bool) {
    Data d;
    d.flags[1] = true;
    return d.flags[1];
  }
}|]
      `shouldReturn` Just "(true)"

  it "can set values in a mapping that's a local variable" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

contract qq {
  function a() public returns (bool) {
    mapping(int => bool) flags;
    flags[1] = true;
    return flags[1];
  }
}|]
      `shouldReturn` Just "(true)"

  it "can set values in a mapping that's a contract variable" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

contract qq {
  mapping(int => bool) flags;
  function a() public returns (bool) {
    flags[1] = true;
    return flags[1];
  }
}|]
      `shouldReturn` Just "(true)"

  it "can use string.concat(x,y) to concatenate any amount of strings" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

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
    runCall'
      "a"
      "()"
      [r|

contract qq {
  function a() public returns (bytes32) {
    return keccak256("hello", "world");
  }
}|]
      `shouldReturn` Just "(\"fa26db7ca85ead399216e7c6316bc50ed24393c3122b582735e7f3b0f91b93f0\")"

  it "cant use  a commented pragma" . runTest $ do
    runCall'
      "a"
      "()"
      [r|
//
contract qq {
  function a() public returns (uint) {
    return 2;
  }
}|]
      `shouldReturn` Just "(2)"
  it "can declare a custom modifier and use it in a contract" $
    ( runTest $ do
        ( runBS
            [r|

contract qq {
  modifier myModifier() {  // line 4
    require(false);
    _;

  }

  constructor() public myModifier returns (bool) {
    return true;
  }
}|]
          )
    )
      `shouldThrow` failedRequirementNoMsg

  it "can declare a custom modifier and use it in a contract" $
    ( runTest $ do
        ( runBS
            [r|
pragma solidvm 11.4;
contract qq {
  modifier myModifier() {  // line 4
    return 7;
    require(false);
    _;

  }

  constructor() public myModifier returns (bool) {
    return true;
  }
}|]
          )
    )
      `shouldThrow` anyTypeError

  it "can use a modifier as part of a function" . runTest $ do
    runCall'
      "decrement"
      "(1)"
      [r|

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

}|]
      `shouldReturn` Just "()"

  it "can use a modifier and require something after and before the function is run" . runTest $ do
    runBS
      [r|

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
    runBS
      [r|

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

  it "can use a modifier that takes arguments as part of a function" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

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
}|]
      `shouldReturn` Just "()"

  it "cannot allow negative block number" $
    runTest
      ( do
          runBS
            [r|

contract qq {
  constructor() public returns (bytes32) {
    return blockhash(-1);
  }
}|]
      )
      `shouldThrow` anyInvalidArgumentsError

  it "return default value for index not present-In-Memory Check" . runTest $ do
    runBS
      [r|

contract qq {

  bool x;
  uint y;
  string z;

  constructor() {
    mapping(uint=>bool) booleanTest;
    mapping(uint=>uint) integerTest;
    mapping(uint=>string) stringTest;

    booleanTest[1] = true;
    integerTest[1] = 1;
    stringTest[1] = "testing";

    x = booleanTest[9];
    y = integerTest[9];
    z = stringTest[9];
  }
}|]
    getFields ["x", "y", "z"] `shouldReturn` [BDefault, BDefault, BDefault]
  it "return default value for index not present" . runTest $ do
    runBS
      [r|

contract qq {

  mapping(uint=>bool) booleanTest;
  mapping(uint=>uint) integerTest;
  mapping(uint=>string) stringTest;

  bool x;
  uint y;
  string z;

  constructor() {
    booleanTest[1] = true;
    integerTest[1] = 1;
    stringTest[1] = "testing";

    x = booleanTest[9];
    y = integerTest[9];
    z = stringTest[9];
  }
}|]
    getFields ["x", "y", "z"] `shouldReturn` [BDefault, BDefault, BDefault]

  it "returns owner's address for valid ecrecover call" . runTest $ do
    runBS
      [r|

contract qq {

  address addr;
  constructor() {
  addr = ecrecover("ca678fcee68aa0b4b1e0bf01b24a0beff75133284f0ad84f1e8cc70d5a9959bc",27,"c99b861c7a2d47bcf5a8423b94cc962b585f340a53e88c91b86a53effd10dc58","3dfd7acaf4625c69df55a2f4cf4f7d63da25bb495abd8dfcc9bd53481c0ccaeb");
  }
}|]
    getFields ["addr"] `shouldReturn` [BAccount (NamedAccount 0x91bc5385f9cfa1f4c9c9805102d54c7f77bde902 UnspecifiedChain)] -- 666171f931111ae3aed54595fc9776699e5eb03d

  --   it "returns 0  for invalid ecrecover call" . runTest $ do
  --     runBS [r|
  --
  -- contract qq {

  --   address addr;
  --   constructor() {
  --   addr = ecrecover("ca678fcee68aa0b4b1e0bf01b24a0beff75133284f0ad84f1e8cc70d5a9959bc",27,"efd16e46ceb4851861b89aa5fddb18e18a70bdaf029d77482bdd9b2242854b59","3dfd7acaf4625c69df55a2f4cf4f7d63da25bb495abd8dfcc9bd53481c0ccaeb");
  --   }
  -- }|]
  --     getFields ["addr"] `shouldReturn` [BDefault]

  it "can use builtin sha256 function" . runTest $ do
    runBS
      [r|

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
    runBS
      [r|

contract qq {
  bytes20 hsh;
  constructor() public {
    string username = "uname";
    hsh = ripemd160(username);
  }
}|]
    getFields ["hsh"] `shouldReturn` [BString $ B.pack $ word160ToBytes 0x63f4a6f6005b0ded8c5fc7e62ddf2550e9320410]

  it "can use the selfdestruct function" . runTest $ do
    let contract =
          [r|

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

  function selfDestructThis() external {
    selfdestruct(ownerPay);
  }
}|]
    runBS contract
    -- Get the contract's accounts
    [BAccount contract', BAccount owner] <- getFields ["contract'", "owner"]
    -- Adjust the preset balances
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing contract') (\as -> pure $ as {addressStateBalance = 14})
    adjust_ (Proxy @AddressState) (namedAccountToAccount Nothing owner) (\bs -> pure $ bs {addressStateBalance = 10})
    -- Check return of balance
    void $ call2 "selfDestructThis" "()" (namedAccountToAccount Nothing contract')
    getFields ["contract'", "contractPay", "owner", "ownerPay"]
      `shouldReturn` [ BDefault,
                       BDefault,
                       BDefault,
                       BDefault
                     ]

  it "throw an error when the 'account' reserved word is for a variable name." $
    runTest
      ( do
          runBS
            [r|

contract A {
  uint account;
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "throw an error when the 'account' reserved word is for a contract name." $
    runTest
      ( do
          runBS
            [r|

contract account {
  uint a;
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "throw an error when the 'account' reserved word is used for a function name." $
    runTest
      ( do
          runBS
            [r|

contract A {
  function account() {
  }
}|]
      )
      `shouldThrow` anyMissingTypeError
  it "can use 1e_ notation to get a number" . runTest $ do
    runBS
      [r|

contract qq{
  uint mynum;
  constructor() public {
    mynum = 1e12;
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 1000000000000]

  it "can use ether number unit suffixes" . runTest $ do
    runBS
      [r|

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

  it "can assign an a constant at contract level" . runTest $ do
    runBS
      [r|
contract qq {
  uint constant c = 2022;
  constructor() public {
  }
}|]
    getFields ["c"] `shouldReturn` [BDefault] --- Wait does this return BDefault or Int?
  it "an assign an immutable" . runTest $ do
    runBS
      [r|

contract qq {
  uint t1a = 2022;
  uint immutable t1x = 2022;
  constructor() public {
  }
}|]
    getFields ["t1a", "t1x"] `shouldReturn` [BInteger 2022, BInteger 2022]

  it "can assign an already declared, but unassigned immutable in a constructor" . runTest $ do
    runBS
      [r|

contract qq {
  uint immutable t2a;
  uint t2x = 2022;
  constructor() public {
    t2a = t2x;
  }
}|]
    getFields ["t2a", "t2x"] `shouldReturn` [BInteger 2022, BInteger 2022]

  it "can deterministically create multiple salted contracts with no args" . runTest $ do
    let src =
          [r|

contract X {
  string public xNum;
}

contract Y {
  uint public yNum;
}

contract qq {
  X public x;
  Y public y;
  X public z;
  bytes32 salt';
  constructor() public {
    salt' = "salt";
    x = new X{salt: salt'}();
    y = new Y{salt: "something"}();

  }
}|]
    runBS src
    getFields ["x", "y"]
      `shouldReturn` [ bContract "X" $ deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "salt" (Just . hash $ BC.pack src) Nothing,
                       bContract "Y" $ deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "something" (Just . hash $ BC.pack src) Nothing
                     ]

  it "can deterministically create multiple salted contract with args" . runTest $ do
    let src =
          [r|

contract X {
  string public xNum;
  constructor(string _xNum) public {
    xNum = _xNum;
  }
}

contract Y {
  uint public yNum;
  constructor(uint _yNum) public {
    yNum = _yNum;
  }
}

contract qq {
  X public x;
  Y public y;
  X public z;
  bytes32 salt';
  constructor() public {
    salt' = "salt";
    x = new X{salt: salt'}("xNum");
    y = new Y{salt: salt'}(100);

  }
}|]
    runBS src
    getFields ["x", "y"]
      `shouldReturn` [ bContract "X" $ deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "salt" (Just . hash $ BC.pack src) (Just "OrderedVals [SString \"xNum\"]"),
                       bContract "Y" $ deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "salt" (Just . hash $ BC.pack src) (Just "OrderedVals [SInteger 100]")
                     ]
    [BContract "X" x] <- getFields ["x"]
    [BContract "Y" y] <- getFields ["y"]
    getSolidStorageKeyVal' (namedAccountToAccount Nothing x) (singleton "xNum") `shouldReturn` BString "xNum"
    getSolidStorageKeyVal' (namedAccountToAccount Nothing y) (singleton "yNum") `shouldReturn` BInteger 100

  it "can deterministically create salted contract with multiple args" . runTest $ do
    let src =
          [r|
contract User {
  string commonName;
  string cert;
  constructor(string _commonName, string _cert) {
    commonName = _commonName;
    cert = _cert;
  }
}

contract qq {
  User public x;
  constructor() public {
    x = new User{salt: "Dustin Norwood"}("Dustin Norwood", "Thebestcertyoucangetfor$99.99");
  }
}|]
    runBS src
    getFields ["x"] `shouldReturn` [bContract "User" $ deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "Dustin Norwood" (Just . hash $ BC.pack src) (Just "OrderedVals [SString \"Dustin Norwood\",SString \"Thebestcertyoucangetfor$99.99\"]")]
    [BContract "User" x] <- getFields ["x"]
    getSolidStorageKeyVal' (namedAccountToAccount Nothing x) (singleton "commonName") `shouldReturn` BString "Dustin Norwood"
    getSolidStorageKeyVal' (namedAccountToAccount Nothing x) (singleton "cert") `shouldReturn` BString "Thebestcertyoucangetfor$99.99"

  it "can deterministically derive salted contract addresses with no args" . runTest $ do
    let src =
          [r|
contract VerySimpleStorage {
  uint x;
  constructor() {
    x = 1337;
  }
}

contract qq {
  VerySimpleStorage public x;
  address y;
  constructor() public {
    x = new VerySimpleStorage{salt: "kosher"}();
    y = address(this).derive("kosher");

    require(address(x) == y, "These salted addresses are not the same");
  }
}|]
    runBS src `shouldReturn` ()

  it "can deterministically derive salted contract addresses with multiple args" . runTest $ do
    let src =
          [r|
contract User {
  string commonName;
  string cert;
  constructor(string _commonName, string _cert) {
    commonName = _commonName;
    cert = _cert;
  }
}

contract qq {
  User public x;
  address y;
  constructor() public {
    x = new User{salt: "himalayan"}("David Moncayo", "Bababadalgharaghtakamminarronnkonnbronntonnerronntuonnthunntrovarrhounawnskawntoohoohoordenenthurnuk");
    y = address(this).derive("himalayan", "David Moncayo", "Bababadalgharaghtakamminarronnkonnbronntonnerronntuonnthunntrovarrhounawnskawntoohoohoordenenthurnuk");
    require(address(x) == y, "These salted addresses are not the same");
  }
}|]
    runBS src `shouldReturn` ()

  it "should fail when trying to create salted contract to the same address" $
    runTest
      ( do
          runBS
            [r|
contract User {
  string commonName;
  string cert;
  constructor(string _commonName, string _cert) {
    commonName = _commonName;
    cert = _cert;
  }
}

contract qq {
  User public x;
  User public y;
  constructor() public {
    x = new User{salt: "Dustin Norwood"}("Dustin Norwood", "Thebestcertyoucangetfor$99.99");
    y = new User{salt: "Dustin Norwood"}("Dustin Norwood", "Thebestcertyoucangetfor$99.99");
  }
}|]
      )
      `shouldThrow` anyDuplicateContractError

  it "can use a try catch statment to catch a divide by zero error the SolidVM Way (trademark pending)" . runTest $ do
    runBS
      [r|

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

  it "can use a try catch statment to catch any error the SolidVM Way (trademark pending)" . runTest $ do
    runBS
      [r|

contract qq{
  uint mynum = 5;
  constructor() public {
    try {
      mynum = 1 / 0;
    } catch {
      mynum = 3;
    }
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 3]

  it "can use a try catch statment to catch a divide by zero error the Solidity Way (trademark very much in effect)" . runTest $ do
    runBS
      [r|

contract Divisor {
  function doTheDivide() public returns (uint) {
    return (1 / 0);
  }
}

contract qq {
  uint myNum = 5;
  uint otherNum = 7;
  uint errorCount = 0;
  constructor() {
    Divisor d =  new Divisor();
    try d.doTheDivide() returns (uint v) {
        } catch Error(string memory amsg) { 
            // This is executed in case
            // revert was called inside getData
            // and a reason string was provided.
            errorCount++;
        } catch Panic(uint errCode) {
            // This is executed in case of a panic,
            // i.e. a serious error like division by zero
            // or overflow. The error code can be used
            // to determine the kind of error.
            errorCount++;
            myNum = 3;
            otherNum = errCode;
        } catch (bytes bigTest) {
            // This is executed in case revert() was used.
            errorCount++;
        }
  }
}|]
    getFields ["myNum", "otherNum", "errorCount"] `shouldReturn` [BInteger 3, BInteger 12, BInteger 1]

  it "can use a try catch statment to catch a divide by zero error the Solidity Way (trademark very much in effect) in a function" . runTest $ do
    runCall'
      "tryTheDivide"
      "()"
      [r|

contract Divisor {
  function doTheDivide() public returns (uint) {
    return (1 / 0);
  }
}
contract qq {
  Divisor public d;
  uint public errCount = 0;
  uint theError = 0;
  constructor() public {
    d = new Divisor();
  }
  function tryTheDivide() returns (uint, bool) {
    try d.doTheDivide() returns (uint v) {
        return (v, true);
    } catch Error(string memory itsamessage) {
        // This is executed in case
        // revert was called inside doTheDivide()
        // and a reason string was provided.
        errCount++;
        return (0, false);
    } catch Panic(uint errCode) {
        // This is executed in case of a panic,
        // i.e. a serious error like division by zero
        // or overflow. The error code can be used
        // to determine the kind of error.
        errCount++;
        theError = errCode;
        return (errCode, false);
    } catch (bytes bigTest) {
        // This is executed in case revert() was used.
        errCount++;
        return (0, false);
    }
  }
}|]
      `shouldReturn` (Just "(12,false)")

    getFields ["errCount", "theError"] `shouldReturn` [BInteger 1, BInteger 12]

  it "allows overloading functions with different number of parameters" . runTest $ do
    runBS
      [r|

contract qq{
  uint myNum = 0;
  constructor() public {
    addToNum({x: 1, y: 2});
    addToNum(1);
    addToNum(1, 2);
    addToNum(1, 2, 3);
  }

  function addToNum(uint x, uint y) {
    myNum += x + y;
  }

  function addToNum(uint x) {
    myNum += x;
  }

  function addToNum(uint x, uint y, uint z) {
    myNum += x + y + z;
  }
}|]
    getFields ["myNum"] `shouldReturn` [BInteger 13]

  it "allows overloading functions with same number of parameters" . runTest $ do
    runBS
      [r|

contract qq{
  uint myNum = 0;
  string myString = "";
  bool myStatus = false;
  constructor() public {
    addToNum({x: 1, y: true});
    addToNum(0, randomFunc(3));
    addToNum(1, "hi");
  }

  function randomFunc(uint x) public returns (uint){
    return x;
  }

  function addToNum(uint x, uint y) {
    myNum += x + y;
  }

  function addToNum(uint x, bool y) {
    myNum += x;
    myStatus = y;
  }

  function addToNum(uint x, string z) {
    myNum += x;
    myString = z;
  }
}|]
    getFields ["myNum", "myString", "myStatus"] `shouldReturn` [BInteger 5, BString "hi", BBool True]

  it "can use randomly ordered named argument function calls" . runTest $ do
    runBS
      [r|

contract qq{
  uint myNum = 0;
  bool myStatus;
  constructor() public {
    addToNum({y: true, x: 3});
  }

  function addToNum (uint x, bool y) {
    myNum += x;
    myStatus = y;
  }
}|]
    getFields ["myNum", "myStatus"] `shouldReturn` [BInteger 3, BBool True]

  it "can use randomly ordered named argument function calls with overloading" . runTest $ do
    runBS
      [r|

contract qq{
  uint myNum = 0;
  bool myStatus;
  string myString;
  constructor() public {
    addToNum({y: true, x: 3});
    addToNum({x: 3, y: "hi"});
    addToNum({y: " world", x: 3});
  }

  function addToNum (uint x, string y) {
    myNum += x;
    myString += y;
  }

  function addToNum (uint x, bool y) {
    myNum += x;
    myStatus = y;
  }
}|]
    getFields ["myNum", "myStatus", "myString"] `shouldReturn` [BInteger 9, BBool True, BString "hi world"]

  it "should catch invalid function overloads" $
    runTest
      ( do
          runBS
            [r|

contract qq{
  uint myNum = 0;
  constructor() public {
    addToNum(1, 2);
  }

  function addToNum(uint x, uint y) {
    myNum += x - y;
  }

  function addToNum(uint a, uint b) {
    myNum += a + b;
  }
}|]
      )
      `shouldThrow` anyInvalidArgumentsError

  xit "can pass calldata arguments and use calldata variables" . runTest $ do
    runBS
      [r|

contract Validator {
  function isEmptyArray(bytes32[] calldata _arr) pure internal returns (bool) {
    return _arr.length == 0;
  }
}

contract qq is Validator {
  bool public empty_is_empty;
  bool public nonempty_is_empty;
  uint public nonempty_length;
  constructor() public {
    bytes32[] calldata empty;
    empty_is_empty = isEmptyArray(empty);

    bytes32[] calldata nonempty = new bytes32[](1);
    nonempty_is_empty = isEmptyArray(nonempty);

  }
}
|]
    getFields ["empty_is_empty", "nonempty_is_empty"] `shouldReturn` [BBool True, BBool False]

  it "can run this for loop and increment the counter" . runTest $ do
    runBS
      [r|

contract qq{
  uint mynum = 0;
  constructor() public {
    for (uint i=0; i < 10; i = i + 1) {
      mynum = i;
    }
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 9]

  it "can use a modifier with a functions argument as it's argument" $
    runTest
      ( do
          runCall'
            "changeHost"
            "(0)"
            [r|

contract qq {
    // We will use these variables to demonstrate how to use
    // modifiers.
    address public  host;
    uint    public  x = 10;
    bool    public  locked;

    constructor() public {
        // Set the transaction sender as the host of the contract.
        host = msg.sender;
    }

    modifier onlyHost() {
        require(msg.sender == host, "Not host");
        _;
    }

    //Inputs can be passed to a modifier
    modifier validAddress(address _addr) {
        require(_addr != address(0), "Not a valid address");
        _;
    }

    function changeHost(address _newHost) public onlyHost validAddress(_newHost) returns (uint) {
        host = _newHost;
        return 2;
    }
}
|]
      )
      `shouldThrow` anyRequireError

  it "can use msg.data" . runTest $ do
    runBS
      [r|

contract X {
  function func2(uint _a, string _b, bool _c) pure public returns (string) {
    return msg.data;
  }
}

contract qq {
  string s;
  constructor() {
    X x = new X();
    s = x.func2(10, "hey", false);
  }
}|]
    getFields ["s"] `shouldReturn` [BString "(10, hey, False)"]

  it "can use msg.sig" . runTest $ do
    runBS
      [r|

contract X {
  function func2(uint _a, string _b, bool _c) pure public returns (bytes4) {
    return msg.sig;
  }
}

contract qq {
  bytes4 ss;
  constructor() {
    X x = new X();
    ss = x.func2(10, "hey", false);
  }
}|]
    let calldataHash = fromMaybe emptyHash $ stringKeccak256 "func2(uint,string,bool)"
    getFields ["ss"] `shouldReturn` [BString $ BC.pack $ L.take 8 $ keccak256ToHex calldataHash]

  it "can use free functions, free functions can access this" . runTest $ do
    runBS
      [r|


function sum(uint[] memory arr) pure returns (uint s) {
  for (uint i = 0; i < arr.length; i++) {
    s += arr[i];
  }
}

function getAccount() returns (address s) {
  s = account(this);
}

contract qq{
  uint myNum;
  address ctract;
  uint[] myArr = [1,2,3];
  constructor() public {
    myNum = sum(myArr);
    ctract = getAccount();
  }
}|]
    getFields ["myNum", "ctract"] `shouldReturn` [BInteger 6, bAddress 0xe8279be14e9fe2ad2d8e52e42ca96fb33a813bbe]

  it "free functions cannot access state variables" $
    runTest
      ( do
          runBS
            [r|


function setNum() {
  myNum = 4;
}

contract qq{
  uint myNum;
  constructor() public {
    setNum();
  }
}|]
      )
      `shouldThrow` anyUnknownVariableError

  it "free functions cannot access internal functions of contracts" $
    runTest
      ( do
          runBS
            [r|


function callInternal() {
  setNum(4);
}

contract qq{
  uint myNum;
  constructor() public {
    callInternal();
  }
  function setNum(uint x) internal {
    myNum = 4;
  }
}|]
      )
      `shouldThrow` anyUnknownVariableError

  it "contracts will prioritize contract functions over free functions" . runTest $ do
    runBS
      [r|


function setNum(uint x) returns (uint s) {
  s = x + 2;
}

contract qq{
  uint myNum;
  constructor() public {
    myNum = setNum(4);
  }

  function setNum(uint x) returns (uint) {
    return x + 3;
  }
}|]
    getFields ["myNum"] `shouldReturn` [BInteger 7]

  it "contracts will prioritize overloaded contract functions over free functions" . runTest $ do
    runBS
      [r|


function setNum(uint x, uint y) returns (uint s) {
  s = x + y + 2;
}

contract qq{
  uint myNum;
  constructor() public {
    myNum = setNum(1, 2);
  }

  function setNum(uint x) returns (uint) {
    return x + 3;
  }

  function setNum(uint x, uint y) returns (uint) {
    return x + y + 3;
  }

}|]
    getFields ["myNum"] `shouldReturn` [BInteger 6]

  it "can overload free functions" . runTest $ do
    runBS
      [r|


function sum(uint[] memory arr) pure returns (uint s) {
  for (uint i = 0; i < arr.length; i++) {
    s += arr[i];
  }
}

function sum(uint a, uint b) pure returns (uint c) {
  c = a + b;
}

contract qq{
  uint myNum;
  uint otherNum;
  uint[] myArr = [1,2,3];
  constructor() public {
    myNum = sum(myArr);
    otherNum = sum(4, 5);
  }
}|]
    getFields ["myNum", "otherNum"] `shouldReturn` [BInteger 6, BInteger 9]

  it "cannot overload free functions with same types and same number of parameters" $
    runTest
      ( do
          runBS
            [r|


function sum(uint[] memory arr) pure returns (uint s) {
  for (uint i = 0; i < arr.length; i++) {
    s += arr[i];
  }
}

function sum(uint[] memory arr) pure returns (uint s) {
  for (uint i = 0; i < arr.length; i++) {
    s += arr[i];
  }
}

contract qq{
  uint myNum;
  uint[] myArr = [1,2,3];
  constructor() public {
    myNum = sum(myArr);
  }
}|]) `shouldThrow` anyTypeError


  it "can declare a constant at the file level and use it" . runTest $ do
    runBS
      [r|

uint constant myconst = 5;
contract qq{
  uint mynum = myconst;
  constructor() public {
    mynum = myconst;
  }
}|]
    getFields ["mynum"] `shouldReturn` [BInteger 5]

  it "can declare enums at the file level" . runTest $ do
    runCall'
      "a"
      "()"
      [r|

enum Color { red, green, blue }
contract A {
    function value() public returns (uint) {
        return 0xa;
    }
}

enum Letter { a, b, c }
contract B {
    function value() public returns (uint) {
        return 0xb;
    }
}
contract qq {
  function a() public returns (Letter) {
    return Letter.c;
  }
}

|]
      `shouldReturn` Just "(2)"

  it "can declare structs at the file level" . runTest $ do
    runCall'
      "a"
      "()"
      [r|



struct Point {
  uint x;
  uint y;
}

contract qq {
  function a() public returns (uint) {
    Point p;
    p.x = 1;
    p.y = 2;
    return p.x;
  }
}|]
      `shouldReturn` (Just "(1)")

  it "should bitshift assign" . runTest $ do
    runBS
      [r|

contract qq {
  int solidty = 3;  //  00000000000000000000000000000101
  int haskell = 1; //  00000000000000000000000000000010
  int solid = -5; //  11111111111111111111111111111011
  constructor() {
    solid >>= 2;
    solidty >>= 1;
    haskell <<= 2;

  }
}|]
    getFields ["haskell", "solidty", "solid"] `shouldReturn` [BInteger 4, BInteger 1, BInteger (-2)]

  it "can unsigned bit shift" . runTest $ do
    runBS
      [r|

contract qq {
  int result1 = 0;
  int result2 = 0;
  int result3 = -2;
  int result4 = 24;
  constructor() {
    result1 += -2 >>> 254;
    result2 += 12 >>> 1;
    result3 >>>= 255;
    result4 >>>= 1;
  }
}|]
    getFields ["result1", "result2", "result3", "result4"] `shouldReturn` [BInteger 3, BInteger 6, BInteger 1, BInteger 12]

  it "uint to string convertion test " . runTest $ do
    runBS
      [r|

contract qq {
  uint a = 0;
  uint b = 0;
  uint c = 0;
  uint d = 0;
  constructor() {
    a = uint("1237655",10);
    b = uint("18884635",16);
    c = uint("12124567");
    d = uint("1f3479f6");
  }
}|]
    getFields ["a", "b", "c", "d"] `shouldReturn` [BInteger 1237655, BInteger 0x18884635, BInteger 0x12124567, BInteger 0x1f3479f6]

  it "can declare custom errors and file level custom errors" . runTest $ do
    runBS
      [r|

error flError(string someString);

contract qq {
  error myError(uint num);
  constructor() {
  }
}|]

  it "can throw custom errors" $
    runTest
      ( do
          runBS
            [r|


contract qq {
  error myError (string message);
  constructor() {
    throwsError();
  }

  function throwsError() {
    throw myError("lmao pranked");
  }
}|]
      )
      `shouldThrow` anyCustomError

  it "can catch custom errors the SOLIDVM WAY" . runTest $ do
    runBS
      [r|


contract qq {
  error IsTen (int ten, string message);
  int val;
  string errorMsg;
  string myString;

  constructor() {
    setVal(10);
    setString();
  }

  function checkTen(int _val) returns (int) {
     if (_val == 10) {
        throw IsTen(_val, "Stop trying to make ten happen, its not going to happen");
     }
     return _val;
  }

  function setString() {
    myString = "hello";
  }

  function setVal(int _val) returns (int) {
     try {
        val = checkTen(_val);
     } catch IsTen(vall, mes) {
        val = vall + 1;
        errorMsg = mes;
     }
  }
}|]
    getFields ["val", "myString", "errorMsg"] `shouldReturn` [BInteger 11, BString "hello", BString "Stop trying to make ten happen, its not going to happen"]

  it "can catch custom errors the SOLIDVM WAY, also allows less aliases" . runTest $ do
    runBS
      [r|


contract qq {
  error IsTen (int ten, string message);
  int val;

  constructor() {
    setVal(10);
  }

  function checkTen(int _val) returns (int) {
     if (_val == 10) {
        throw IsTen(_val, "Stop trying to make ten happen, its not going to happen");
     }
     return _val;
  }

  function setVal(int _val) returns (int) {
     try {
        val = checkTen(_val);
     } catch IsTen(vall) {
        val = vall + 1;
     }
  }
}|]
    getFields ["val"] `shouldReturn` [BInteger 11]

  it "can catch custom errors the SOLIDVM WAY and catch too many aliases" $
    runTest
      ( do
          runBS
            [r|


contract qq {
  error IsTen (int ten, string message);
  int val;
  string myString;

  constructor() {
    setVal(10);
    setString();
  }

  function checkTen(int _val) returns (int) {
     if (_val == 10) {
        throw IsTen(_val, "Stop trying to make ten happen, its not going to happen");
     }
     return _val;
  }

  function setString() {
    myString = "hello";
  }

  function setVal(int _val) returns (int) {
     try {
        val = checkTen(_val);
     } catch IsTen(vall, mes, bad) {
        val = vall + 1;
        myString = bad;
     }
  }
}|]
      )
      `shouldThrow` anyTypeError

  it "revert sucessfully when invoked without arguments" $
    runTest
      ( do
          runBS
            [r|

contract qq {

  uint a;

  constructor()
  {
    a=1;
    randomFunction(1);
  }

  function randomFunction(uint checker)
  {
    if(a==checker)
      revert();
  }
}|]
      )
      `shouldThrow` anyRevertError

  it "revert sucessfully when invoked with arguments" $
    runTest
      ( do
          runBS
            [r|

contract qq {

  uint a;

  constructor()
  {
    a=1;
    randomFunction(1);
  }

  function randomFunction(uint checker)
  {
    if(a==checker)
      revert("logic flag");
  }
}|]
      )
      `shouldThrow` anyRevertError

  it "revert sucessfully when invoked with namedargs" $
    runTest
      ( do
          runBS
            [r|

contract qq {

  uint a;

  constructor()
  {
    a=1;
    randomFunction(1);
  }

  function randomFunction(uint checker)
  {
    if(a==checker)
      revert("logic flag");
  }
}|]
      )
      `shouldThrow` anyRevertError

  it "Revert customError" $
    runTest
      ( do
          runBS
            [r|

contract qq {

  uint a;
  error f (string message);
  constructor()
  {
    a=1;
    randomFunction(1);
  }

  function randomFunction(uint checker)
  {
    if(a==checker)
      revert f("ERROR");
  }
}|]
      )
      `shouldThrow` anyCustomError

  it "Revert customError  namedargs" $
    runTest
      ( do
          runBS
            [r|

contract qq {

  uint a;
  error f(string x,string y);
  constructor()
  {
    a=1;
    randomFunction(1);
  }

  function randomFunction(uint checker)
  {
    if(a==checker)
      revert f({x:'a',y:'b'});
  }
}|]
      )
      `shouldThrow` anyCustomError

  it "Supports pure functions in 3.3" . runTest $ do
    runBS
      [r|

contract qq {
    function f(uint a, uint b) public pure returns (uint) {
        return a * (b + 42);
    }
}
|]
    getAll [[Field "a"], [Field "b"]] `shouldReturn` [BDefault, BDefault]

  it "Supports pure functions in 3.2" . runTest $ do
    runBS
      [r|

contract qq {
    function f(uint a, uint b) public pure returns (uint) {
        return a * (b + 42);
    }
}
|]
    getAll [[Field "a"], [Field "b"]] `shouldReturn` [BDefault, BDefault]

  it "can write pure and view functions" . runTest $ do
    runBS
      [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    return (x * y) / 6;
  }
}
|]
    getAll [[Field "a"], [Field "b"]] `shouldReturn` [BDefault, BDefault]

  it "error when reading from contract state in a pure function" $
    ( runTest $
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "error when writing to contract state from a pure or view function" $
    ( runTest $
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    x = y;
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    x = y;
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "error when using assembly code from a pure or view function" $
    ( runTest $
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
  function g(uint y) view returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can resolve state variables inherited from a contract" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract qq is A {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "can resolve state variables from multiple layers of inheritance" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B is A {
}
contract qq is B {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "can inherit from multiple contracts" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B {
  uint y = 9;
}
contract qq is A, B {
  function f() {
    x = 8;
    y = 10;
  }
}
|]
    getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 7, BInteger 9]

  it "error when referencing a state variable from a non-inherited contract" $
    ( runTest $
        runBS
          [r|

contract A {
  uint x = 7;
}
contract B {
  function f() {
    x = 8;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  -- start of 3.2 tests

  it "can write pure and view functions" . runTest $ do
    runBS
      [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    return (x * y) / 6;
  }
}
|]
    getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 5, BDefault]

  it "Warns when reading from contract state in a pure function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "Warns when writing to contract state from a pure or view function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    x = y;
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    x = y;
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "warns when using assembly code from a pure or view function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
  function g(uint y) view returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can resolve state variables inherited from a contract" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract qq is A {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "can resolve state variables from multiple layers of inheritance" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B is A {
}
contract qq is B {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "can inherit from multiple contracts" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B {
  uint y = 9;
}
contract qq is A, B {
  function f() {
    x = 8;
    y = 10;
  }
}
|]
    getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 7, BInteger 9]

  it "can detect when referencing a state variable from a non-inherited contract" $
    ( runTest $
        runBS
          [r|

contract A {
  uint x = 7;
}
contract B {
  function f() {
    x = 8;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can't write pure and view functions in solidvm 3.2" . runTest $ do
    runBS
      [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    return (x * y) / 6;
  }
}
|]
    getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 5, BDefault]

  it "Warns when reading from contract state in a pure function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "Warns when writing to contract state from a pure or view function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    x = y;
    return (7 * y) / 6;
  }
  function g(uint y) view returns (uint) {
    x = y;
    return (x * y) / 6;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "Warns when using assembly code from a pure or view function" $
    ( runTest $ do
        runBS
          [r|

contract qq {
  uint x = 5;
  function f(uint y) pure returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
  function g(uint y) view returns (uint) {
    assembly {
      x := mload (add (x, 32))
    }
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can't resolve state variables inherited from a contract" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract qq is A {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "Can't resolve state variables from multiple layers of inheritance" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B is A {
}
contract qq is B {
  function f() {
    x = 8;
  }
}
|]
    getAll [[Field "x"]] `shouldReturn` [BInteger 7]

  it "Can't inherit from multiple contracts" . runTest $ do
    runBS
      [r|

contract A {
  uint x = 7;
}
contract B {
  uint y = 9;
}
contract qq is A, B {
  function f() {
    x = 8;
    y = 10;
  }
}
|]
    getAll [[Field "x"], [Field "y"]] `shouldReturn` [BInteger 7, BInteger 9]

  it "can detect when referencing a state variable from a non-inherited contract" $
    ( runTest $
        runBS
          [r|

contract A {
  uint x = 7;
}
contract B {
  function f() {
    x = 8;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can detect duplicate declarations" $
    ( runTest $
        runBS
          [r|

contract qq {
  function f(){
    uint x = 9;
    uint y = 4;
    uint x = 7;
  }
}
|]
    )
      `shouldThrow` anyTypeError

  it "Supports view functions" . runTest $ do
    runBS
      [r|

contract qq {
    function f(uint a, uint b) public view returns (uint) {
        return a * (b + 42);
    }
}
|]
    getAll [[Field "a"], [Field "b"]] `shouldReturn` [BDefault, BDefault]

  it "can return chainIdString in a simple manner" . runTest $ do
    runBS
      [r|
contract qq {
  string x;
  constructor() {
    x = this.chainIdString;
  }
}
|]
    getFields ["x"] `shouldReturn` [BString "0000000000000000000000000000000000000000000000000000000000000000"]

  it "View functions enforced in 3.4" $
    ( runTest $
        runBS
          [r|


contract qq {
    uint x = 10;
    function f(uint a, uint b) public view returns (uint) {
        x = 5;
        return a * (b + 42);
    }
    constructor () {
      f(1,2);
    }
}
|]
    )
      `shouldThrow` anyTypeError

  it "can make user defined types" . runTest $ do
    runBS
      [r|
      type MagicInt is int;
      type NagicIn is uint;

      contract B {
        uint ggg =  NagicIn.unwrap(NagicIn.wrap(3));
        MagicInt myInt;
        int public regularInt;

        constructor() {
            myInt = MagicInt.wrap( 1+ 1+ 1); //creates defined type using wrap function
            regularInt = MagicInt.unwrap(myInt); // turn userDefined type back into underlying type
        }

        function foo() returns (MagicInt) { return  MagicInt.wrap(2);}
      }

  contract qq {
    B b =  new B();
    int a;
    int funcB;
    MagicInt temp;
    int temp2;

    constructor() {
        a = b.regularInt();
        funcB = MagicInt.unwrap(b.foo()) + MagicInt.unwrap(b.foo());
        temp = b.foo();
        temp2 =  MagicInt.unwrap( MagicInt.wrap( MagicInt.unwrap(b.foo()) + MagicInt.unwrap(b.foo())  ));
    }
  }

|]
    getFields ["funcB", "temp2", "a", "temp"] `shouldReturn` [BInteger 4, BInteger 4, BInteger 3, BInteger 2]

  it "cant infinite loop" $
    ( runTestWithTimeout 60000000 $
        runBS
          [r|

contract qq {
  uint x = 3;
  constructor() public returns () {
    while (true) {
      x = x + 1;
    }
  }
}   |]
    )
      `shouldThrow` anyTooMuchGasError

  it "cant infinite loop through a different contract" $
    ( runTestWithTimeout 60000000 $
        runBS
          [r|


contract A {
  uint x = 3;
  function f() public returns () {
    while (true) {
      x = x + 1;
    }
  }
}

contract qq {
  constructor() public returns () {
    A a = new A();
    a.f();
    return;
  }
}   |]
    )
      `shouldThrow` anyTooMuchGasError

  it "can use the record identifier to signify this mapping should be indexed in cirrus" . runTest $ do
    runBS
      [r|
contract qq {
  string x;
  mapping(string => uint) record myMap;
  constructor() {
    x = this.chainIdString;
    myMap["seven"] = 7;
  }
}
|]
    getFields ["x"] `shouldReturn` [BString "0000000000000000000000000000000000000000000000000000000000000000"]

  it "can use using statement" . runTest $ do
    runBS
      [r|

library SafeMath {
  function add(uint a, uint b) returns (uint) {
    return a + b;
  }
}
contract qq {
  using SafeMath for uint;
  function useUsing(uint _x) returns (uint) {
    return _x.add(1);
  }
  uint x = useUsing(3);
}
|]
    getFields ["x"] `shouldReturn` [BInteger 4]
    
  it "can use libraries" . runTest $ do
    runBS
      [r|

library SafeMath {
  function add(uint a, uint b) returns (uint) {
    return a + b;
  }
}
contract qq is SafeMath {
  function useUsing(uint _x) returns (uint) {
    return add(_x,1);
  }
  uint x = useUsing(3);
}
|]
    getFields ["x"] `shouldReturn` [BInteger 4]

  it "can use virtual and override" . runTest $ do
    runBS
      [r|

contract Parent {
  uint x = 7;
  function myVirtualFunc() virtual {
    x = 8;
  }
}

contract qq is Parent {
  function myVirtualFunc() override {
    x = 9;
  }
  constructor() {
    myVirtualFunc();
  }
}
|]
    getFields ["x"] `shouldReturn` [BInteger 9]

  it "can parse variadic arguments" . runTest $ do
    runBS
      [r|
contract qq {
  uint x = 1;
  uint y = 2;
  string z = "hi";
  uint zz = 3;

  function myVariadic(variadic args) {
    x = 2;
  }

  function myVariadic2(variadic args) {
    y = 3;
  }

  function myVariadic3(string f, uint i, variadic args) {
    z = f;
    zz = i;
  }

  constructor() {
    myVariadic();
    myVariadic2(1, 2, 3, 4, 5);
    myVariadic3("bye", 10, 55, 66, 77);
  }
}|]
    getFields ["x", "y", "z", "zz"] `shouldReturn` [BInteger 2, BInteger 3, BString "bye", BInteger 10]

  it "can handle parsing invalid variadic signatures - more than 1 variadic parameter" $
    runTest
      ( runBS
          [r|
contract qq {
    function badVariadic (uint a, variadic b, variadic c) {}
}|]
      )
      `shouldThrow` anyParseError

  it "can handle parsing invalid variadic signatures - misplaced variadic parameter" $
    runTest
      ( runBS
          [r|
contract qq {
  function badVariadic (uint a, variadic b, string c) {}
}|]
      )
      `shouldThrow` anyParseError

  it "can use create and create2 built-in function calls" . runTest $ do
    runBS
      [r|
pragma builtinCreates;

contract qq {
  account a;
  account b;

  constructor() {
    a = create("A", "contract A {\n uint x = 1;\n string y;\n constructor (uint _x, string _y) {\n  x = _x;\n  y = _y;\n }\n}", "(3, 'hi')");
    b = create2("salt", "B", "contract B {\n uint x = 2;\n constructor (uint _x) {\n  x = _x;\n }\n}", "(4)");
  }
}|]
    getFields ["b"]
      `shouldReturn` [BAccount $ NamedAccount (deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "salt" (Just . hash $ BC.pack "contract B {\n uint x = 2;\n constructor (uint _x) {\n  x = _x;\n }\n}") (Just "OrderedVals [SInteger 4]")) UnspecifiedChain]
    [BAccount a] <- getFields ["a"]
    [BAccount b] <- getFields ["b"]
    getSolidStorageKeyVal' (namedAccountToAccount Nothing a) (singleton "x") `shouldReturn` BInteger 3
    getSolidStorageKeyVal' (namedAccountToAccount Nothing a) (singleton "y") `shouldReturn` BString "hi"
    getSolidStorageKeyVal' (namedAccountToAccount Nothing b) (singleton "x") `shouldReturn` BInteger 4

  it "should throw an error when using create built-in function call while missing a parameter" $
    runTest
      ( runBS
          [r|
contract qq {
  account a;

  constructor() {
    a = create("contract A {\n uint x = 1;\n string y;\n constructor (uint _x, string _y) {\n  x = _x;\n  y = _y;\n }\n}", "(3, 'hi')");
  }
}|]
      )
      `shouldThrow` anyTypeError

  it "should throw an error when using create built-in function call while contract name is empty " $
    runTest
      ( runBS
          [r|
contract qq {
  account a;

  constructor() {
    a = create("", "contract A {\n uint x = 1;\n string y;\n constructor (uint _x, string _y) {\n  x = _x;\n  y = _y;\n }\n}", "(3, 'hi')");
  }
}|]
      )
      `shouldThrow` anyInvalidArgumentsError

  it "should throw an error when using create built-in function call while contract src is empty " $
    runTest
      ( runBS
          [r|
contract qq {
  account a;

  constructor() {
    a = create("A", "", "(3, 'hi')");
  }
}|]
      )
      `shouldThrow` anyInvalidArgumentsError

  it "should throw an error when using create built-in function call while contract name is not in the src " $
    runTest
      ( runBS
          [r|
contract qq {
  account b;

  constructor() {
    b = create("B", "contract A {\n uint x = 1;\n string y;\n constructor (uint _x, string _y) {\n  x = _x;\n  y = _y;\n }\n}", "(3)");
  }
}|]
      )
      `shouldThrow` anyMissingTypeError

  it "can index access a contract array returned from a function" . runTest $ do
      runBS [r|
contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }

  function get() returns (uint[]) {
    return x;
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.get()[0];
  }
}
|]
      getFields ["b"] `shouldReturn` [BInteger 8]

  it "can multidimensional index access a contract array returned from a function" . runTest $ do
      runBS [r|
contract SomeContract {
  uint[][] public x;
  constructor() public {
    x.push([1,2]);
    x.push([3,4]);
  }

  function get() returns (uint[][]) {
    return x;
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.get()[0][0];
  }
}
|]
      getFields ["b"] `shouldReturn` [BInteger 1]
  
  it "can't index access a contract array from the builtin getter" $ runTest ( do
      runBS [r|
contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.x()[0];
  }
}
|]) `shouldThrow` anyTypeError

  it "can test array index access by passing in as a parameter" . runTest $ do
      runBS [r|
contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.x(0);
  }
}
|]
      getFields ["b"] `shouldReturn` [BInteger 8]

  it "can test multidimensional array index access by passing in as a parameter" . runTest $ do
      runBS [r|
contract SomeContract {
  uint[][] public x;
  constructor() public {
    x.push([1,2]);
    x.push([3,4]);
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.x(1,0);
  }
}
|]
      getFields ["b"] `shouldReturn` [BInteger 3]
    
  it "can't access a contract array without any parameters" $ runTest ( do
      runBS [r|
contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.x();
  }
}
|]) `shouldThrow` anyTypeError

  it "can't access a contract array without any parameters and also using braces" $ runTest ( do
      runBS [r|
contract SomeContract {
  uint[] public x;
  constructor() public {
    x.push(8);
  }
}

contract qq {
  uint b;
  constructor() {
      SomeContract p = new SomeContract();
      b = p.x()[0];
  }

}
|]) `shouldThrow` anyTypeError

  it "can delete arrays and indexes values" $ runTest ( do
      runBS [r|
contract qq {
  uint[] arr = [1,2,3,4];
  uint[] arr2 = [5,6,7,8];
  uint res;
  string xyz = "Hello SolidVM";
  bool b = true;
  uint yy = 36;
  constructor() {
    delete arr[1];
    res = arr[1]; // to extract in getFields

    delete arr2;
    delete xyz;
    delete b;
  }
}|]
      getFields ["res", "arr2"] `shouldReturn` [BDefault, BDefault]) 

  it "can error handle using delete keyword on local variables" $ runTest ( do
      runBS [r|
contract qq {
  constructor() {
    string xyz = "Hello SolidVM";
    bool b = true;
    uint yy = 36;

    delete xyz;
    delete b;
    delete yy;
  }
}|]) `shouldThrow` anyTODO 

  it "can successfully use the 'blockhash' built-in" $ runTest ( do 
    runBS [r|
contract qq {
  string hsh = blockhash(block.number);
  constructor() {}
}|]
    getFields ["hsh"] `shouldReturn` [BString $ keccak256ToByteString $ unsafeCreateKeccak256FromWord256 0x0])

  it "can error handle the 'blockhash' built-in - less than 0 argument" $ runTest ( do 
    runBS [r|
contract qq {
  string hsh = blockhash(-1);
  constructor() {}
}|]) `shouldThrow` anyInvalidArgumentsError

  it "can error handle the 'blockhash' built-in - non-existent block number" $ runTest ( do 
    runBS [r|
contract qq {
  string hsh = blockhash(900000);
  constructor() {}
}|]) `shouldThrow` anyInvalidArgumentsError

  it "can use decimal numbers" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 1.123123;
  decimal negativeX = -1.123123;
  decimal y = 0.0000003;
  decimal z;
  decimal copyOfX;
  decimal funcResult;
  decimal[] decimalArray;
  decimal elementOne;
  decimal elementTwo;
  
  constructor() {
    copyOfX = x;
    funcResult = test(x);
    decimalArray.push(3.2);
    decimalArray.push(2.1);
    elementOne = decimalArray[0];
    elementTwo = decimalArray[1];
  }

  function test(decimal _x) returns (decimal) {
    return _x;
  }
}
|]
    getFields ["x", "negativeX", "y", "z", "copyOfX", "funcResult", "elementOne", "elementTwo"]
      `shouldReturn` [BDecimal "1.123123",
                      BDecimal "-1.123123",
                      BDecimal "0.0000003",
                      BDefault,
                      BDecimal "1.123123",
                      BDecimal "1.123123",
                      BDecimal "3.2",
                      BDecimal "2.1"
                    ])

  it "can use decimal numbers with arithmetic operators" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 1.123123;
  decimal y = 2.0;
  decimal sum;
  decimal diff;
  decimal product;
  decimal quotient;
  decimal negative;

  constructor() {
    sum = x + y;
    diff = x - y;
    product = x * y;
    quotient = x / y;
    negative = -y;
  }
}
|]
    getFields ["x", "y", "sum", "diff", "product", "quotient", "negative"] 
      `shouldReturn` [BDecimal "1.123123",
                      BDecimal "2.0",
                      BDecimal "3.123123",
                      BDecimal "-0.876877",
                      BDecimal "2.246246",
                      BDecimal "0.5615615",
                      BDecimal "-2"
                     ])

  it "can use decimal numbers with assignment operators" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 2.0;
  decimal sum = 3.3;
  decimal diff = 3.3;
  decimal product = 3.3;
  decimal quotient = 3.3;

  constructor() {
    sum += x;
    diff -= x;
    product *= x;
    quotient /= x;
  }
}
|]
    getFields ["x", "sum", "diff", "product", "quotient"] 
      `shouldReturn` [BDecimal "2.0",
                      BDecimal "5.3",
                      BDecimal "1.3",
                      BDecimal "6.6",
                      BDecimal "1.65"
                     ])

  it "can use decimal literals in expressions" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 2;
  decimal sum;
  decimal sumTwo;
  decimal sumThree;
  decimal diff;
  decimal diffTwo;
  decimal product;
  decimal productTwo;
  decimal quotient;
  decimal quotientTwo;
  decimal quotientThree;

  constructor() {
    sum = x + 3.3;
    sumTwo = 1.0 + 3.3;
    sumThree += 2.8;
    diff = x - 1.2;
    diffTwo = 3.3 - 1.2;
    product = x * 3.2;
    productTwo = -1.2 * 2.3;
    quotient = x / 2.3;
    quotientTwo = 4.6 / 2.3;
    quotientThree = quotientTwo / 0.32;
  }
}
|]
    getFields ["x", "sum", "sumTwo", "sumThree", "diff", "diffTwo", "product", "productTwo", "quotient", "quotientTwo", "quotientThree"] 
      `shouldReturn` [BInteger 2,
                      BDecimal "5.3",
                      BDecimal "4.3",
                      BDecimal "2.8",
                      BDecimal "0.8",
                      BDecimal "2.1",
                      BDecimal "6.4",
                      BDecimal "-2.76",
                      BDecimal "0.869565217391304347826086956521739130434782608695652173913043478260869565217391304347826086956521739130434782608695652173913043478260869565217391304347826086956521739130434782608695652173913043478260869565217391304347826086956521739130434782608695652173913",
                      BDecimal "2",
                      BDecimal "6.25"
                     ])

  it "can use comparison operators with decimal numbers" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 2.1;
  decimal y = 3.2;
  bool testOne;
  bool testTwo;
  bool testThree;
  bool testFour;
  bool testFive;
  bool testSix;

  constructor() {
    testOne = x <= y;
    testTwo = x < y;
    testThree = x == y;
    testFour = x != y;
    testFive = x >= y;
    testSix = x > y;
  }
}
|]
    getFields ["x", "y", "testOne", "testTwo", "testThree", "testFour", "testFive", "testSix"] 
      `shouldReturn` [BDecimal "2.1",
                      BDecimal "3.2",
                      BBool True,
                      BBool True,
                      BDefault,
                      BBool True,
                      BDefault,
                      BDefault
                     ])

  it "cannot divide by zero using decimal numbers" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;

  constructor() {
    x = 3.0 / 0.0;
  }
}
|])
    `shouldThrow` anyDivideByZeroError

  it "can do arithmetics with decimal and integer literals" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;

  constructor() {
    x = 3.2 + 6 + 6.2;
  }
}
|]
    getFields ["x"] 
      `shouldReturn` [BDecimal "15.4"])

  it "cannot use int without casting in arithmetic expressions involving decimals" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;
  uint y = 6;

  constructor() {
    x = 5.2 + y;
  }
}
|])
    `shouldThrow` anyTypeError

  it "can use int with casting in arithmetic expressions involving decimals" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;
  uint y = 6;

  constructor() {
    x = 5.2 + decimal(y);
  }
}
|]
    getFields ["x"]
      `shouldReturn` [BDecimal "11.2"])

  it "can cast string to decimal" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;

  constructor() {
    x = decimal("3.5");
  }
}
|]
    getFields ["x"]
      `shouldReturn` [BDecimal "3.5"])

  it "should throw an error when casting bad string to decimal" $ runTest ( do
    runBS [r|
contract qq {
  decimal x;

  constructor() {
    x = decimal("hey");
  }
}
|]) `shouldThrow` anyTypeError


  it "can externally return decimals" . runTest $ do
    runCall'
      "f"
      "()"
      [r|
contract qq {
  function f() returns (decimal) {
    decimal k = 0.5;
    return k;
  }
}|]
      `shouldReturn` Just "(0.5)"
      
  it "can use decimal numbers with the modulo operator" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 1.123123;
  decimal y = 2.0;
  decimal modulo;

  constructor() {
    modulo = x % y;
  }
}
|]
    getFields ["x", "y", "modulo"] 
      `shouldReturn` [BDecimal "1.123123",
                      BDecimal "2.0",
                      BDecimal "1.123123"])
--test for modulo 
  it "can use different numbers with the modulo operator" $ runTest ( do
    runBS [r|
contract qq {
  decimal xDec = 5.75;
  decimal yDec = 1.5;
  decimal moduloDec;

  int xInt = 7;
  int yInt = 3;
  int moduloInt;

  constructor() {
    moduloDec = xDec % yDec;
    moduloInt = xInt % yInt;
  }
}
|]
    getFields ["xDec", "yDec", "moduloDec", "xInt", "yInt", "moduloInt"] 
      `shouldReturn` [BDecimal "5.75",
                      BDecimal "1.5",
                      BDecimal "1.25",
                      BInteger 7,
                      BInteger 3,
                      BInteger 1])
--test for modulo assign                      
  it "can use different numbers with the modulo assign operator" $ runTest ( do
    runBS [r|
contract qq {
  decimal xDec = 5.75;
  decimal yDec = 1.5;
  decimal moduloDec;

  int xInt = 7;
  int yInt = 3;
  int moduloInt;

  constructor() {
    xDec %= yDec;
    xInt %= yInt;
    moduloDec = xDec;
    moduloInt = xInt;
  }
}
|]
    getFields ["xDec", "yDec", "moduloDec", "xInt", "yInt", "moduloInt"] 
      `shouldReturn` [BDecimal "1.25",
                      BDecimal "1.5",
                      BDecimal "1.25",
                      BInteger 1,
                      BInteger 3,
                      BInteger 1])
                      
  it "can cast decimals to int or uint" $ runTest ( do
    runBS [r|
contract qq {
  decimal x = 5.2;
  uint y;
  int z;

  constructor() {
    y = uint(x);
    z = int(x);
  }
}
|]
    getFields ["y", "z"]
      `shouldReturn` [BInteger 5, BInteger 5])

  it "can't assign decimals to int or uint" $ runTest ( do
    runBS [r|
contract qq {
  constructor() {
    int d = 5.5 + 5;
  }
}
|]) `shouldThrow` anyTypeError

  it "respects the number of decimal places during arithmetic operations" $ runTest ( do
    runBS [r|
pragma solidvm 11.4;
contract qq {
  decimal a;
  decimal b;
  decimal c;
  decimal d;
  decimal e;
  decimal f;
  decimal g;
  decimal h;
  decimal i;
  decimal j;

  constructor() {
    a = 1 + 1;
    b = 1 + 1.0;
    c = 1 - 0.1;
    d = 1 - 0.10;
    e = 1 * 2.00;
    f = 1.0 * 2.00;
    g = 3.14159 * 2.5;
    h = 1.0 / 3;
    i = 1.00 / 3;
    j = 1 / 3;
  }
}
|]
    getFields ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
      `shouldReturn` [BInteger 2, 
                      BDecimal "2.0",
                      BDecimal "0.9",
                      BDecimal "0.90",
                      BDecimal "2.00",
                      BDecimal "2.00",
                      BDecimal "7.85398",
                      BDecimal "0.3",
                      BDecimal "0.33",
                      BDefault])

  it "can use built-in truncate functions on decimals" $ runTest ( do
    runBS [r|
pragma solidvm 11.4;
contract qq {
  decimal a = 5.2825;
  decimal b = 5.2825;
  decimal c;
  decimal d;
  decimal e;
  decimal f;
  uint g = 1;

  constructor() {
    a = a.truncate(3);
    b = b.truncate(g);
    c = decimal(3.256).truncate(2);
    d = decimal(6.27).truncate(g);
    e = decimal(3.24).truncate(5);
    f = decimal(3.24).truncate(300);
  }
}
|]
    getFields ["a", "b", "c", "d", "e", "f"]
      `shouldReturn` [BDecimal "5.282", 
                      BDecimal "5.2", 
                      BDecimal "3.25", 
                      BDecimal "6.2",
                      BDecimal "3.24000",
                      BDecimal "3.24000000000000000000000000000000000000000000"])

  it "can error handle improperly referenced overloaded contracts" $ runTest ( do 
    let getAddressFromResult :: ExecResults -> Maybe Address 
        getAddressFromResult res = _accountAddress <$> erNewContractAccount res

    res <- runBS' [r|
pragma safeExternalCalls;
contract qq {
    bool public myVal;

    function changeMyVal(bool b){
        myVal = b;
    }
}|]

    case getAddressFromResult res of
      Nothing -> error "No address returned"
      Just address -> runCall' "changeMyValOfTest" (T.pack $ "(0x"++ formatAddressWithoutColor address ++", 3 )" ) [r|
contract Test {
    int public myVal;

    function changeMyVal(int b){
        myVal = b;
    }
}
contract qq {
    function changeMyValOfTest(address a, int v) returns (int) {
        Test(a).changeMyVal(v);
        return Test(a).myVal();
    }
}|]) `shouldThrow` anyTypeError

  it "can use es6 imports with solidvm 11.4 pragma" $ runTest ( do
    runBS [r|
pragma solidvm 11.4;
import { someFunc } from <123>;

contract qq {
  int x = 0;

  constructor() {
    x = 5;
  }
}
|]) `shouldThrow` specificTypeError "\"Could not find file <0000000000000000000000000000000000000123>\""

  it "can use strict modifiers with solidvm 11.4 pragma" $ runTest ( do
    runBS [r|
pragma solidvm 11.4;

contract A {
  int y = 5;
  
  function getY() private returns (int) {
    return y;
  }
}

contract qq is A {
  A a = new A();
  int x = 0;

  constructor() {
    x = a.getY();
  }
}
|]) `shouldThrow` specificTypeError "\" (line 17, column 9) - (line 17, column 10): \\\"Missing label: ABottom ( (line 17, column 9) - (line 17, column 10): \\\\\\\"cannot access function getY because it is marked as private\\\\\\\"  :| []) is not a known enum, struct, or contract.\\\" \""

  it "can use create and create2 built-in function calls with solidvm 11.4 pragma" . runTest $ do
    runBS
      [r|
pragma solidvm 11.4;

contract qq {
  account a;
  account b;

  constructor() {
    a = create("A", "contract A {\n uint x = 1;\n string y;\n constructor (uint _x, string _y) {\n  x = _x;\n  y = _y;\n }\n}", "(3, 'hi')");
    b = create2("salt", "B", "contract B {\n uint x = 2;\n constructor (uint _x) {\n  x = _x;\n }\n}", "(4)");
  }
}|]
    getFields ["b"]
      `shouldReturn` [BAccount $ NamedAccount (deriveAddressWithSalt (stringAddress "e8279be14e9fe2ad2d8e52e42ca96fb33a813bbe") "salt" (Just . hash $ BC.pack "contract B {\n uint x = 2;\n constructor (uint _x) {\n  x = _x;\n }\n}") (Just "OrderedVals [SInteger 4]")) UnspecifiedChain]
    [BAccount a] <- getFields ["a"]
    [BAccount b] <- getFields ["b"]
    getSolidStorageKeyVal' (namedAccountToAccount Nothing a) (singleton "x") `shouldReturn` BInteger 3
    getSolidStorageKeyVal' (namedAccountToAccount Nothing a) (singleton "y") `shouldReturn` BString "hi"
    getSolidStorageKeyVal' (namedAccountToAccount Nothing b) (singleton "x") `shouldReturn` BInteger 4

  it "can error handle improperly referenced overloaded contracts using solidvm 11.4 pragma" $ runTest ( do 
    let getAddressFromResult :: ExecResults -> Maybe Address 
        getAddressFromResult res = _accountAddress <$> erNewContractAccount res

    res <- runBS' [r|
pragma solidvm 11.4;
contract qq {
    bool public myVal;

    function changeMyVal(bool b){
        myVal = b;
    }
}|]

    case getAddressFromResult res of
      Nothing -> error "No address returned"
      Just address -> runCall' "changeMyValOfTest" (T.pack $ "(0x"++ formatAddressWithoutColor address ++", 3 )" ) [r|
contract Test {
    int public myVal;

    function changeMyVal(int b){
        myVal = b;
    }
}
contract qq {
    function changeMyValOfTest(address a, int v) returns (int) {
        Test(a).changeMyVal(v);
        return Test(a).myVal();
    }
}|]) `shouldThrow` anyTypeError

  it "can access maps" $ runTest ( do
    runBS [r| 

contract Map {
  mapping(uint => uint) public myMap;

  constructor(uint i) {
      myMap[i] = i;
  }
}

contract qq {
  address map;
  uint x;
  constructor() {
      uint i = 5;
      Map m = new Map(i);
      map = address(m);
      x = Map(map).myMap(i);
  }
}
|]
    getFields ["x"]
      `shouldReturn` [BInteger 5])
