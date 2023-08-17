{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

import Blockchain.VMOptions ()
import Control.Monad
import Executable.EVMFlags ()
import HFlags
import Test.Hspec (Spec, describe, hspec)

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
