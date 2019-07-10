{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Data.String
import Blockchain.Init.Options
import Blockchain.Init.Protocol

import HFlags

main :: IO ()
main = do
  _ <- $initHFlags "from-volume"
  let kaddr = case flags_kafkahost of
                  "" -> ("kafka", 9092)
                  _ -> (fromString flags_kafkahost, 9092)
  addEvent kaddr InitComplete
