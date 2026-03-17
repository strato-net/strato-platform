{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Version (stratoVersion, stratoVersionTag) where

import Data.FileEmbed (embedStringFile)
import Language.Haskell.TH (runIO)
import System.Process (readProcess)

buildMetadata :: String
buildMetadata = $(do
  root <- runIO $ filter (/= '\n') <$> readProcess "git" ["rev-parse", "--show-toplevel"] ""
  embedStringFile (root ++ "/BUILD_METADATA"))

stratoVersionTag :: String
stratoVersionTag = case lookup "VERSION" pairs of
    Just v  -> v
    Nothing -> error "VERSION not in BUILD_METADATA"
  where
    pairs = [(k, drop 1 v) | l <- lines buildMetadata, '=' `elem` l, let (k, v) = break (== '=') l]

stratoVersion :: String
stratoVersion = stratoVersionTag
