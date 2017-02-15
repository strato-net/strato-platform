{-# LANGUAGE LambdaCase #-}
module Blockchain.Strato.Indexer.Model
    ( IndexEvent(..)
    ) where

import Data.Binary

import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.SHA

data IndexEvent = RanBlock OutputBlock
                | NewBestBlock (SHA, Integer, Integer)
                deriving (Eq, Read, Show)

instance Binary IndexEvent where
    get = do
        tag <- getWord8
        case tag of
            0 -> RanBlock <$> get
            1 -> NewBestBlock <$> get
            x -> error $ "Unknown IndexEvent tag in decode `" ++ show x ++ "`"

    put (RanBlock b)     = putWord8 0 >> put b
    put (NewBestBlock n) = putWord8 1 >> put n