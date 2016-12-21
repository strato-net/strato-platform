{-# LANGUAGE DeriveGeneric, OverloadedStrings, FlexibleInstances, TemplateHaskell #-}

import Control.Applicative
import Control.Monad
import Control.Monad.IfElse
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans
import Control.Monad.Trans.Either
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Crypto.Hash.SHA3 as SHA3
import Data.Aeson
import qualified Data.Binary as Bin
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Either
import Data.List
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import HFlags
import qualified Network.Haskoin.Internals as Haskoin
import Network.Haskoin.Crypto (withSource)
import Numeric
import System.Directory
import System.Environment
import System.FilePath
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))
import qualified Database.LevelDB as DB
import Blockchain.Output

import Blockchain.BlockChain
import qualified Blockchain.Colors as C
import Blockchain.Constants
import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockDB
import Blockchain.Data.Code
import Blockchain.VMContext
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.DB.CodeDB
import Blockchain.DBM
--import Blockchain.ExtDBs
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.SHA
import Blockchain.Util
import Blockchain.VM
import Blockchain.VM.Code
import Blockchain.VM.Environment
import Blockchain.VM.VMState
import Blockchain.VMOptions
import Blockchain.Sequencer.Event
import Blockchain.Data.ExecResults
import qualified Blockchain.Data.TXOrigin as TO
import qualified Data.NibbleString as N

import TestDescriptions
import TestEthereum

import Debug.Trace

import TestFiles

main::IO ()
main = do
  args <- $initHFlags "The Ethereum Test program"
  testsExist <- doesDirectoryExist "tests"
  when (not testsExist) $
    error "You need to clone the git repository at https://github.com/ethereum/tests.git"

  let (maybeFileName, maybeTestName) = 
        case args of
          [] -> (Nothing, Nothing)
          [x] -> (Just x, Nothing)
          [x, y] -> (Just x, Just y)
          _ -> error "You can only supply 2 parameters"
  
  homeDir <- getHomeDirectory

  _ <- flip runLoggingT noLog $ runContextM $ do
    let debug = length args == 2
    runAllTests maybeFileName maybeTestName
    
  return ()

