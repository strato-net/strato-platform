{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.AccountInfo where

--import           Servant.Swagger.Tags

import Blockchain.DB.SQLDB
import Blockchain.Data.CirrusDefs
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Control.Lens
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import qualified Data.ByteString as B
import Data.List
import Data.Maybe
import Data.Source.Map
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import qualified Database.Esqueleto.Legacy as E
import Numeric.Natural
-- import qualified LabeledError

import SQLM
import Servant
import Servant.Client
import Settings
import UnliftIO

{-
-- TODO: Remove once https://github.com/nakaji-dayo/servant-swagger-tags/pull/1 is merged
instance HasClient m api => HasClient m (Tags tags :> api) where
  type Client m (Tags tags :> api) = Client m api
  clientWithRoute pm _ = clientWithRoute pm (Proxy @api)
  hoistClientMonad pm _ f cl = hoistClientMonad pm (Proxy @api) f cl
-}
type API =
  "account" :> QueryParam "address" Address
    :> QueryParam "balance" Natural
    :> QueryParam "minbalance" Natural
    :> QueryParam "maxbalance" Natural
    :> QueryParam "nonce" Natural
    :> QueryParam "minnonce" Natural
    :> QueryParam "maxnonce" Natural
    :> QueryParam "maxnumber" Natural
    -- :> QueryParam "code" Text
    :> QueryParam "codeHash" Keccak256
    :> QueryParam "contractName" Text
    :> QueryParam "codePtrAddress" Address
    :> QueryParam "codePtrChainId" ChainId
    :> QueryParams "chainid" ChainId
    :> QueryParam "external" Bool
    :> QueryParam "limit" Natural
    :> QueryParam "offset" Natural
    :> QueryParam "ignoreChain" Bool
    :> Get '[JSON] [AddressStateRef']

data AccountsFilterParams = AccountsFilterParams
  { _qaAddress :: Maybe Address,
    _qaBalance :: Maybe Natural,
    _qaMinBalance :: Maybe Natural,
    _qaMaxBalance :: Maybe Natural,
    _qaNonce :: Maybe Natural,
    _qaMinNonce :: Maybe Natural,
    _qaMaxNonce :: Maybe Natural,
    _qaMaxNumber :: Maybe Natural,
    -- , _qaCode           :: Maybe Text
    _qaCodeHash :: Maybe Keccak256,
    _qaContractName :: Maybe Text,
    _qaCodePtrAddress :: Maybe Address,
    _qaCodePtrChainId :: Maybe ChainId,
    _qaChainId :: [ChainId],
    _qaExternal :: Maybe Bool,
    _qaLimit :: Maybe Natural,
    _qaOffset :: Maybe Natural,
    _qaIgnoreChain :: Maybe Bool
  }
  deriving (Eq, Ord, Show)

makeLenses ''AccountsFilterParams

accountsFilterParams :: AccountsFilterParams
accountsFilterParams =
  AccountsFilterParams
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    Nothing
    []
    Nothing
    Nothing
    Nothing
    Nothing

getAccountsFilter :: AccountsFilterParams -> ClientM [AddressStateRef']
getAccountsFilter = uncurryAccountsFilterParams (client $ Proxy @API)

uncurryAccountsFilterParams ::
  ( Maybe Address ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Natural ->
    -- -> Maybe Text
    Maybe Keccak256 ->
    Maybe Text ->
    Maybe Address ->
    Maybe ChainId ->
    [ChainId] ->
    Maybe Bool ->
    Maybe Natural ->
    Maybe Natural ->
    Maybe Bool ->
    r
  ) ->
  AccountsFilterParams ->
  r
uncurryAccountsFilterParams f AccountsFilterParams {..} =
  f
    _qaAddress
    _qaBalance
    _qaMinBalance
    _qaMaxBalance
    _qaNonce
    _qaMinNonce
    _qaMaxNonce
    _qaMaxNumber
    _qaCodeHash
    _qaContractName
    _qaCodePtrAddress
    _qaCodePtrChainId
    _qaChainId
    _qaExternal
    _qaLimit
    _qaOffset
    _qaIgnoreChain

server :: HasSQL m => ServerT API m
server = getAccount

---------------------------

data NamedChainId
  = UnnamedChainIdsA [ChainId]
  | MainChainA

instance HasSQL m => Selectable AccountsFilterParams [AddressStateRef] m where
  select _ a@AccountsFilterParams {..}
    | a == accountsFilterParams =
      throwIO . NoFilterError $ "Need one of: " ++ intercalate ", " accountQueryParams
    | otherwise = do
      chainid <- case _qaChainId of
        [] -> pure MainChainA
        cids -> pure $ UnnamedChainIdsA cids

      fmap (Just . nub . map E.entityVal) . sqlQuery $
        E.select . E.distinct $
          E.from $ \(accStateRef) -> do
            let criteria =
                  catMaybes
                    [ fmap
                        ( \case
                            True -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val (Just emptyHash)
                            False ->
                              (E.||.)
                                (E.not_ $ accStateRef E.^. AddressStateRefCodeHash E.==. E.val (Just emptyHash))
                                (E.isNothing $ accStateRef E.^. AddressStateRefCodeHash)
                        )
                        _qaExternal,
                      fmap (\v -> accStateRef E.^. AddressStateRefBalance E.==. E.val v) (fromIntegral <$> _qaBalance),
                      fmap (\v -> accStateRef E.^. AddressStateRefBalance E.>=. E.val v) (fromIntegral <$> _qaMinBalance),
                      fmap (\v -> accStateRef E.^. AddressStateRefBalance E.<=. E.val v) (fromIntegral <$> _qaMaxBalance),
                      fmap (\v -> accStateRef E.^. AddressStateRefNonce E.==. E.val v) (fromIntegral <$> _qaNonce),
                      fmap (\v -> accStateRef E.^. AddressStateRefNonce E.>=. E.val v) (fromIntegral <$> _qaMinNonce),
                      fmap (\v -> accStateRef E.^. AddressStateRefNonce E.<=. E.val v) (fromIntegral <$> _qaMaxNonce),
                      fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) _qaAddress,
                      -- fmap (\v -> accStateRef E.^. AddressStateRefCode E.==. E.val (toCode v)) _qaCode,
                      fmap (\v -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val (Just v)) _qaCodeHash,
                      fmap (\v -> accStateRef E.^. AddressStateRefContractName E.==. E.val (Just $ T.unpack v)) _qaContractName,
                      fmap (\v -> accStateRef E.^. AddressStateRefCodePtrAddress E.==. E.val (Just v)) _qaCodePtrAddress,
                      fmap (\v -> accStateRef E.^. AddressStateRefCodePtrChainId E.==. E.val (Just $ unChainId v)) _qaCodePtrChainId
                    ]

            let matchChainId (ChainId cid) = (accStateRef E.^. AddressStateRefChainId) E.==. (E.val cid)
            let chainCriteria = case chainid of
                  MainChainA -> [accStateRef E.^. AddressStateRefChainId E.==. E.val 0]
                  UnnamedChainIdsA cids -> matchChainId <$> cids
            let allCriteria = case (_qaIgnoreChain, chainCriteria) of
                  (Just True, _) -> [criteria]
                  (_, []) -> [criteria]
                  _ -> map (\cc -> cc : criteria) chainCriteria

            E.where_ (foldl1 (E.||.) (map (foldl1 (E.&&.)) allCriteria))

            E.offset . fromIntegral $ fromMaybe 0 _qaOffset
            E.limit $ maybe appFetchLimit (min appFetchLimit . fromIntegral) _qaLimit

            E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
            return accStateRef

getAccount ::
  Selectable AccountsFilterParams [AddressStateRef] m =>
  Maybe Address ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Keccak256 ->
  Maybe Text ->
  Maybe Address ->
  Maybe ChainId ->
  [ChainId] ->
  Maybe Bool ->
  Maybe Natural ->
  Maybe Natural ->
  Maybe Bool ->
  m [AddressStateRef']
getAccount a b c d e f g h i j k l m n o p q =
  getAccount' (AccountsFilterParams a b c d e f g h i j k l m n o p q)

getAccount' :: Selectable AccountsFilterParams [AddressStateRef] m => AccountsFilterParams -> m [AddressStateRef']
getAccount' a = do
  addrs <- fromMaybe [] <$> select (Proxy @[AddressStateRef]) a
  return . map asrToAsrPrime $ zip (repeat "") addrs

accountQueryParams :: [String]
accountQueryParams =
  [ "address",
    "balance",
    "minbalance",
    "maxbalance",
    "nonce",
    "minnonce",
    "maxnonce",
    "maxnumber",
    --  "code",
    "index",
    "codeHash",
    "contractName",
    "codePtrAddress",
    "codePtrChainId",
    "chainid",
    "external",
    "limit",
    "offset",
    "ignoreChain"
  ]

-- toCode :: Text -> BC.ByteString
-- toCode v = LabeledError.b16Decode "toCode" $ BC.pack $ (T.unpack v)

type CodeAPI =
  "code" :> Capture "codeHash" Keccak256
    :> Get '[JSON] SourceMap

codeServer :: (MonadIO m, Selectable Keccak256 SourceMap m) => ServerT CodeAPI m
codeServer cHash =
  select (Proxy @SourceMap) cHash >>= \case
    Nothing -> throwIO . CouldNotFind $ "Could not find code for code hash " <> T.pack (show cHash)
    Just srcMap -> pure srcMap

getCodeFromPostgres :: HasSQL m => Keccak256 -> m (Maybe SourceMap)
getCodeFromPostgres cHash =
  let getSourceMap = deserializeSourceMap . decodeUtf8
   in fmap getSourceMap <$> getCodeByteStringFromPostgres cHash

getCodeByteStringFromPostgres :: HasSQL m => Keccak256 -> m (Maybe B.ByteString)
getCodeByteStringFromPostgres cHash =
  let getBS = codeRefCode . E.entityVal
   in fmap (listToMaybe . map getBS) . sqlQuery . E.select $
        E.from $ \(codeRef) -> do
          E.where_ (codeRef E.^. CodeRefCodeHash E.==. E.val cHash)
          return codeRef

getX509CertForAccount :: HasCirrus m => Address -> m (Maybe Certificate)
getX509CertForAccount addr = do
  fmap (listToMaybe . map E.entityVal) . cirrusQuery . E.select $
    E.from $ \(certificate) -> do
      E.where_ (certificate E.^. CertificateUserAddress E.==. E.val addr)
      return $ certificate
