{-# LANGUAGE OverloadedStrings #-}

module Handler.ExtABI (postExtABIR) where

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import Control.Monad.Trans.Either
import qualified Data.Aeson as Aeson
import qualified Data.Map as Map
import Data.Traversable

import Import
import Handler.SolidityCommon

-- Query parameters allowed:
--   src: solidity source code to be parsed, as a (url-encoded) string
-- Data allowed:
--   main: a Solidity source file to be parsed
--   import: a Solidity source file that is included by another one

postExtABIR :: Handler Text
postExtABIR = do
  addHeader "Access-Control-Allow-Origin" "*"
  (_, mainFiles, importFiles) <- getSolSrc
  let allSrc = mainFiles `Map.union` importFiles
      mainFileNames = Map.keys mainFiles
  eitherErrEncode $ allXABI allSrc mainFileNames

allXABI :: Map String String -> [String] -> EitherT String IO Aeson.Value
allXABI allSrc mainFileNames = do
  allParsed <- bimapEitherT show id $ hoistEither $ sequence $ Map.mapWithKey parseSolidity allSrc
  hoistEither $ either (Right . Aeson.toJSON) (Right . Aeson.toJSON) $ sequence $ Map.fromList [(name, jsonABI name allParsed) | name <- mainFileNames]

