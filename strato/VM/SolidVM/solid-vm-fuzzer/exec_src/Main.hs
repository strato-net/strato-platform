{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeSynonymInstances #-}

import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Control.Applicative ((<|>))
import Control.Lens ((.~), (&))
import Control.Monad (forever, void)
import Control.Monad.Catch (MonadCatch, MonadThrow)
import Control.Monad.IO.Class
import qualified Control.Monad.Change.Alter as A
import Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Char8 as C8
import Data.Default (def)
import Data.Foldable (asum, find, traverse_)
import Data.Maybe (fromMaybe)
import Data.Source.Map
import qualified Data.Map.Strict as M
import Data.Source.Annotation
import Data.Source.Severity
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Debugger
import Debugger.Options ()
import HFlags
import SolidVM.Solidity.Fuzzer
import SolidVM.Solidity.StaticAnalysis
import System.IO (hSetEncoding, utf8)
import UnliftIO

newtype Cli a = Cli { runCli :: IO a }
  deriving (Functor, Applicative, Monad, MonadIO, MonadUnliftIO, MonadThrow, MonadCatch)

instance {-# OVERLAPPING #-} A.Selectable FilePath (Either String String) Cli where
  select _ filePath =
    Just <$> catch (Right <$> liftIO (readFile filePath)) (\(_ :: SomeException) -> pure . Left $ "Could not find file by name of " <> filePath)

putStrLn' :: BL.ByteString -> IO ()
putStrLn' payload = do
  BL.hPut stdout payload
  C8.hPutStr stdout "\n"
  hFlush stdout

main :: IO ()
main = do
  _ <- $initHFlags "solid-vm-cli"
  hSetBuffering stdin  LineBuffering
  hSetBuffering stderr LineBuffering
  hSetEncoding stdout utf8
  hSetEncoding stdin  utf8

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
        stringJson :: FromJSON a => String -> Maybe a
        stringJson = decode' . BL.fromStrict . encodeUtf8 . T.pack
        printJSON :: ToJSON a => a -> IO ()
        printJSON = putStrLn' . encode
        runOp mode j srcMap = case mode of
          "parse" -> case parse srcMap of
            Right _ -> if j
                         then putStrLn "[]"
                         else pure ()
            Left xs -> if j
                         then printJSON xs
                         else putStrLn "Parse errors:" >> traverse_ print xs
          "test" -> runCli (fuzz Nothing srcMap) >>= \xs ->
              if j
                then printJSON xs
                else traverse_ (\case
                        FuzzerSuccess (SourceAnnotation _ _ (testName, _)) ->
                          putStrLn . T.unpack $ "✅ " <> testName <> " succeeded"
                        FuzzerFailure _ (SourceAnnotation _ _ (testName, msg)) -> do
                          putStrLn . T.unpack $ "❌ " <> testName <> " failed: " <> msg
                      ) xs
          "compile" -> runCli (compile srcMap) >>= \case
            Right cc -> if j
                          then printJSON cc
                          else pure ()
            Left xs -> if j
                         then printJSON xs
                         else putStrLn "Compilation errors:" >> traverse_ print xs
          "analyze" -> runCli (analyze srcMap) >>= \case
            [] -> if j
                    then putStrLn "[]"
                    else pure ()
            xs -> if j
                    then printJSON xs
                    else putStrLn "Static analysis errors:" >> traverse_ (putStrLn . T.unpack . showTextAnnotation . fmap (\(WithSeverity _ a) -> a)) xs
          "debug" -> do
            dSettings <- atomically newDebugSettings
            q <- newTQueueIO
            let (bps', srcMap') = case find ((== "breakpoints") . fst) $ unSourceMap srcMap of
                   Nothing -> ("[]", srcMap)
                   Just (_,bps) -> (T.unpack bps, SourceMap . filter ((/= "breakpoints") . fst) $ unSourceMap srcMap)
            case stringJson bps' of
              Nothing -> do
                putStrLn $ "Could not parse initial breakpoints: " ++ bps'
                putStrLn $ "Example: "
                printJSON . UnconditionalBP $ def & sourcePositionName .~ "mercata/contracts/tests/BaseCodeCollection.test.sol"
              Just bps -> do
                void $ addBreakpoints bps dSettings
                let loop = do
                      req <- getLine
                      case stringJson req of
                        Nothing -> loop
                        Just rpc -> case rpcMethod rpc of
                          "disconnect" -> pure ()
                          _ -> do
                            handleInput dSettings rpc >>= \case
                              Nothing -> loop
                              Just resp -> atomically $ writeTQueue q resp
                            loop
                void . runConcurrently . asum $ map Concurrently
                  [ void $ runCli (fuzz (Just dSettings) srcMap')
                  , loop
                  , forever $ handleOutput dSettings >>= atomically . writeTQueue q
                  , forever $ atomically (readTQueue q) >>= printJSON
                  ]
          _ -> putStrLn $ "Unknown mode: " ++ mode
        parse = fmap concat
              . traverse (uncurry parseSourceWithAnnotations)
              . unSourceMap
        compile = runMemCompilerT
                . compileSourceWithAnnotations True True
                . M.fromList
                . unSourceMap
        analyze src = compile src >>= \eCC -> pure $ runDetectors parse (const eCC) id src
        fuzz dSettings = runFuzzer dSettings compile
        handleInput :: DebugSettings -> JsonRpcMessage -> IO (Maybe JsonRpcMessage)
        handleInput dSettings (Rpc i m _ v) = case m of
          "pause" -> Nothing <$ pause dSettings
          "continue" -> Nothing <$ resume dSettings
          "stepIn"  -> Nothing <$ stepIn dSettings
          "stepOut" -> Nothing <$ stepOut dSettings
          "stepOver" -> Nothing <$ stepOver dSettings
          "breakpoints" -> case fromJSON v of
            Success bps -> do
              currentBps <- getBreakpoints dSettings
              if S.null $ S.fromList bps `S.intersection` S.fromList currentBps
                then Just . Rpc i m RpcResult . toJSON <$> addBreakpoints bps dSettings
                else Just . Rpc i m RpcResult . toJSON <$> setBreakpoints bps dSettings
            Aeson.Error msg -> do
              pure . Just . Rpc i m RpcError $ toJSON msg
          -- "watches":xs -> Just <$> case xs of
          --   "add":ws -> addWatches (T.pack <$> ws) dSettings
          --   "remove":ws -> removeWatches (T.pack <$> ws) dSettings
          --   ws -> addWatches (T.pack <$> ws) dSettings
          "eval" -> case fromJSON v of
            Success es -> do
              ress <- evaluateExpressions (T.pack <$> es) dSettings
              pure . Just . Rpc i m RpcResult $ toJSON ress
            Aeson.Error msg -> pure . Just . Rpc i m RpcError $ toJSON msg
          "trace" -> status dSettings >>= \case
            Paused s -> pure . Just . Rpc i m RpcResult . toJSON $ debugStateCallStack s
            _ -> pure . Just . Rpc i m RpcResult $ toJSON ([] :: [SourcePosition])
          "variables" -> status dSettings >>= \case
            Paused s -> pure . Just . Rpc i m RpcResult . toJSON $ debugStateVariables s
            _ -> pure . Just . Rpc i m RpcResult $ object []
          _ -> Just . Rpc i "status" RpcParams . toJSON <$> status dSettings
        handleOutput :: DebugSettings -> IO JsonRpcMessage
        handleOutput DebugSettings{..} = atomically $ do
          _ <- takeTMVar ping
          cur <- readTVar current
          pure . Rpc Nothing "status" RpcParams $ toJSON cur

data JsonRpcType = RpcParams | RpcResult | RpcError
  deriving (Eq, Ord, Show)

data JsonRpcMessage = Rpc
  { rpcId      :: Maybe Int
  , rpcMethod  :: T.Text
  , rpcType    :: JsonRpcType
  , rpcValue   :: Value
  } deriving (Eq, Ord, Show)

instance ToJSON JsonRpcMessage where
  toJSON (Rpc i m t v) = object $
    [ "jsonrpc" .= ("2.0" :: T.Text)
    , "id" .= i
    , "method" .= m
    ] ++
    ( case t of
      RpcParams -> ["params" .= v]
      RpcResult -> ["result" .= v]
      RpcError  -> ["error"  .= v]
    )

instance FromJSON JsonRpcMessage where
  parseJSON = withObject "JSON-RPC Request" $ \o -> do
    i <- o .:? "id"
    m <- o .: "method"
    p <- o .:? "params"
    r <- o .:? "result"
    e <- o .:? "error"
    let mTV = ((RpcParams,) <$> p)
          <|> ((RpcResult,) <$> r)
          <|> ((RpcError,)  <$> e)
        (t,v) = fromMaybe (RpcParams, object []) mTV
    pure $ Rpc i m t v