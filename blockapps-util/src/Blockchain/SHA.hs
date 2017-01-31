{-# LANGUAGE OverloadedStrings, LambdaCase #-}

module Blockchain.SHA (
  module Blockchain.Strato.Model.SHA,
  formatSHAWithoutColor,
  hash
  ) where

import Control.Monad
import qualified Crypto.Hash.SHA3 as C
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as T
import Numeric
import Web.PathPieces
import Web.HttpApiData

import qualified Blockchain.Colors as CL
import Blockchain.Data.RLP
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.Util

import GHC.Generics

import Blockchain.Strato.Model.SHA

formatSHAWithoutColor :: SHA -> String
formatSHAWithoutColor s@(SHA x)  
  | s == hash "" = "<blank>"
  | otherwise    = padZeros 64 $ showHex x ""

instance Format SHA where
  format = CL.yellow . formatSHAWithoutColor

instance JSON.FromJSON SHA where
instance JSON.ToJSON SHA where

-- I think we want this first definition, but the API already uses the second one!
-- Someday we should fix this, but it will probably change our external (API) behavior.
{-
instance PathPiece SHA where
  toPathPiece (SHA x) = T.pack $ padZeros 64 $ showHex x ""
  fromPathPiece t = Just (SHA wd160)
    where
      ((wd160, _):_) = readHex $ T.unpack $ t ::  [(Word256,String)]
-}

instance PathPiece SHA where
  toPathPiece = T.pack . show
  fromPathPiece t = 
    case readHex $ T.unpack t of
      [(x, "")] -> Just $ SHA x
      _ -> Nothing

instance ToHttpApiData SHA where
    toUrlPiece = toPathPiece

instance FromHttpApiData SHA where
    parseUrlPiece = unmaybe . fromPathPiece
        where unmaybe = \case
                Nothing -> Left "couldn't parse SHA"
                Just x  -> Right x

hash :: BC.ByteString -> SHA
hash = superProprietaryStratoSHAHash

