{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}

import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Control.Monad.Catch (MonadCatch, MonadThrow)
import Control.Monad.IO.Class
import qualified Control.Monad.Change.Alter as A
import Data.Aeson (encode)
import qualified Data.ByteString.Lazy as BL
import Data.Foldable (traverse_)
import Data.Source.Map
import qualified Data.Map.Strict as M
import Data.Source.Annotation
import Data.Source.Severity
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import HFlags
import SolidVM.Solidity.Fuzzer
import SolidVM.Solidity.StaticAnalysis
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
    [] -> putStrLn "No arguments given" >> help
    ["help"] -> help
    [_] -> putStrLn "No input files given"
    (mode:files) -> (\(j, fs) -> runOp mode j $ SourceMap fs) =<< addFiles files
  where help = putStrLn "Usage: solid-vm-cli (parse|compile|analyze|test) filename [filenames]"
        addFiles [] = pure (False, [])
        addFiles ("json":fs) = (True,) . snd <$> addFiles fs
        addFiles ("source":fName:str:fs) = fmap ((T.pack fName, T.pack str):) <$> addFiles fs
        addFiles (file:fs) = do
          contents <- readFile file
          fmap ((T.pack file, T.pack contents):) <$> addFiles fs
        runOp mode j srcMap = case mode of
          "parse" -> case parse srcMap of
            Right _ -> if j
                         then putStrLn "[]"
                         else pure ()
            Left xs -> if j
                         then putStrLn . T.unpack . decodeUtf8 . BL.toStrict $ encode xs
                         else putStrLn "Parse errors:" >> traverse_ print xs
          "test" -> runCli (fuzz srcMap) >>= \xs ->
              if j
                then putStrLn . T.unpack . decodeUtf8 . BL.toStrict $ encode xs
                else traverse_ (\case
                        FuzzerSuccess (SourceAnnotation _ _ (testName, _)) ->
                          putStrLn . T.unpack $ "✅ " <> testName <> " succeeded"
                        FuzzerFailure _ (SourceAnnotation _ _ (testName, msg)) -> do
                          putStrLn . T.unpack $ "❌ " <> testName <> " failed: " <> msg
                      ) xs
          "compile" -> runCli (compile srcMap) >>= \case
            Right cc -> if j
                          then putStrLn . T.unpack . decodeUtf8 . BL.toStrict $ encode cc
                          else pure ()
            Left xs -> if j
                         then putStrLn . T.unpack . decodeUtf8 . BL.toStrict $ encode xs
                         else putStrLn "Compilation errors:" >> traverse_ print xs
          "analyze" -> runCli (analyze srcMap) >>= \case
            [] -> if j
                    then putStrLn "[]"
                    else pure ()
            xs -> if j
                    then putStrLn . T.unpack . decodeUtf8 . BL.toStrict $ encode xs
                    else putStrLn "Static analysis errors:" >> traverse_ (putStrLn . T.unpack . showTextAnnotation . fmap (\(WithSeverity _ a) -> a)) xs
          _ -> putStrLn $ "Unknown mode: " ++ mode
        parse = fmap concat
              . traverse (uncurry parseSourceWithAnnotations)
              . unSourceMap
        compile = runMemCompilerT
                . compileSourceWithAnnotations True
                . M.fromList
                . unSourceMap
        analyze src = compile src >>= \eCC -> pure $ runDetectors parse (const eCC) id src
        fuzz = runFuzzer Nothing compile
