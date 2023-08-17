{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

--import           Control.Monad.IO.Class
--import qualified Data.ByteString.Char8              as C8
--import           Data.Maybe
--import qualified Data.Set                           as S
--import           Data.Word

--import qualified Test.Hspec                         as HS
--import           Test.Hspec.Expectations.Lifted

--import BlockApps.Logging
--import Blockchain.Blockstanbul.Authentication
--import Blockchain.Blockstanbul.BenchmarkLib
--import Blockchain.Data.Block
--import Blockchain.Data.DataDefs
--import Blockchain.Strato.Model.Address
--import Blockchain.Strato.Model.ChainMember
--import Blockchain.Strato.Model.Secp256k1
--import Blockchain.VMContext

import Blockchain.VMOptions ()
import Control.Monad
import Executable.EVMFlags ()
import HFlags
import Test.Hspec (Spec, describe, hspec)

--import qualified LabeledError

--it :: String -> ContextM () -> HS.SpecWith ()
--it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

--blk :: Block
--blk = makeBlock 1 1
--
--
--private :: PrivateKey
--private = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "private" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))
--
--
--instance HasVault ContextM where
--  sign bs = return $ signMsg private bs
--  getPub = error "called getPub, but this should never happen"
--  getShared _ = error "called getShared, but this should never happen"
--
--senderAddress :: Address
--senderAddress = fromPrivateKey private
--
--sender :: ChainMemberParsedSet
--sender = CommonName "BlockApps" "Engineering" "Admin" True
--
--recipient :: ChainMemberParsedSet
--recipient = CommonName "BlockApps" "Engineering" "James Hormuzdiar" True
--
--recipient2 :: ChainMemberParsedSet
--recipient2 = CommonName "BlockApps" "Engineering" "Nikita Mendelbaum" True

spec :: Spec
spec = describe "VMContext" $ pure ()
