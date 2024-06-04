module Blockchain.Sequencer.OrderValidator
  ( OrderValidateable,
    ValidationResult (..),
    validateOrder,
    isValid,
  )
where

import Blockchain.Data.BlockHeader
import qualified Blockchain.Sequencer.Event as SE
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256
import Control.Monad.State hiding (runState)
import qualified Data.Map.Strict as Map
import qualified Text.Colors as CL
import Text.Format
import Text.Tools (tab')

class Show t => OrderValidateable t where
  getBlockHash :: t -> Keccak256
  getParentHash :: t -> Keccak256
  getBlockNumber :: t -> Integer

data ValidationResult t
  = InvalidOrder
      { ioParentSHA :: Keccak256,
        ioParentNum :: Integer,
        ioCulprit :: t,
        ioMessage :: String
      }
  | Valid
  deriving (Show)

isValid :: OrderValidatorState t -> Bool
isValid = isValid' . runState

isValid' :: ValidationResult t -> Bool
isValid' Valid = True
isValid' _ = False

data OrderValidatorState t = OrderValidatorState
  { seenBlocks :: Map.Map Keccak256 Integer,
    unseenBlocks :: [t],
    runState :: ValidationResult t
  }
  deriving (Show)

type OrderValidatorM t = StateT (OrderValidatorState t) IO

instance (OrderValidateable t) => Format (OrderValidatorState t) where
  format (OrderValidatorState sb usb rs) =
    if (isValid' rs) then CL.green body else CL.red body
    where
      body =
        ("runState -> " ++ (show rs) ++ "\n")
          ++ tab'
            ( "seenBlocks   -> " ++ (show sb) ++ "\n"
                ++ "unseenBlocks -> "
                ++ (show usb)
                ++ "\n"
            )

runValidatorM :: OrderValidateable gb => OrderValidatorM ts a -> gb -> [ts] -> IO (OrderValidatorState ts)
runValidatorM monad root validateables = do
  seedSeen <- return $ Map.singleton (getBlockHash root) (getBlockNumber root)
  state' <- return $ OrderValidatorState {seenBlocks = seedSeen, unseenBlocks = validateables, runState = Valid}
  snd <$> runStateT monad state'

validator :: OrderValidateable t => OrderValidatorM t ()
validator = do
  state' <- get
  (thisBlock : rest) <- return $ (unseenBlocks state')
  thisBlockNumber <- return $ getBlockNumber thisBlock
  thisBlockHash <- return $ getBlockHash thisBlock
  thisBlockParent <- return $ getParentHash thisBlock
  state'' <- return $ state' {unseenBlocks = rest}
  currSeenBlocks <- seenBlocks <$> get
  case Map.lookup thisBlockParent currSeenBlocks of
    Nothing -> put $ state'' {runState = InvalidOrder thisBlockParent 0 thisBlock ("Saw block #" ++ (show thisBlockNumber) ++ " before its parent")}
    Just parentNumber ->
      if (parentNumber < thisBlockNumber)
        then put $ state'' {seenBlocks = (Map.insert thisBlockHash thisBlockNumber currSeenBlocks)}
        else put $ state'' {runState = InvalidOrder thisBlockParent parentNumber thisBlock ("Saw block w/ block number >= its parent, culprit block #" ++ (show thisBlockNumber))}
  newState <- get
  if ((isValid newState) && (not . null . unseenBlocks $ newState)) then validator else return ()

validateOrder :: (OrderValidateable gb, OrderValidateable ts) => gb -> [ts] -> IO (OrderValidatorState ts)
validateOrder = runValidatorM validator

instance OrderValidateable SE.IngestBlock where
  getBlockHash = blockHeaderHash . SE.ibBlockData
  getParentHash = parentHash . SE.ibBlockData
  getBlockNumber = number . SE.ibBlockData

instance OrderValidateable SE.OutputBlock where
  getBlockHash = blockHeaderHash . SE.obBlockData
  getParentHash = parentHash . SE.obBlockData
  getBlockNumber = number . SE.obBlockData
