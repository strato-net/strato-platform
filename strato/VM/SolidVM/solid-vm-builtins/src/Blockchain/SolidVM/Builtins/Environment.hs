{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.Builtins.Environment (blockhash, setBlockContext, fastForward) where

import BlockApps.Logging (MonadLogger)
import Blockchain.Data.BlockSummary (BlockSummary)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.ProposalFacts (ProposalFacts (..))
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.SM (getBlockHashWithNumber)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToByteString)
import Blockchain.VM.SolidException (SolidException (InvalidArguments))
import Control.Exception (throw)
import Text.Format (format)
import Control.Monad (unless)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import qualified Data.ByteString.Char8 as BC
import Data.Time.Clock (addUTCTime)
import SolidVM.Model.Value (Value (..), renderValueShallow)

blockhash :: (MonadLogger m, Mod.Accessible Env.Environment m, (Keccak256 `A.Alters` BlockSummary) m) => Integer -> m String
blockhash blockNum = do
  if blockNum < 0
    then throw (InvalidArguments "blockhash() only accepts arguments greater than or equal to 0" (format [blockNum]))
    else pure ()
  env <- Mod.access (Mod.Proxy @Env.Environment)
  maybeTheHash <- getBlockHashWithNumber blockNum (BlockHeader.parentHash $ Env.blockHeader env)
  maybe (throw (InvalidArguments "the block number given does not exist" (format [blockNum]))) (pure . BC.unpack . keccak256ToByteString) maybeTheHash

setBlockContext :: Mod.Modifiable Env.Environment m => Address -> Address -> Address -> Integer -> m ()
setBlockContext proposer prevProposer prevIntended prevRound = do
  env <- Mod.get (Mod.Proxy @Env.Environment)
  unless (Env.runningTests env) $ throw (InvalidArguments "setBlockContext can only be called during testing"
    (format (map renderValueShallow [SAddress proposer False, SAddress prevProposer False, SAddress prevIntended False, SInteger prevRound])))
  Mod.put (Mod.Proxy @Env.Environment) env
    { Env.proposer = proposer, Env.prevBlock = Just (ProposalFacts prevProposer prevIntended prevRound) }

fastForward :: Mod.Modifiable Env.Environment m => Integer -> Integer -> m ()
fastForward seconds blocks = do
  env <- Mod.get (Mod.Proxy @Env.Environment)
  -- Only allow fastForward during testing
  unless (Env.runningTests env) $ throw (InvalidArguments "fastForward can only be called during testing" (format [renderValueShallow (SInteger seconds)]))
  -- Get current timestamp and add seconds
  let header = Env.blockHeader env
      updated = header
        { BlockHeader.timestamp = addUTCTime (max 1 $ fromIntegral seconds) (BlockHeader.timestamp header)
        , BlockHeader.number = BlockHeader.number header + blocks }
  -- Update the environment with new block header
  Mod.put (Mod.Proxy @Env.Environment) env { Env.blockHeader = updated }
