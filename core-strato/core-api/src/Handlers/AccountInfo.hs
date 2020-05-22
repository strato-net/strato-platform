{-# LANGUAGE DataKinds              #-}
{-# LANGUAGE FlexibleInstances      #-}
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
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as BC
import qualified Data.ByteString.Lazy.Char8  as BLC
import           Data.List
import           Data.Maybe
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import qualified Database.Esqueleto          as E
import           Database.Persist.Postgresql
import           Numeric.Natural
import           Servant
import           Servant.Client
import           Servant.Swagger.Tags


import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Keccak256 hiding (hash)


import           Settings
import           SQLM

-- TODO: Remove once https://github.com/nakaji-dayo/servant-swagger-tags/pull/1 is merged
instance HasClient m api => HasClient m (Tags tags :> api) where
  type Client m (Tags tags :> api) = Client m api
  clientWithRoute pm _ = clientWithRoute pm (Proxy @api)
  hoistClientMonad pm _ f cl = hoistClientMonad pm (Proxy @api) f cl

type API = Tags "section1" :> Summary "get user accounts" :> Description "Get information about user accounts" :>
  "account" :> QueryParam "address" Address
            :> QueryParam "balance" Natural
            :> QueryParam "minbalance" Natural
            :> QueryParam "maxbalance" Natural
            :> QueryParam "nonce" Natural
            :> QueryParam "minnonce" Natural
            :> QueryParam "maxnonce" Natural
            :> QueryParam "maxnumber" Natural
            :> QueryParam "code" Text
            :> QueryParam "codeHash" Keccak256 -- TODO: Should be CodePtr
            :> QueryParams "chainid" ChainId
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
  , qaCodeHash   :: Maybe Keccak256
  , qaChainId    :: [ChainId]
  } deriving (Eq, Show)

accountsFilterParams :: AccountsFilterParams
accountsFilterParams = AccountsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing []

getAccountsFilter :: AccountsFilterParams -> ClientM [AddressStateRef']
getAccountsFilter = uncurryAccountsFilterParams getAccountsFilter'
  where
    getAccountsFilter' = client (Proxy @API)
    uncurryAccountsFilterParams f AccountsFilterParams{..} = f
      qaAddress qaBalance qaMinBalance qaMaxBalance qaNonce
      qaMinNonce qaMaxNonce qaMaxNumber qaCode qaCodeHash
      qaChainId

server :: ConnectionPool -> Server API
server pool = getAccount pool

---------------------------

data NamedChainId = UnnamedChainIds [ChainId]
                  | MainChain

getAccount :: ConnectionPool ->
                  Maybe Address -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
                  Maybe Natural -> Maybe Natural -> Maybe Natural -> Maybe Natural ->
                  Maybe Text -> Maybe Keccak256 -> [ChainId] ->
                  Handler [AddressStateRef']

getAccount pool 
  address balance minbalance maxbalance
  nonce minnonce maxnonce maxnumber
  code codeHash chainidparam
  = do
    when (and
        [
          null address, null balance, null minbalance, null maxbalance,
          null nonce, null minnonce, null maxnonce, null maxnumber,
          null code, null codeHash, null chainidparam
        ]) $
      throwError err400{ errBody = BLC.pack $ "Need one of: " ++ intercalate ", " accountQueryParams }

    chainid <- case chainidparam of
      [] -> pure MainChain
      cids -> pure $ UnnamedChainIds cids

    addrs <-
      liftIO $ runSQLM pool $ sqlQuery $ E.select . E.distinct $
              E.from $ \(accStateRef) -> do

              let
                criteria =
                  catMaybes
                  [
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.==. E.val v) (fromIntegral <$> balance),
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.>=. E.val v) (fromIntegral <$> minbalance),
                    fmap (\v -> accStateRef E.^. AddressStateRefBalance E.<=. E.val v) (fromIntegral <$> maxbalance),
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.==. E.val v) (fromIntegral <$> nonce),
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.>=. E.val v) (fromIntegral <$> minnonce),
                    fmap (\v -> accStateRef E.^. AddressStateRefNonce E.<=. E.val v) (fromIntegral <$> maxnonce),
                    fmap (\v -> accStateRef E.^. AddressStateRefAddress E.==. E.val v) address,
                    fmap (\v -> accStateRef E.^. AddressStateRefCode E.==. E.val (toCode v)) code,
                    fmap (\v -> accStateRef E.^. AddressStateRefCodeHash E.==. E.val v) codeHash
                  ] 
              
              let matchChainId (ChainId cid) = (accStateRef E.^. AddressStateRefChainId) E.==. (E.val cid)
              let chainCriteria = case chainid of
                    MainChain -> [accStateRef E.^. AddressStateRefChainId E.==. E.val 0]
                    UnnamedChainIds cids -> matchChainId <$> cids
              let allCriteria = case chainCriteria of
                     [] -> [criteria]
                     _ -> map (\cc -> cc : criteria) chainCriteria

              E.where_ (foldl1 (E.||.) (map (foldl1 (E.&&.)) allCriteria))

              E.limit $ appFetchLimit

              E.orderBy [E.asc (accStateRef E.^. AddressStateRefAddress)]
              return accStateRef

    let modAccounts = nub $ addrs :: [E.Entity AddressStateRef]

    return . map asrToAsrPrime . zip (repeat "") $ (map E.entityVal modAccounts) 






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
                       "chainid"]

toCode :: Text -> BC.ByteString
toCode v = fst $ B16.decode $ BC.pack $ (T.unpack v)

