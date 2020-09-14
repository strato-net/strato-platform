{-# LANGUAGE Arrows              #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE Rank2Types          #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}

module BlockApps.Bloc22.Server.Users (
  getBlocTransactionResult,
  postBlocTransactionResults,
  getBatchBlocTransactionResult',
  getBlocTransactionResult',
  forStateT
  ) where

import           Control.Concurrent
import           Control.Arrow
import           Control.Lens                      hiding (from, ix)
import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Trans.State.Lazy
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.ByteString.Short             (fromShort)
import           Data.Either
import           Data.Int                          (Int32)
import           Data.List                         (sortOn)
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Data.Traversable
import           Text.Format
import           UnliftIO

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi
import qualified BlockApps.Solidity.Xabi.Type      as Xabi
import           BlockApps.SolidityVarReader
import           BlockApps.XAbiConverter
import           Blockchain.Data.DataDefs
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.SQL

data TRD = TRD -- transaction resolution data
  { trdStatus :: BlocTransactionStatus
  , trdHash   :: Keccak256
  , trdIndex  :: Integer
  , trdResult :: Maybe TransactionResult
  }

data BatchState = BatchState
  { _contractDetailsMap :: Map.Map ContractName ContractDetails
  , _functionXabiMap    :: Map.Map Int32 Xabi
  }
makeLenses ''BatchState


emptyBatchState :: BatchState
emptyBatchState = BatchState Map.empty Map.empty

-- getBlocTransactionResult' will return only one of the results
-- when multiple hashes are provided. This is a glass-half-full
-- function, and if one TX succeeds then the result is a success.
getBlocTransactionResult' :: (MonadIO m, MonadLogger m, HasBlocSQL m, HasSQL m) =>
                             [Keccak256] -> Bool -> m BlocTransactionResult
getBlocTransactionResult' [] _ = throwIO $ AnError "getBlockTransactionResult': no TX hashes"
getBlocTransactionResult' hashes@(txh:_) resolve =
  if resolve
    then do
      promises <- forM hashes $ \h -> async (getBlocTransactionResult h True)
      results <- mapM wait promises
      $logDebugLS "getBlockTransactionResult'/results" results
      case filter ((== Success) . blocTransactionStatus) results of
        (winner:_) -> return winner
        [] -> return $ head results
    else return $ BlocTransactionResult Pending txh Nothing Nothing

getBlocTransactionResult :: (MonadIO m, MonadLogger m, HasBlocSQL m, HasSQL m) =>
                            Keccak256 -> Bool -> m BlocTransactionResult
getBlocTransactionResult txHash resolve = fmap head $ postBlocTransactionResults resolve [txHash]


getBatchBlocTransactionResult' :: (MonadIO m, MonadLogger m, HasBlocSQL m,
                                   HasSQL m) =>
                                  [Keccak256] -> Bool -> m [BlocTransactionResult]
getBatchBlocTransactionResult' hashes resolve =
  if resolve
    then postBlocTransactionResults True hashes
    else return $ map (\h -> BlocTransactionResult Pending h Nothing Nothing) hashes

postBlocTransactionResults :: (MonadIO m, MonadLogger m, HasBlocSQL m,
                               HasSQL m) =>

                              Bool -> [Keccak256] -> m [BlocTransactionResult]
postBlocTransactionResults resolve hashes = recurseTRDs resolve hashes >>= evalAndReturn

recurseTRDs :: (MonadLogger m, HasSQL m) =>
               Bool
            -> [Keccak256]
            -> m [TRD]
recurseTRDs resolve hashes = go 0 (toPending hashes)
  where
    go :: (MonadLogger m, HasSQL m) => Int -> [TRD] -> m [TRD]
    go num list = do
      let his = map (trdHash &&& trdIndex) list
      statusAndMtxrs <- flip zip his <$> getBatchBlocTxStatus (map fst his)
      let (pending', done) = partitionEithers $
                      flip map statusAndMtxrs
                        (\((s,r),(h,i)) ->
                          if s == Pending
                            then Left $ TRD s h i r
                            else Right $ TRD s h i r)
      pending <- if not resolve || null pending'
        then return pending'
        else
          if num >= 600
            then return pending'
            else do
              $logDebugLS "recurseTRDs/pending'" $ map (format . trdHash) pending'
              void . liftIO $ threadDelay 100000
              go (num + 1) pending'
      return $ merge pending done (\(TRD _ _ i _) (TRD _ _ j _) -> i < j)

    toPending :: [Keccak256] -> [TRD]
    toPending = zipWith (\i h -> TRD Pending h i Nothing) [0..]

    merge :: [a] -> [a] -> (a -> a -> Bool) -> [a]
    merge [] ps _ = ps
    merge ds [] _ = ds
    merge (d:ds) (p:ps) c =
      if c d p
        then (d : merge ds (p:ps) c)
        else (p : merge (d:ds) ps c)

forStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
forStateT s as = flip evalStateT s . for as


evalAndReturn :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                 [TRD] -> m [BlocTransactionResult]
evalAndReturn list = forStateT emptyBatchState list $
    \(TRD status txHash _ mtxr) -> case status of
        Pending -> return $ BlocTransactionResult Pending txHash Nothing Nothing
        Failure -> return $ BlocTransactionResult Failure txHash mtxr Nothing
        Success -> do
          (cmId,ttype,tdata)::(Int32,Int32,Text) <- lift $ blocQuery1 "evalAndReturn" $ contractByTxHash txHash
          case ttype of
            0 -> return $ BlocTransactionResult Success txHash mtxr (Just . Send . fromJust . Aeson.decode . BL.fromStrict $ Text.encodeUtf8 tdata)
            1 -> contractResult txHash mtxr cmId tdata
            2 -> functionResult txHash mtxr cmId tdata
            _ -> throwIO $ InternalError $ Text.pack $ "Unexpected transaction type: got" ++ show ttype

contractResult :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                  Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState m BlocTransactionResult
contractResult txHash mtxr cmId name = do
  let
    Just txResult = mtxr
    chainId = transactionResultChainId txResult
    addressMaybe = do
      str <- listToMaybe $
        Text.splitOn "," (Text.pack $ transactionResultContractsCreated txResult)
      stringAddress $ Text.unpack str
  case addressMaybe of
    Nothing -> case transactionResultMessage txResult of
      "Success!" -> do
        let mDelAddr = stringAddress . Text.unpack =<<
              (listToMaybe . Text.splitOn "," . Text.pack $ transactionResultContractsDeleted txResult)
        case mDelAddr of
          Just _ -> lift $ throwIO $ UserError "Contract failed to upload, likely because the constructor threw"
          Nothing -> lift $ throwIO $ UserError "Transaction succeeded, but contract was neither created, nor destroyed"
      stratoMsg  -> lift $ throwIO $ UserError $ Text.pack stratoMsg
    Just addr' -> do
      let cn = ContractName name
      mdetails <- use $ contractDetailsMap . at cn
      details <- case mdetails of
        Just details' -> return details'{contractdetailsAddress = Just addr'}
        Nothing -> do
          cds <- lift $ getContractDetailsByMetadataId cmId addr' (ChainId <$> chainId)
          contractDetailsMap . at cn <?= cds
      return $ BlocTransactionResult Success txHash mtxr (Just $ Upload details)

functionResult :: (MonadIO m, MonadLogger m, HasBlocSQL m) =>
                  Keccak256
               -> Maybe TransactionResult
               -> Int32
               -> Text
               -> StateT BatchState m BlocTransactionResult
functionResult txHash mtxr cmId funcName = do
  let Just txResult = mtxr
  mxabi <- use $ functionXabiMap . at cmId
  xabi <- case mxabi of
    Just xabi' -> return xabi'
    Nothing -> do
      xabi' <- lift $ getContractXabiByMetadataId cmId
      functionXabiMap . at cmId <?= xabi'
  let resultXabiTypes = maybe [] (Map.elems . funcVals) . Map.lookup funcName $ xabiFuncs xabi
      orderedResultIndexedXT = sortOn Xabi.indexedTypeIndex resultXabiTypes
  orderedResultTypes <- lift $
    for orderedResultIndexedXT $ \Xabi.IndexedType{..} ->
      either (throwIO . UserError . Text.pack) return $
        xabiTypeToType xabi indexedTypeType
  let mappedResultTypes = map convertEnumTypeToInt orderedResultTypes
      txResp = fromShort $ transactionResultResponse txResult
    -- TODO::(map convertEnumTypeToInt orderedResultTypes) is currenlty a
    -- workaround for enums
      mFormattedResponse = convertResultResToVals txResp mappedResultTypes
  case transactionResultMessage txResult of
    "Success!" -> do
      let r = Text.decodeUtf8 $ Base16.encode txResp
      formattedResponse <- lift $ blocMaybe ("Failed to parse response: " <> r) mFormattedResponse
      return $ BlocTransactionResult Success txHash mtxr (Just $ Call formattedResponse)
    stratoMsg  -> throwIO $ UserError $ Text.pack stratoMsg

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertResultResToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertResultResToVals byteResp responseTypes =
  map valueToSolidityValue <$> bytestringToValues byteResp responseTypes



