{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-redundant-constraints #-}

module Handlers.Record (
  API,
  server,
  RecordLocation(..)
  ) where

import           Control.Lens.Operators
import           Data.Aeson
import           Data.Swagger
--import           Data.Swagger.ParamSchema
--import           Data.Swagger.Schema
import           GHC.Generics
import           Servant
import           Servant.Swagger.Tags


import           Blockchain.Data.Address
import           Blockchain.Data.Json          ()
--import           Blockchain.Strato.Model.Keccak256   hiding (hash)



data RecordLocation =
  MainChain Address
  | PrivateRecord Int Int Int
--  | Pending Keccak256
  deriving (Generic)

instance ToParamSchema RecordLocation where
  toParamSchema _ = mempty & type_ ?~ SwaggerString
  
instance ToSchema RecordLocation where
instance ToJSON RecordLocation where
instance FromHttpApiData RecordLocation where
  parseUrlPiece = error "parseUrlPiece for RecordLocation not defined"

data SolidityValue = SolidityValue String deriving (Generic)

instance ToSchema SolidityValue where
instance ToJSON SolidityValue where

type API =
           Tags "Contracts"
           :> Summary "Create a new record, based on a DApp template."
           :> Description "Records are contracts based on code in an already existing DApp.  Records can be on the main chain or private."
           :> "record" :> QueryParam "private" Bool :> Post '[JSON] RecordLocation
           
           :<|> Tags "Contracts"
           :> Summary "Call a record function."
--           :> Description ""
           :> "record" :> Capture "record" RecordLocation :> "call" :> Capture "function" String :> Post '[JSON] SolidityValue


server :: Monad m =>
          ServerT API m
server = postRecord :<|> postRecordCall

---------------------

postRecord :: Monad m =>
              Maybe Bool -> m RecordLocation
postRecord _ = return $ PrivateRecord 0 0 0

postRecordCall :: Monad m =>
                  RecordLocation -> String -> m SolidityValue
postRecordCall = error "POST /record/<record>/call not implemented"

