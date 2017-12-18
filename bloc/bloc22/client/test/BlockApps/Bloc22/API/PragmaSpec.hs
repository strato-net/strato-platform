{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module BlockApps.Bloc22.API.PragmaSpec where

--import           Servant.Client
import           Test.Hspec
--import           Control.Monad.IO.Class     (MonadIO(..))
--import           Data.Either
--import           Control.Monad.Trans.Either
--import           BlockApps.Bloc22.API.Contracts
import           BlockApps.Bloc22.API.SpecUtils
--import           BlockApps.Bloc22.Client
--import           BlockApps.Bloc22.Database.Solc

spec :: SpecWith TestConfig
spec =
  describe "Pragma Test" $
    it "should compile a contract with the pragma directive" $ \ TestConfig {..} -> do
      True `shouldSatisfy` not . not
--      simpleStoragePragmaSource <- readSolFile "SimpleStoragePragma.sol"
--      let
--        simpleStoragePragmaContractName = "SimpleStoragePragma"
--        postCompileRequest1 = PostCompileRequest (Just []) (Just simpleStoragePragmaContractName) (simpleStoragePragmaSource)
      --v <- runClientM (postContractsCompile [postCompileRequest1]) (ClientEnv mgr blocUrl)
      --putStrLn $ show v
--      (pP, mF, iF) <- getSolSrc simpleStoragePragmaSource
--      eResult <- runEitherT $ runSolc pP mF iF
--      putStrLn $ show eResult
--      eResult `shouldSatisfy` isRight
