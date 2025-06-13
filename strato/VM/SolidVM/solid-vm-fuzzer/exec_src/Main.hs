{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Control.Monad.Catch (MonadCatch, MonadThrow)
import Control.Monad.IO.Class
import qualified Control.Monad.Change.Alter as A
import Data.Foldable (traverse_)
import Data.Source.Map
import qualified Data.Map.Strict as M
import Data.Source.Annotation
import qualified Data.Text as T
import HFlags
import SolidVM.Solidity.Fuzzer
import UnliftIO

newtype Cli a = Cli { runCli :: IO a }
  deriving (Functor, Applicative, Monad, MonadIO, MonadUnliftIO, MonadThrow, MonadCatch)

instance {-# OVERLAPPING #-} A.Selectable FilePath (Either String String) Cli where
  select _ filePath =
    Just <$> catch (Right <$> liftIO (readFile filePath)) (\(_ :: SomeException) -> pure . Left $ "Could not find file by name of " <> filePath)

main :: IO ()
main = do
  _ <- $initHFlags "solid-vm-cli"
  case arguments of
    [] -> putStrLn "No input files given"
    (mode:files) -> runOp mode . SourceMap =<< traverse addFile files
  where addFile file = do
          contents <- readFile file
          pure (T.pack file, T.pack contents)
        runOp mode srcMap = case mode of
          "parse" -> case parse srcMap of
            Right _ -> pure ()
            Left xs -> putStrLn "Parse errors:" >> traverse_ print xs
          "test" -> runCli (fuzz srcMap) >>= traverse_ (\case
                      FuzzerSuccess (SourceAnnotation _ _ (testName, _)) ->
                        putStrLn . T.unpack $ "✅ " <> testName <> " succeeded"
                      FuzzerFailure _ (SourceAnnotation _ _ (testName, msg)) -> do
                        putStrLn . T.unpack $ "❌ " <> testName <> " failed: " <> msg
                    )
          _ -> runCli (compile srcMap) >>= \case
            Right _ -> pure ()
            Left xs -> putStrLn "Compilation errors:" >> traverse_ print xs
        parse = fmap concat
              . traverse (uncurry parseSourceWithAnnotations)
              . unSourceMap
        compile = runMemCompilerT
                . compileSourceWithAnnotations True
                . M.fromList
                . unSourceMap
        -- analyze = runDetectors parse compile id
        fuzz = runFuzzer Nothing compile
