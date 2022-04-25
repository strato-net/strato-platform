{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}

module BlockApps.Bloc22.Database.Queries
  ( contractBySourceHash
  , insertContractSourceQuery
  , evmContractByCodeHash
  , evmCodeHashByName
  , insertEvmContractNameQuery
  , insertContractDetailsQuery
  , sourceToContractDetails
  , getContractDetailsForContract
  , getContractDetailsByCodeHash
  , evmContractSolidVMError
  ) where

import           Blockchain.Data.AddressStateDB  (AddressState, unsafeResolveCodePtrSelect)
import           Control.Arrow
import           Control.Monad
import qualified Control.Monad.Change.Alter      as A
import           Control.Monad.Logger
import           Control.Monad.Trans.Class       (lift)
import           Control.Monad.Trans.Except
import qualified Crypto.Saltine.Class            as Saltine
import qualified Crypto.Saltine.Core.SecretBox   as SecretBox
import           Data.Aeson                      (Result(..), fromJSON)
import           Data.ByteString                 (ByteString)
import qualified Data.ByteString                 as B
import qualified Data.Cache                      as Cache
import           Data.Either                     (fromRight)
import           Data.Foldable                   (for_)
import           Data.Map.Strict                 (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe
import           Data.Profunctor
import           Data.Profunctor.Product.Default
import           Data.RLP
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Data.Traversable                (for)
import           Opaleye                         hiding (not, null, index)
import           System.Clock
import           Text.Format
import           UnliftIO

import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Database.Solc
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.SolidityVarReader     (byteStringToWord256, word256ToByteString)
import           BlockApps.Solidity.Parse.Parser
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types hiding (Account(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Data.Source.Map

import           Control.Monad.Composable.BlocSQL
import           SQLM

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

contractBySourceHash
  :: (MonadLogger m, HasBlocSQL m)
  => Keccak256
  -> m (Maybe SourceMap)
contractBySourceHash srcHash = fmap (fmap deserializeSourceMap . listToMaybe) . blocQuery $ proc () -> do
  (_,sh,src) <- queryTable contractsSourceTable -< ()
  restrict -< sh .== constant srcHash
  returnA -< (src)

insertContractSourceQuery
  :: (MonadLogger m, HasBlocSQL m)
  => Keccak256
  -> SourceMap
  -> m ()
insertContractSourceQuery srcHash src' = do
  let src = serializeSourceMap src'
  void . blocModify $ \ conn ->
    runInsertMany conn contractsSourceTable [
      ( Nothing
      , constant srcHash
      , constant src
      )]

evmContractByCodeHash
  :: (MonadLogger m, HasBlocSQL m)
  => Keccak256
  -> m [(Text, Keccak256)]
evmContractByCodeHash codeHash = blocQuery $ proc () -> do
  (_,ch,name,sh) <- queryTable evmContractNameTable -< ()
  restrict -< ch .== constant codeHash
  returnA -< (name,sh)

evmCodeHashByName
  :: (MonadLogger m, HasBlocSQL m)
  => Text
  -> m [Keccak256]
evmCodeHashByName cName = blocQuery $ proc () -> do
  (_,ch,name,_) <- queryTable evmContractNameTable -< ()
  restrict -< name .== constant cName
  returnA -< ch

insertEvmContractNameQuery
  :: (MonadLogger m, HasBlocSQL m)
  => Keccak256
  -> Text
  -> Keccak256
  -> m ()
insertEvmContractNameQuery codeHash cName srcHash = do
  void . blocModify $ \ conn ->
    runInsertMany conn evmContractNameTable [
      ( Nothing
      , constant codeHash
      , constant cName
      , constant srcHash
      )]

insertContractDetailsQuery 
  :: (A.Alters Keccak256 SourceMap m)
  => SourceMap 
  -> m ()
insertContractDetailsQuery sourceList = 
  void $ insertQuery 
  where insertQuery = do
          let encodedSrc = serializeSourceMap sourceList
              srcHash    = hash (Text.encodeUtf8 encodedSrc)
    
          A.insert (A.Proxy @SourceMap) srcHash sourceList


getContractDetailsByCodeHash :: ( A.Selectable Account AddressState m
                                , (Keccak256 `A.Alters` SourceMap) m
                                , MonadLogger m
                                , HasBlocEnv m
                                , HasBlocSQL m
                                )
                             => CodePtr -> m (Either Text ContractDetails)
getContractDetailsByCodeHash codePtr = do
  srcCache <- fmap globalCodePtrCache getBlocEnv
  now <- liftIO $ getTime Monotonic
  let later = (now +) <$> Cache.defaultExpiration srcCache
  mCachedDetails <- atomically $ do
    Cache.purgeExpiredSTM srcCache now -- todo: this should probably go somewhere else, like a worker thread,
                                       --       but we need this to prevent the cache growing unboundedly
    r <- Cache.lookupSTM True codePtr srcCache now
    for_ r $ \v -> Cache.insertSTM codePtr v srcCache later -- refresh to timestamp of this item
    pure r

  runExceptT $ case mCachedDetails of
    Just cachedDetails -> pure cachedDetails
    Nothing -> do
      mDetails <- lift (unsafeResolveCodePtrSelect codePtr) >>= \mcp -> flip traverse mcp $ \codeHash -> do
        ~(shouldCompile, name, ch) <- case codeHash of
          EVMCode ch -> lift (evmContractByCodeHash ch) >>= \case
            [] -> throwE $ "Could not find EVM contract for code hash " <> Text.pack (format ch)
            ((name, sh):xs) -> do
              unless (null xs) $
                $logWarnS "getContractDetailsByCodeHash" . Text.pack $ concat
                  [ "Found multiple EVM contracts for code hash "
                  , format ch
                  , ". Picking first one from the list."
                  ]
              pure (Do Compile, name, sh)
          SolidVMCode name ch -> pure (Don't Compile, Text.pack name, ch)
          CodeAtAccount acct _ -> throwE $ "Could not resolve code at account " <> Text.pack (show acct)
        srcMap <- lift (A.lookup (A.Proxy @SourceMap) ch) >>= \case
          Nothing -> throwE $ "Could not find source code for code hash " <> Text.pack (format ch)
          Just s -> pure s
        detailsMap <- lift $ sourceToContractDetails shouldCompile srcMap
        case Map.lookup name detailsMap of
            Nothing -> throwE $ "Could not find contract " <> name <> " in code collection " <> Text.pack (format ch)
            Just d -> pure d
      case mDetails of
        Nothing -> throwE $ "Could not resolve code pointer " <> Text.pack (format codePtr)
        Just details -> do
          liftIO $ Cache.insert srcCache codePtr details
          pure details

evmContractSolidVMError :: Text
evmContractSolidVMError = Text.concat
  [ "Upload Contract (EVM): The given contracts were previously uploaded for "
  , "SolidVM. Please retry your request specifying SolidVM as the VM type. "
  , "If you are intending to use EVM, please modify your contracts and try again."
  ]

getContractDetailsForContract :: ( A.Selectable Account AddressState m
                                 , (Keccak256 `A.Alters` SourceMap) m
                                 , MonadLogger m
                                 , HasBlocEnv m
                                 , HasBlocSQL m
                                 )
                              => Text -> SourceMap -> Maybe Text -> m (Maybe (Text, ContractDetails))
getContractDetailsForContract theVM src mContract = do
  let shouldCompile = if theVM == "EVM" then Do Compile else Don't Compile
      cacheKey = (theVM, src)
  srcCache <- fmap globalSourceCache getBlocEnv
  now <- liftIO $ getTime Monotonic
  let later = (now +) <$> Cache.defaultExpiration srcCache
  mCachedDetails <- atomically $ do
    Cache.purgeExpiredSTM srcCache now -- todo: this should probably go somewhere else, like a worker thread,
                                       --       but we need this to prevent the cache growing unboundedly
    r <- Cache.lookupSTM True cacheKey srcCache now
    for_ r $ \v -> Cache.insertSTM cacheKey v srcCache later -- refresh to timestamp of this item
    pure r

  idsAndDetails <- case mCachedDetails of
    Just cachedDetails -> pure cachedDetails
    Nothing -> do
      details <- if hasAnyNonEmptySources src
                   then sourceToContractDetails shouldCompile src
                   else return Map.empty
      liftIO $ Cache.insert srcCache cacheKey details
      pure details
  case mContract of
    Nothing ->
      case Map.toList idsAndDetails of
        [] -> pure Nothing
        [x] -> Just <$> checkCodeHash x
        _ -> throwIO $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
    Just contract -> do
      x <- let srcStr = serializeSourceMap src
            in blocMaybe ("Could not find global contract metadataId for " <> contract <> " in source " <> srcStr)  (Map.lookup contract idsAndDetails)
      Just <$> checkCodeHash (contract, x)
  where checkCodeHash x@(_,cd) = case contractdetailsCodeHash cd of
          (EVMCode _) -> pure x
          (SolidVMCode _ _) -> case theVM of
            "EVM" -> throwIO $ UserError evmContractSolidVMError
            _ -> pure x
          c@(CodeAtAccount _ name) -> getContractDetailsByCodeHash c >>= \case
            Left e -> throwIO $ UserError e
            Right details -> pure (Text.pack name, details)
 
sourceToContractDetails :: ( (Keccak256 `A.Alters` SourceMap) m
                           , MonadLogger m
                           , HasBlocSQL m
                           )
                        => Should Compile -> SourceMap -> m (Map Text ContractDetails)
sourceToContractDetails shouldCompile sourceList =
  let createContractDetails =
        case shouldCompile of
          Do Compile -> compileContract
          Don't Compile -> createMetadataNoCompile
   in createContractDetails sourceList

compileContract :: ( (Keccak256 `A.Alters` SourceMap) m
                   , MonadLogger m
                   , HasBlocSQL m
                   )
                => SourceMap -> m (Map Text ContractDetails)
compileContract sourceList = do
  let source = sourceBlob sourceList
      eVerXabis = parseXabi "-" $ Text.unpack source
      encodedSrc = serializeSourceMap sourceList
      srcHash = hash (Text.encodeUtf8 encodedSrc)
  (ver, xabis) <- case eVerXabis of
    Left err -> blocError . UserError . Text.pack $ err
    Right (v, xs) -> return (v, Map.fromList xs)
  eabiBins <- fromJSON <$> compileSolc ver source
  abiBins <- case eabiBins of
    Error err -> blocError . UserError . Text.pack $ err
    -- Starting with 0.4.9, solc prepends a filename to abi keys.
    -- Bloc should too, but this change is easier :^)
    Success res -> return . Map.mapKeys (snd . Text.breakOnEnd ":") $ res
  --TODO - clean this up, what should filename be instead of "-"
  --       get rid of error
  --       name nicer, mabye merge with next let
  let contracts = Map.intersectionWith (,) xabis abiBins
  details <- for (Map.toList contracts) $ \ (contrName, (xabi,AbiBin{..})) -> do
    let ch = binRuntimeToCodeHash binRuntime
        cds = ContractDetails
          { contractdetailsBin = bin
          , contractdetailsAccount = Nothing
          , contractdetailsBinRuntime = binRuntime
          , contractdetailsCodeHash =  EVMCode ch
          , contractdetailsName = contrName
          , contractdetailsSrc = sourceList
          , contractdetailsXabi = xabi
          }
    insertEvmContractNameQuery ch contrName srcHash
    pure (contrName, cds)

  A.insert (A.Proxy @SourceMap) srcHash sourceList

  pure $ Map.fromList details

-- SolidVM only
createMetadataNoCompile :: ( MonadIO m
                           , MonadLogger m
                           )
                        => SourceMap -> m (Map Text ContractDetails)
createMetadataNoCompile sourceList = do
  let source = sourceBlob sourceList
      encodedSrc = serializeSourceMap sourceList
      eVerXabis = parseXabi "-" $ Text.unpack source
      srcHash = hash (Text.encodeUtf8 encodedSrc)
  xabis <- case eVerXabis of
    Left err -> blocError . UserError . Text.pack $ err
    Right (_, xs) -> return $ Map.fromList xs
  let contracts = xabis
      details = flip Map.mapWithKey contracts $ \ contrName (xabi) ->
        ContractDetails
        { contractdetailsBin = source
        , contractdetailsAccount = Nothing
        , contractdetailsBinRuntime = contrName `Text.append` source
        , contractdetailsCodeHash = SolidVMCode (Text.unpack contrName) srcHash
        , contractdetailsName = contrName
        , contractdetailsSrc = sourceList
        , contractdetailsXabi = xabi
        }

  pure details

instance QueryRunnerColumnDefault PGBytea Address where
  queryRunnerColumnDefault = queryRunnerColumn id
    (Address . bytesToWord160 . B.unpack)
    queryRunnerColumnDefault
instance Default Constant Address (Column PGBytea) where
  def = lmap getBytes def
    where
      getBytes (Address x) = B.pack . word160ToBytes $ x

instance QueryRunnerColumnDefault PGBytea SecretBox.Nonce where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode nonce") . Saltine.decode)
    queryRunnerColumnDefault
instance Default Constant SecretBox.Nonce (Column PGBytea) where
  def = lmap Saltine.encode def
instance Default Constant UserName (Column PGText) where
  def = lmap getUserName def

instance Default Constant StateMutability (Column PGText) where
  def = lmap tShow def

instance QueryRunnerColumnDefault PGText StateMutability where
  queryRunnerColumnDefault = queryRunnerColumn id
    (fromMaybe (error "could not decode mutability") . tRead)
    queryRunnerColumnDefault

instance QueryRunnerColumnDefault PGBytea Keccak256 where
  queryRunnerColumnDefault =
    queryRunnerColumn id toKecc queryRunnerColumnDefault
    where
      toKecc :: ByteString -> Keccak256
      toKecc
        = unsafeCreateKeccak256FromByteString

instance Default Constant Keccak256 (Column PGBytea) where
  def = lmap keccak256ToByteString def

instance QueryRunnerColumnDefault PGBytea CodePtr where
  queryRunnerColumnDefault =
    queryRunnerColumn id toCodePtr queryRunnerColumnDefault
    where
      toCodePtr :: ByteString -> CodePtr
      toCodePtr
        = fromRight (error "could not decode CodePtr")
        . rlpDeserialize

instance Default Constant CodePtr (Column PGBytea) where
  def = lmap rlpSerialize def

instance QueryRunnerColumnDefault PGBytea (Maybe ChainId) where
  queryRunnerColumnDefault =
    queryRunnerColumn id toChainId queryRunnerColumnDefault
    where
      toChainId :: ByteString -> Maybe ChainId
      toChainId bs
        = if B.null bs
            then Nothing
            else Just
               . ChainId
               . byteStringToWord256
               $ bs

instance Default Constant (Maybe ChainId) (Column PGBytea) where
  def = lmap fromChainId def
        where fromChainId = \case
                Nothing -> B.empty
                Just cid -> word256ToByteString $ unChainId cid
