{-# LANGUAGE Arrows              #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeFamilies        #-}
{-# LANGUAGE TypeOperators       #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}



module Handlers.Metadata
  (  API
    --,MetadataResponse
    , getMetaDataClient
    , MetadataResponse
    , server
  ) where



import           GHC.Generics

import           Control.Monad.Change.Modify
--import           Conduit
--import qualified Data.Map                       as M
--import           Data.Maybe                     (fromMaybe)

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.RedisBlockDB         (runStratoRedisIO, getSyncStatus)
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Strato.Strato23.Client   hiding (verifyPassword)
import           Strato.Strato23.API.Types 
import           Strato.Strato23.Monad (VaultWrapperError)
import           Servant
import           Servant.Client

import           Data.Aeson                         hiding (Success)
import           Control.Monad.Composable.SQL
import           Blockchain.Strato.Model.Address
-- import           Settingsimport           Data.Swagger
-- import           S\
     
import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import qualified Database.Esqueleto.Legacy  as E
--import  Blockchain.Strato.Model.Address
type API = "Metadata"
  :> Servant.Header "X-USER-ACCESS-TOKEN" T.Text
  :> Get '[JSON] [MetadataResponse]

getMetaDataClient :: Maybe T.Text -> ClientM [MetadataResponse]
getMetaDataClient = client (Proxy @API)


server :: ( HasSQL m) => ServerT API m
server = getMetaData

----------------------------------------


data MetadataResponse = MetadataResponse
  { nodePubKey ::  String-- PublicKey  --Not %100 of this type yet
  ,nodeAddress ::  String--Address 
  ,validators  ::  [Address]
  --, syncStatus :: ?
  --Vault password is set ?
  } deriving (Eq, Show, Generic, FromJSON, ToJSON)


-- exMetadata :: MetadataResponse
-- exMetadata = MetadataResponse "String" "String"  []
  
-- instance Arbitrary MetadataResponse where
--   arbitrary = GR.genericArbitrary GR.uniform

-- instance ToJSON MetadataResponse where
--   toJSON = genericToJSON (aesonDrop 15 camelCase)

-- instance FromJSON MetadataResponse where
--   parseJSON = genericParseJSON (aesonDrop 15 camelCase)

    --makeLenses ''MetadataResponse
-- instance ToSample MetadataResponse where
--   toSamples _ = singleSample exMetadata


instance HasSQL m => Accessible [MetadataResponse] m where 
    access _ = do
        txrs <-  fmap (map E.entityVal) $  sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
        let res = (\(ValidatorRef x) -> ( MetadataResponse "" "" x) ) <$> txrs
        return res
-- getMetadata :: ( HasCoreAPI m -- log hash---> hasBlocApi ?
--                  , A.Selectable Account AddressState m
--                  , (Keccak256 `A.Alters` SourceMap) m
--                  , HasBlocSQL m
--                  , MonadLogger m
--                  , HasSQL m
--                  , HasBlocEnv m
--                  )
--               => UserName  -> m MetadataResponse
-- getMetadata x =
--     let queryStatement = E.select . E.from $ "ValidatorRef"
--     vals <- SQLDB.sqlQuery queryStatement
--     pure $ MetadataResponse { 
--         nodePubKey="Fake"
--         ,nodeAddress ="Fake data" 
--         ,validators  vals
--      }
instance ToSchema MetadataResponse

getMetaData :: (  MonadIO m
                , MonadLogger m
                , MonadUnliftIO m
                , HasVault m
                , Accessible [Address] m
                , HasSQL m )
                =>   Maybe T.Text  
                ->   m MetadataResponse
getMetaData token = 
  do
  validators <- access (Proxy @[Address])
  isSynced <- checkIsSynced
  pubK <- getPubKey token
  case pubK of
    Left  _      -> pure $ (MetadataResponse " "  "Error" validators False False) 
    Right pubKey -> pure $ (MetadataResponse " "  (show pubKey) validators  isSynced True)




blocVaultWrapper :: (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
                    ClientM x -> m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

getPubKey ::  (MonadIO m, MonadLogger m, MonadUnliftIO m, HasVault m) => Maybe T.Text -> m (Either VaultWrapperError Address)
getPubKey mAccessToken =
  case mAccessToken of
    Nothing -> throwIO $ InvalidArgs $ "Did not find X-USER-UNIQUE-NAME in the header" -- This may not be needed
    Just _  -> try $ fmap Strato.Strato23.API.Types.unAddress . blocVaultWrapper $ getKey  "nodekey" Nothing

checkIsSynced :: (HasSQL m) => m Bool
checkIsSynced = (runStratoRedisIO getSyncStatus) >>= \case Nothing -> pure False; Just c ->pure  c; 
