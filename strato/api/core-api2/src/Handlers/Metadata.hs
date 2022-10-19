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

import qualified Data.Text                      as T
---mport           Data.Aeson
import           Data.Swagger
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


getMetaData :: Accessible [MetadataResponse] m =>
                              Maybe T.Text  
                              ->   m [MetadataResponse]
getMetaData _ =  access (Proxy @[MetadataResponse])