{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Transaction where

import           Control.Applicative                    ((<|>), liftA2)
import           Control.Monad
import           Control.Monad.Reader
import qualified Crypto.Secp256k1                       as S
import qualified Data.ByteString.Short                  as BSS
import           Data.Conduit
import           Data.Conduit.TQueue
import qualified Data.Map.Strict                        as Map
import           Data.Maybe
import           Data.Text                              (Text)
import qualified Data.Text                              as Text
import           Data.Word

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Chain
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import           BlockApps.Strato.Types                 hiding (Transaction (..))
import           Blockchain.Strato.Model.ExtendedWord   (Word256, bytesToWord256)
import           Blockchain.Strato.Model.Secp256k1
import           Strato.Strato23.Client
import           Strato.Strato23.API.Types

import           UnliftIO

mergeTxParams :: Maybe TxParams -> Maybe TxParams -> Maybe TxParams
mergeTxParams (Just inner) (Just outer) = Just $
  TxParams (txparamsGasLimit inner <|> txparamsGasLimit outer)
           (txparamsGasPrice inner <|> txparamsGasPrice outer)
           (txparamsNonce inner <|> txparamsNonce outer)
mergeTxParams inner outer = inner <|> outer

txWorker :: Bloc ()
txWorker = forever $ do
  tbqueue <- asks txTBQueue
  e <- try . runConduit $ sourceTBQueue tbqueue .| processTxs
  case e of
    Left (ex :: SomeException) -> $logErrorS "txWorker/error" . Text.pack $ show ex
    Right () -> error "txWorker returned a Right (). This should never happen. Please contact Simon Peyton Jones."
  where processTxs = awaitForever $ \(a,b,r,c) ->
          lift . void $ postBlocTransaction' (Do CacheNonce) a b r c

postBlocTransactionParallel :: Maybe Text
                            -> Maybe ChainId
                            -> Bool -- resolve
                            -> Bool -- queue
                            -> PostBlocTransactionRequest
                            -> Bloc [BlocChainOrTransactionResult]
postBlocTransactionParallel a b resolve queue c =
  if queue && not resolve
    then do
      tbqueue <- asks txTBQueue
      atomically $ writeTBQueue tbqueue (a,b,resolve,c)
      pure [] 
    else postBlocTransaction' (Do CacheNonce) a b resolve c

postBlocTransaction :: Maybe Text
                    -> Maybe ChainId
                    -> Bool
                    -> PostBlocTransactionRequest
                    -> Bloc [BlocChainOrTransactionResult]
postBlocTransaction = postBlocTransaction' (Don't CacheNonce)

postBlocTransaction' :: Should CacheNonce
                     -> Maybe Text
                     -> Maybe ChainId
                     -> Bool
                     -> PostBlocTransactionRequest
                     -> Bloc [BlocChainOrTransactionResult]
postBlocTransaction' cacheNonce mUserName chainId resolve (PostBlocTransactionRequest mAddr txs' txParams msrcs) = do
  case mUserName of
    Nothing -> throwIO $ UserError $ Text.pack "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> do
      addr <- case mAddr of
        Nothing -> fmap unAddress . blocVaultWrapper $ getKey userName Nothing
        Just addr' -> return addr'
      let getSrc p = contractpayloadSrc p <|> join (liftA2 Map.lookup (contractpayloadContract p) msrcs)
      fmap join . forM (partitionWith transactionType txs') $ \(ttype, txs) -> case ttype of
        TRANSFER -> case txs of
          [] -> return []
          [x] -> do
            p <- fromTransfer x
            let btp = TransferParameters
                        addr
                        (transferpayloadToAddress p)
                        (transferpayloadValue p)
                        (mergeTxParams (transferpayloadTxParams p) txParams)
                        (transferpayloadMetadata p)
                        (transferpayloadChainid p <|> chainId)
                        resolve
            fmap ((:[]) . BlocTxResult) $ postUsersSend' cacheNonce btp (callSignature userName)
          xs -> do
            p <- mapM fromTransfer xs
            let btlp = TransferListParameters
                        addr
                        (map (\(TransferPayload t v x c m) -> SendTransaction t v (mergeTxParams x txParams) c m) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersSendList' cacheNonce btlp (callSignature userName)
        CONTRACT -> case txs of
          [] -> return []
          [x] -> do
            p <- fromContract x
            let md = contractpayloadMetadata p
                bcp = ContractParameters
                        addr
                        (fromMaybe "" $ getSrc p)
                        (contractpayloadContract p)
                        (contractpayloadArgs p)
                        (contractpayloadValue p)
                        (mergeTxParams (contractpayloadTxParams p) txParams)
                        (contractpayloadMetadata p)
                        (contractpayloadChainid p <|> chainId)
                        resolve
                poster = case Map.lookup "VM" =<< md of
                            Nothing -> postUsersContractEVM'
                            Just "EVM" -> postUsersContractEVM'
                            Just "SolidVM" -> postUsersContractSolidVM'
                            Just vm -> \_ _ _ -> throwIO $ UserError $ Text.pack
                                               $ "Invalid value for VM choice: " ++ show vm
            fmap ((:[]) . BlocTxResult) $ poster cacheNonce bcp (callSignature userName)
          xs -> do
            ps <- mapM fromContract xs
            let bclp = ContractListParameters
                        addr
                        (map (\p@(ContractPayload _ c a v x cid m) ->
                                UploadListContract (fromJust c)
                                                   (getSrc p)
                                                   (fromMaybe Map.empty a)
                                                   (mergeTxParams x txParams)
                                                   v cid m) ps)
                        chainId
                        resolve
                md = contractpayloadMetadata $ head ps --Determine VM option by the metadata of the first tx in list
                poster = case Map.lookup "VM" =<< md of
                  Nothing -> postUsersUploadListEVM'
                  Just "EVM" -> postUsersUploadListEVM'
                  Just "SolidVM" -> postUsersUploadListSolidVM'
                  Just vm -> \_ _ _ -> throwIO $ UserError $ Text.pack
                                     $ "Invalid value for VM choice: " ++ show vm
            fmap BlocTxResult <$> poster cacheNonce bclp (callSignature userName)
        FUNCTION -> case txs of
          [] -> return []
          [x] -> do
            p <- fromFunction x
            let bfp = FunctionParameters
                        addr
                        ((\(ContractName c) -> c) $ functionpayloadContractName p)
                        (functionpayloadContractAddress p)
                        (functionpayloadMethod p)
                        (functionpayloadArgs p)
                        (functionpayloadValue p)
                        (mergeTxParams (functionpayloadTxParams p) txParams)
                        (functionpayloadMetadata p)
                        (functionpayloadChainid p <|> chainId)
                        resolve
            fmap ((:[]) . BlocTxResult) $ postUsersContractMethod' cacheNonce bfp (callSignature userName)
          xs -> do
            p <- mapM fromFunction xs
            let bflp = FunctionListParameters
                        addr
                        (map (\(FunctionPayload (ContractName n) a m r v x c md) ->
                                MethodCall n a m r (fromMaybe (Strung 0) v) (mergeTxParams x txParams) c md) p)
                        chainId
                        resolve
            fmap BlocTxResult <$> postUsersContractMethodList' cacheNonce bflp (callSignature userName)
        GENESIS -> case txs of
          [] -> return []
          xs -> do
            chainInputs <- traverse fromGenesis xs
            let hydrate p = p{ chaininputSrc = chaininputSrc p <|> join (liftA2 Map.lookup (chaininputContract p) msrcs) }
            fmap (fmap BlocChainResult) . postChainInfos $ hydrate <$> chainInputs
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwIO $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwIO $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwIO $ UserError "Could not decode function arguments from body"
        fromGenesis = \case
          BlocGenesis f -> return f
          _ -> throwIO $ UserError "Could not decode function arguments from body"


-- so we can convert R and S from the signature, and add 27 to V, per
-- Ethereum protocol (and backwards compatibility)
getSigVals :: Signature -> (Word256, Word256, Word8)
getSigVals (Signature (S.CompactRecSig r s v)) =
  let convert = bytesToWord256 . BSS.fromShort
  in (convert r, convert s, v + 0x1b)
 

callSignature :: Text -> UnsignedTransaction -> Bloc Transaction
callSignature userName unsigned@UnsignedTransaction{..} = do
  let msgHash = rlpHash unsigned
  sig <- blocVaultWrapper $ postSignature userName (MsgHash msgHash)
  let (r, s, v) = getSigVals sig
  return $ Transaction
    unsignedTransactionNonce
    unsignedTransactionGasPrice
    unsignedTransactionGasLimit
    unsignedTransactionTo
    unsignedTransactionValue
    unsignedTransactionInitOrData
    unsignedTransactionChainId
    v
    r
    s
    Nothing
