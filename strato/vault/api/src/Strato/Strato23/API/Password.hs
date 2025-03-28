{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Password where

import Data.Text
import Servant.API
import Data.Aeson
import qualified Data.Text as T
import GHC.Generics

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------

-- Define a newtype for password that can handle both string and numeric inputs
newtype Password = Password { unPassword :: Text }

instance FromJSON Password where
  parseJSON (String s) = return $ Password s
  parseJSON (Number n) = return $ Password $ T.pack $ show n
  parseJSON v = fail $ "Expected String or Number for password, but got: " ++ show v

type PostPassword =
  "password"
    :> ReqBody '[JSON] Password
    :> Post '[JSON] ()

type VerifyPassword =
  "verify-password"
    :> Get '[JSON] Bool
