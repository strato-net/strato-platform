{-# LANGUAGE DeriveDataTypeable #-}
module Checkpoints where

import Data.Data
import qualified Network.Kafka.Protocol as KP

import GHC.Read
import qualified Text.Read.Lex as L
import qualified Text.ParserCombinators.ReadPrec as P

data CheckpointService   = Sequencer | EVM | Indexer | Adit | NullService deriving (Eq, Ord, Enum, Data)
data CheckpointOperation = Get | Put | NullOperation deriving (Eq, Ord, Enum, Data)

-- have to manually do these cause theres no way to lowercase them for glorious lowercase cli
instance Read CheckpointOperation where
    readPrec = parens $ do
        L.Ident s <- lexP
        case s of
            "get" -> return Get
            "put" -> return Put
            _     -> P.pfail

instance Show CheckpointOperation where
    show Get = "get"
    show Put = "put"
    show NullOperation = "NullOperation"

instance Read CheckpointService where
    readPrec = parens $ do
        L.Ident s <- lexP
        case s of
            "sequencer"   -> return Sequencer
            "evm"         -> return EVM
            "indexer"     -> return Indexer
            "adit"        -> return Adit
            "NullService" -> return NullService
            _             -> P.pfail

instance Show CheckpointService where
    show Sequencer   = "sequencer"
    show EVM         = "evm"
    show Indexer     = "indexer"
    show Adit        = "adit"
    show NullService = "NullService"

hasCheckpointData :: CheckpointService -> Bool
hasCheckpointData EVM = True
hasCheckpointData _   = False

doCheckpointGet :: CheckpointService -> IO ()
doCheckpointGet = error "get"

doCheckpointPut :: CheckpointService -> Maybe KP.Offset -> Maybe String -> IO ()
doCheckpointPut = error "put"

doCheckpointUsage :: IO ()
doCheckpointUsage = do
    putStrLn "queryStrato checkpoints -s,--service SERVICE -o,--operation get|put [-i,--offset Offset] [-m,--metadata CheckpointData]"
    putStrLn ""
    putStrLn "Notes:"
    putStrLn "   * At least one of --offset or --metadata is required when using -o put"
    putStrLn ""
    putStrLn "Flags:"
    putStrLn "  -s --service=SERVICE  The service whose metadata to operate against. One of: sequencer evm indexer adit"
    putStrLn "  -o --op=OP            The operation to perform. One of: get put"
    putStrLn "  -i --offset=INT       If -o PUT is specified, set the service's checkpointed Kafka offset"
    putStrLn "  -m --metadata=DATA    If -o PUT is specified, set the service-specific metadata in the checkpoint to DATA"
    putStrLn ""
    putStrLn "Common flags:"
    putStrLn "  -? --help             Display a significantly less useful help message"
    putStrLn "  -V --version          Print version information"
