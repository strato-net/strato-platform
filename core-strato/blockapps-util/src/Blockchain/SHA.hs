{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.SHA (
  module Blockchain.Strato.Model.SHA,
  formatSHAWithoutColor,
  ) where

import qualified Data.Text                   as T
import           Numeric
import           Web.HttpApiData
import           Web.PathPieces

import qualified Blockchain.Colors           as CL
import           Blockchain.Format
import           Blockchain.Util


import           Blockchain.Strato.Model.SHA

formatSHAWithoutColor :: SHA -> String
formatSHAWithoutColor s@(SHA x)
  | s == hash "" = "<blank>"
  | otherwise    = padZeros 64 $ showHex x ""

instance Format SHA where
  format = CL.yellow . formatSHAWithoutColor


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
      _         -> Nothing

instance ToHttpApiData SHA where
    toUrlPiece = toPathPiece

instance FromHttpApiData SHA where
    parseUrlPiece = unmaybe . fromPathPiece
        where unmaybe = \case
                Nothing -> Left "couldn't parse SHA"
                Just x  -> Right x
