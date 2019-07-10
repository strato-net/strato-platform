{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import Data.String

import Blockchain.Init.Generator
import Blockchain.Init.Options

import HFlags

main :: IO ()
main = do
  _ <- $initHFlags "tabula-rasa"
  let kaddr = case flags_kafkahost of
                  "" -> ("kafka", 9092)
                  _ -> (fromString flags_kafkahost, 9092)

  runGenM kaddr $ mkAll flags_genesisBlockName
