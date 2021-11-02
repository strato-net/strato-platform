{-# LANGUAGE DataKinds              #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE LambdaCase             #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE RecordWildCards        #-}
{-# LANGUAGE ScopedTypeVariables    #-}
{-# LANGUAGE TypeApplications       #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE TypeOperators          #-}
{-# OPTIONS_GHC -fno-warn-orphans   #-}

module Handlers.AccountInfo
  ( API
  , AccountsFilterParams(..)
  , accountsFilterParams
  , getAccountsFilter
  , server
  , getAccount
  , getAccount'
  ) where

import           Control.Monad.Change.Alter
import           Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as BC
import           Data.List
import           Data.Maybe
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           Numeric.Natural
import           Servant
import           Servant.Client
--import           Servant.Swagger.Tags


import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256 (emptyHash)

import           Control.Monad.Composable.SQL

import           Settings
import           SQLM
import           UnliftIO
{-
-- TODO: Remove once https://github.com/nakaji-dayo/servant-swagger-tags/pull/1 is merged
instance HasClient m api => HasClient m (Tags tags :> api) where
  type Client m (Tags tags :> api) = Client m api
  clientWithRoute pm _ = clientWithRoute pm (Proxy @api)
  hoistClientMonad pm _ f cl = hoistClientMonad pm (Proxy @api) f cl
-}
type API = -- Tags "section1" :> Summary "get user accounts" :> Description "Get information about user accounts" :>
  "account" :> QueryParam "address" Address
            :> QueryParam "balance" Natural
            :> QueryParam "minbalance" Natural
            :> QueryParam "maxbalance" Natural
            :> QueryParam "nonce" Natural
            :> QueryParam "minnonce" Natural
            :> QueryParam "maxnonce" Natural
            :> QueryParam "maxnumber" Natural
            :> QueryParam "code" Text
            :> QueryParam "codeHash" CodePtr
            :> QueryParams "chainid" ChainId
            :> QueryParam "external" Bool
            :> QueryParam "limit" Natural
            :> QueryParam "offset" Natural
            :> Get '[JSON] [AddressStateRef']

data AccountsFilterParams = AccountsFilterParams
  { qaAddress    :: Maybe Address
  , qaBalance    :: Maybe Natural
  , qaMinBalance :: Maybe Natural
  , qaMaxBalance :: Maybe Natural
  , qaNonce      :: Maybe Natural
  , qaMinNonce   :: Maybe Natural
  , qaMaxNonce   :: Maybe Natural
  , qaMaxNumber  :: Maybe Natural
  , qaCode       :: Maybe Text
  , qaCodeHash   :: Maybe CodePtr
  , qaChainId    :: [ChainId]
  , qaExternal   :: Maybe Bool
  , qaLimit      :: Maybe Natural
  , qaOffset     :: Maybe Natural
  } deriving (Eq, Ord, Show)

accountsFilterParams :: AccountsFilterParams
accountsFilterParams = AccountsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing [] Nothing Nothing Nothing

getAccountsFilter :: AccountsFilterParams -> ClientM [AddressStateRef']
getAccountsFilter = uncurryAccountsFilterParams (client $ Proxy @API)

uncurryAccountsFilterParams :: ( Maybe Address
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Natural
                              -> Maybe Text
                              -> Maybe CodePtr
                              -> [ChainId]
                              -> Maybe Bool
                              -> Maybe Natural
                              -> Maybe Natural
                              -> r
                               )
                            -> AccountsFilterParams
                            -> r
uncurryAccountsFilterParams f AccountsFilterParams{..} = f
  qaAddress qaBalance qaMinBalance qaMaxBalance qaNonce
  qaMinNonce qaMaxNonce qaMaxNumber qaCode qaCodeHash
  qaChainId qaExternal qaLimit qaOffset

server :: HasSQL m => ServerT API m
server = getAccount

---------------------------

data NamedChainId = UnnamedChainIds [ChainId]
                  | MainChain
  
instance HasSQL m => Selectable AccountsFilterParams [AddressStateRef] m where
  select _ a@AccountsFilterParams{..} | a == accountsFilterParams =
    throwIO . NoFilterError $ "Need one of: " ++ intercalate ", " accountQueryParams
                                      | otherwise = do
    chainid <- case qaChainId of
      [] -> pure MainChain
      cids -> pure $ UnnamedChainIds cids

    fmap (Just . nub . map E.entityVal) . sqlQuery $ E.select . E.distinct $
      E.from $ \(accStateRef) -> do

      let
        criteria =
          catMaybes
          [
            fmap
              (\case
                True -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val (EVMCode emptyHash)
                False -> E.not_ $ accStateRef E.^. AddressStateRefCodeHash E.==. E.val (EVMCode emptyHash)
              ) qaExternal,
            fmap (\v -> accStateRef E.^. AddressStateRefBalance E.==. E.val v) (fromIntegral <$> qaBalance),
            fmap (\v -> accStateRef E.^. AddressStateRefBalance E.>=. E.val v) (fromIntegral <$> qaMinBalance),
            fmap (\v -> accStateRef E.^. AddressStateRefBalance E.<=. E.val v) (fromIntegral <$> qaMaxBalance),
            fmap (\v -> accStateRef E.^. AddressStateRefNonce E.==. E.val v) (fromIntegral <$> qaNonce),
            fmap (\v -> accStateRef E.^. AddressStateRefNonce E.>=. E.val v) (fromIntegral <$> qaMinNonce),
            fmap (\v -> accStateRef E.^. AddressStateRefNonce E.<=. E.val v) (fromIntegral <$> qaMaxNonce),
            fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) qaAddress,
            fmap (\v -> accStateRef E.^. AddressStateRefCode E.==. E.val (toCode v)) qaCode,
            fmap (\v -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val v) qaCodeHash
          ] 
      
      let matchChainId (ChainId cid) = (accStateRef E.^. AddressStateRefChainId) E.==. (E.val cid)
      let chainCriteria = case chainid of
            MainChain -> [accStateRef E.^. AddressStateRefChainId E.==. E.val 0]
            UnnamedChainIds cids -> matchChainId <$> cids
      let allCriteria = case chainCriteria of
              [] -> [criteria]
              _ -> map (\cc -> cc : criteria) chainCriteria

      E.where_ (foldl1 (E.||.) (map (foldl1 (E.&&.)) allCriteria))

      E.offset . fromIntegral $ fromMaybe 0 qaOffset
      E.limit $ maybe appFetchLimit (min appFetchLimit . fromIntegral) qaLimit

      E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
      return accStateRef

getAccount :: Selectable AccountsFilterParams [AddressStateRef] m
           => Maybe Address -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
              Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
              Maybe Text -> Maybe CodePtr -> [ChainId] -> Maybe Bool ->
              Maybe Natural -> Maybe Natural ->
              m [AddressStateRef']
getAccount a b c d e f g h i j k l m n
  = getAccount' (AccountsFilterParams a b c d e f g h i j k l m n)
    
getAccount' :: Selectable AccountsFilterParams [AddressStateRef] m => AccountsFilterParams -> m [AddressStateRef']
getAccount' a = do
  addrs <- fromMaybe [] <$> select (Proxy @[AddressStateRef]) a
  return . map asrToAsrPrime $ zip (repeat "") addrs

accountQueryParams:: [String]
accountQueryParams = [ "address",
                       "balance",
                       "minbalance",
                       "maxbalance",
                       "nonce",
                       "minnonce",
                       "maxnonce",
                       "maxnumber",
                       "code",
                       "index",
                       "codeHash",
                       "chainid",
                       "external",
                       "limit",
                       "offset"
                     ]

toCode :: Text -> BC.ByteString
toCode v = fst $ B16.decode $ BC.pack $ (T.unpack v)

