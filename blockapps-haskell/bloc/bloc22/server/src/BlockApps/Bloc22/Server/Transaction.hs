{-# LANGUAGE Arrows              #-}
{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Transaction where

import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Log
import           Crypto.Secp256k1                  (getMsg)
import           Data.Aeson                        hiding (Array, String)
import qualified Data.Aeson                        as Aeson
--import           Data.Aeson.Types
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.Int                          (Int32)
import           Data.LargeWord
import qualified Data.Map.Strict                   as Map
import qualified Data.Map.Ordered                  as OMap
import           Data.Maybe
import           Data.Monoid
import           Data.RLP
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Word
import           GHC.Generics
-- import           Network.HTTP.Simple
import           Opaleye                           hiding (not, null, index)

import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Solidity.Contract       as C
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types            hiding (Transaction (..))

-- data PostBlocTransactionRequest = PostBlocTransactionRequest
--   { postbloctransactionrequestTransactionType :: BlocTransactionType
--   , postbloctransactionrequestPayload         :: BlocTransactionPayload
--   , postbloctransactionrequestTxParams        :: Maybe TxParams
--   } deriving (Eq, Show, Generic)
-- 
-- postUsersSend :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendParameters -> Bloc BlocTransactionResult
-- postUsersContract :: UserName -> Address -> Maybe ChainId -> Bool -> PostUsersContractRequest -> Bloc BlocTransactionResult
-- postUsersUploadList :: UserName -> Address -> Maybe ChainId -> Bool -> UploadListRequest -> Bloc [BlocTransactionResult]
-- postUsersSendList :: UserName -> Address -> Maybe ChainId -> Bool -> PostSendListRequest -> Bloc [BlocTransactionResult]
-- postUsersCallList ::-> PostMethodListRequest
-- postUsersContractMethod :: -> PostUsersContractMethodRequest
-- data PostSendParameters = PostSendParameters
--   { sendToAddress :: Address
--   , sendValue     :: Strung Natural
--   , sendPassword  :: Password
--   , sendTxParams  :: Maybe TxParams
--   } deriving (Eq, Show, Generic)
-- data PostUsersContractRequest = PostUsersContractRequest
--   { postuserscontractrequestSrc      :: Text
--   , postuserscontractrequestPassword :: Password
--   , postuserscontractrequestContract :: Maybe Text
--   , postuserscontractrequestArgs     :: Maybe (Map Text ArgValue)
--   , postuserscontractrequestTxParams :: Maybe TxParams
--   , postuserscontractrequestValue    :: Maybe (Strung Natural)
--   } deriving (Eq,Show,Generic)
-- data UploadListRequest = UploadListRequest
--   { uploadlistPassword  :: Password
--   , uploadlistContracts :: [UploadListContract]
--   , uploadlistResolve   :: Bool
--   } deriving (Eq,Show,Generic)
-- data PostSendListRequest = PostSendListRequest
--   { postsendlistrequestPassword :: Password
--   , postsendlistrequestResolve  :: Bool
--   , postsendlistrequestTxs      :: [SendTransaction]
--   } deriving (Eq,Show,Generic)
-- data PostMethodListRequest = PostMethodListRequest
--   { postmethodlistrequestPassword :: Password
--   , postmethodlistrequestResolve  :: Bool
--   , postmethodlistrequestTxs      :: [MethodCall]
--   } deriving (Eq,Show,Generic)
-- data PostUsersContractMethodRequest = PostUsersContractMethodRequest
--   { postuserscontractmethodPassword :: Password
--   , postuserscontractmethodMethod   :: Text
--   , postuserscontractmethodArgs     :: Map Text ArgValue
--   , postuserscontractmethodValue    :: Maybe (Strung Natural)
--   , postuserscontractmethodTxParams :: Maybe TxParams
--   } deriving (Eq,Show,Generic)



postBlocTransaction :: Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc BlocTransactionResult
postBlocTransaction mUserName chainId resolve (PostBlocTransactionRequest _ payload txParams) = do
  case mUserName of
    Nothing -> error "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> do
      case payload of
        BlocContract c -> postContract userName chainId resolve txParams c
        BlocTransfer t -> postTransfer userName chainId resolve txParams t
        BlocFunction _ -> error "Unimplemented"

postContract :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> ContractPayload -> Bloc BlocTransactionResult
postContract userName chainId resolve mTxParams ContractPayload{..} = blocTransaction $ do
  txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
  idsAndDetails <- compileContract contractpayloadSrc
  logWith logNotice ("constructor arguments: " <> Text.pack (show contractpayloadArgs))
  (cmId,ContractDetails{..}) <-
    case contractpayloadContract of
      Nothing ->
        case Map.toList idsAndDetails of
          [] -> throwError $ UserError "You need to supply at least one contract in the source"
          [(_, x)] -> return x
          _ -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
      Just contract ->
        blocMaybe "Could not find global contract metadataId" $
        Map.lookup contract idsAndDetails
  let
    (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
  unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
  mFunctionId <- getConstructorId cmId
  argsBin <- buildArgumentByteString (fmap (fmap argValueToText) contractpayloadArgs) mFunctionId
  tx <- prepareTx' userName $
    TransactionHeader
      Nothing
      (Address 0x00)
      txParams
      (Wei (fromIntegral (maybe 0 unStrung contractpayloadValue)))
      (bin <> argsBin)
      0
      chainId
  logWith logNotice ("tx is: " <> Text.pack (show tx))
  hash <- blocStrato $ postTx tx
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant hash
    , constant cmId
    , constant (1 :: Int32)
    , constant contractdetailsName
    )]
  getBlocTransactionResult' chainId hash resolve

postTransfer :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> TransferPayload -> Bloc BlocTransactionResult
postTransfer userName chainId resolve mTxParams TransferPayload{..} = do
  txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
  tx <- prepareTx' userName $
    TransactionHeader
      (Just transferpayloadToAddress)
      (Address 0x00)
      txParams
      (Wei (fromIntegral $ unStrung transferpayloadValue))
      ByteString.empty
      0
      chainId
  hash <- blocStrato $ postTx tx
  void . blocModify $ \conn -> runInsertMany conn hashNameTable [
    ( Nothing
    , constant hash
    , constant (0 :: Int32)
    , constant (0 :: Int32)
    , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
    )]
  getBlocTransactionResult' chainId hash resolve

postFunctionCall :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> FunctionPayload -> Bloc BlocTransactionResult
postFunctionCall userName chainId resolve mTxParams
  (FunctionPayload (ContractName contractName) contractAddr funcName args value) = do
    txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
    cmId <- getContractsMetaDataIdExhaustive contractName contractAddr chainId

    contract' <- getContractContractByMetadataId cmId

    let maybeFunc = OMap.lookup funcName (fields $ C.mainStruct contract')
    sel <-
      case maybeFunc of
       Just (_, TypeFunction selector _ _) -> return selector
       _ -> throwError . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"
    functionId <- getFunctionId cmId funcName
    argsBin <- buildArgumentByteString (Just (fmap argValueToText args)) (Just functionId)
    tx <- prepareTx' userName $
      TransactionHeader
        (Just contractAddr)
        (Address 0x00)
        txParams
        (Wei (maybe 0 (fromIntegral . unStrung) value))
        ((sel::ByteString) <> (argsBin::ByteString))
        0
        chainId
    logWith logNotice ("tx is: " <> Text.pack (show tx))
    hash <- blocStrato $ postTx tx
    void . blocModify $ \conn -> runInsertMany conn hashNameTable [
      ( Nothing
      , constant hash
      , constant cmId
      , constant (2 :: Int32)
      , constant funcName
      )]
    getBlocTransactionResult' chainId hash resolve

prepareTx' :: Text -> TransactionHeader -> Bloc PostTransaction
prepareTx' userName txHeader = prepareSignedTx' userName (transactionheaderFromAddr txHeader) $ prepareUnsignedTx txHeader

prepareSignedTx'
  :: Text
  -> Address
  -> UnsignedTransaction
  -> Bloc PostTransaction
prepareSignedTx' userName addr unsignedTx = do
  tx <- signTransaction' userName unsignedTx
  let kecc = keccak256 (rlpSerialize tx)
      r = transactionR tx
      s = transactionS tx
      v = transactionV tx
      Gas gasLimit = transactionGasLimit tx
      Wei gasPrice = transactionGasPrice tx
      Nonce nonce' = transactionNonce tx
      Wei value = transactionValue tx
      code = Text.decodeUtf8 $ Base16.encode $ transactionInitOrData tx
      toAddr = transactionTo tx
      chainId = transactionChainId tx
  return $ PostTransaction
    { posttransactionHash = kecc
    , posttransactionGasLimit = fromIntegral gasLimit
    , posttransactionCodeOrData = code
    , posttransactionGasPrice = fromIntegral gasPrice
    , posttransactionTo = toAddr
    , posttransactionFrom = addr
    , posttransactionValue = Strung $ fromIntegral value
    , posttransactionR = Hex $ fromIntegral r
    , posttransactionS = Hex $ fromIntegral s
    , posttransactionV = Hex v
    , posttransactionNonce = fromIntegral nonce'
    , posttransactionChainId = chainId
    }

signTransaction' :: Text -> UnsignedTransaction -> Bloc Transaction
signTransaction' userName UnsignedTransaction{..} = do
  sig <- getRSV userName msgHash
  return $ Transaction
    { transactionNonce = unsignedTransactionNonce
    , transactionGasPrice = unsignedTransactionGasPrice
    , transactionGasLimit = unsignedTransactionGasLimit
    , transactionTo = unsignedTransactionTo
    , transactionValue = unsignedTransactionValue
    , transactionV = v sig
    , transactionR = unHex $ r sig
    , transactionS = unHex $ s sig
    , transactionInitOrData = unsignedTransactionInitOrData
    , transactionChainId = unsignedTransactionChainId
    }
  where
    msgHash = getMsg . rlpMsg . Array
      $ [ rlpEncode unsignedTransactionNonce
        , rlpEncode unsignedTransactionGasPrice
        , rlpEncode unsignedTransactionGasLimit
        , rlpEncode unsignedTransactionTo
        , rlpEncode unsignedTransactionValue
        , rlpEncode unsignedTransactionInitOrData
        ] ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)

getRSV :: Text -> ByteString -> Bloc SignatureDetails
getRSV _ _ = return $ SignatureDetails (Hex 0) (Hex 0) 0 -- do -- TODO: Actually call signature route
  -- let request = setRequestHeader "X-USER-UNIQUE-NAME" [Text.encodeUtf8 userName]
  --             $ setRequestBodyJSON msgHash
  --             $ "POST http://vault-wrapper:8000/strato/v2.3/signature"
  -- getResponseBody <$> httpJSON request

data SignatureDetails = SignatureDetails
  { r :: Hex Word256
  , s :: Hex Word256
  , v :: Word8
  } deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

