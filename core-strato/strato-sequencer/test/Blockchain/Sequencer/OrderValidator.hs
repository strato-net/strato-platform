module Blockchain.Sequencer.OrderValidator ( OrderValidateable
                                           , ValidationResult(..)
                                           , validateOrder
                                           , isValid
                                           ) where

import           Control.Monad.State        hiding (runState)

import qualified Data.Map.Strict            as Map

import           Blockchain.Data.BlockDB    (blockHeaderHash)
import           Blockchain.Data.DataDefs
import qualified Blockchain.Sequencer.Event as SE
import           Blockchain.SHA

import           Blockchain.Util            (tab)

import qualified Text.Colors                as CL
import           Text.Format

class Show t => OrderValidateable t where
    getBlockHash   :: t -> SHA
    getParentHash  :: t -> SHA
    getBlockNumber :: t -> Integer

data OrderValidateable t => ValidationResult t = InvalidOrder { ioParentSHA :: SHA
                                                              , ioParentNum :: Integer
                                                              , ioCulprit   :: t
                                                              , ioMessage   :: String
                                                              }
                                               | Valid deriving (Show)

isValid :: OrderValidateable t => OrderValidatorState t -> Bool
isValid = isValid' . runState

isValid' :: ValidationResult t -> Bool
isValid' Valid = True
isValid' _     = False

data OrderValidateable t => OrderValidatorState t =
    OrderValidatorState { seenBlocks   :: Map.Map SHA Integer
                        , unseenBlocks :: [t]
                        , runState     :: ValidationResult t
                        } deriving (Show)

type OrderValidatorM t = StateT (OrderValidatorState t) IO

instance (OrderValidateable t) => Format (OrderValidatorState t) where
    format (OrderValidatorState sb usb rs) =
        if (isValid' rs) then CL.green body else CL.red body
            where body =    ("runState -> " ++ (show rs) ++ "\n")
                         ++ tab ("seenBlocks   -> " ++ (show sb)  ++ "\n"
                             ++  "unseenBlocks -> " ++ (show usb) ++ "\n")

runValidatorM :: (OrderValidateable gb, OrderValidateable ts) => OrderValidatorM ts a -> gb -> [ts] -> IO (OrderValidatorState ts)
runValidatorM monad root validateables = do
    seedSeen <- return $ Map.singleton (getBlockHash root) (getBlockNumber root)
    state'   <- return $ OrderValidatorState { seenBlocks = seedSeen, unseenBlocks = validateables, runState = Valid }
    snd <$> runStateT monad state'

validator :: OrderValidateable t => OrderValidatorM t ()
validator = do
    state'           <- get
    (thisBlock:rest) <- return $ (unseenBlocks state')
    thisBlockNumber  <- return $ getBlockNumber thisBlock
    thisBlockHash    <- return $ getBlockHash   thisBlock
    thisBlockParent  <- return $ getParentHash  thisBlock
    state''          <- return $ state' { unseenBlocks = rest }
    currSeenBlocks   <- seenBlocks <$> get
    case Map.lookup thisBlockParent currSeenBlocks of
        Nothing -> put $ state'' { runState = InvalidOrder thisBlockParent 0 thisBlock ("Saw block #" ++ (show thisBlockNumber) ++ " before its parent") }
        Just parentNumber ->
            if (parentNumber < thisBlockNumber) then
                put $ state'' { seenBlocks = (Map.insert thisBlockHash thisBlockNumber currSeenBlocks) }
            else
                put $ state'' { runState = InvalidOrder thisBlockParent parentNumber thisBlock ("Saw block w/ block number >= its parent, culprit block #" ++ (show thisBlockNumber)) }
    newState <- get
    if ((isValid newState) && (not . null . unseenBlocks $ newState)) then validator else return ()

validateOrder :: (OrderValidateable gb, OrderValidateable ts) => gb -> [ts] -> IO (OrderValidatorState ts)
validateOrder = runValidatorM validator

instance OrderValidateable SE.IngestBlock where
    getBlockHash   = blockHeaderHash     . SE.ibBlockData
    getParentHash  = blockDataParentHash . SE.ibBlockData
    getBlockNumber = blockDataNumber     . SE.ibBlockData

instance OrderValidateable SE.OutputBlock where
    getBlockHash   = blockHeaderHash     . SE.obBlockData
    getParentHash  = blockDataParentHash . SE.obBlockData
    getBlockNumber = blockDataNumber     . SE.obBlockData
