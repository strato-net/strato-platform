{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TypeOperators #-}

module SolidVM.Solidity.SourceTools where

import Blockchain.SolidVM.CodeCollectionDB
import Control.Monad.IO.Class (liftIO)
import qualified Data.Aeson as A
import qualified Data.Map.Strict as M
import Data.Source
import Data.Text (Text)
import Debugger
import GHC.Generics
import Servant
import SolidVM.Model.CodeCollection
import SolidVM.Solidity.Fuzzer
import SolidVM.Solidity.StaticAnalysis

data SourceTools = SourceTools
  { parser :: SourceMap -> Either [SourceAnnotation Text] CodeCollection,
    analyzer :: SourceMap -> [SourceAnnotation (WithSeverity Text)],
    fuzzer :: SourceMap -> (IO [FuzzerResult])
  }
  deriving (Generic)

type SourceToolsAPI =
  PostParse
    :<|> PostAnalyze
    :<|> PostFuzz

type PostParse = "parse" :> ReqBody '[JSON] SourceMap :> Post '[JSON] A.Value

type PostAnalyze = "analyze" :> ReqBody '[JSON] SourceMap :> Post '[JSON] [SourceAnnotation (WithSeverity Text)]

type PostFuzz = "fuzz" :> ReqBody '[JSON] SourceMap :> Post '[JSON] [FuzzerResult]

sourceToolsAPI :: Proxy SourceToolsAPI
sourceToolsAPI = Proxy

postParse ::
  (SourceMap -> Either [SourceAnnotation Text] CodeCollection) ->
  SourceMap ->
  Handler A.Value
postParse parse = pure . either A.toJSON A.toJSON . parse

postAnalyze ::
  (SourceMap -> [SourceAnnotation (WithSeverity Text)]) ->
  SourceMap ->
  Handler [SourceAnnotation (WithSeverity Text)]
postAnalyze analyze = pure . analyze

postFuzz ::
  (SourceMap -> IO [FuzzerResult]) ->
  SourceMap ->
  Handler [FuzzerResult]
postFuzz fuzz args = liftIO (fuzz args)

sourceToolsServer ::
  SourceTools ->
  Server SourceToolsAPI
sourceToolsServer tools =
  postParse (parser tools)
    :<|> postAnalyze (analyzer tools)
    :<|> postFuzz (fuzzer tools)

defaultSourceTools :: Maybe DebugSettings -> SourceTools
defaultSourceTools dSettings =
  let parse =
        fmap concat
          . traverse (uncurry parseSourceWithAnnotations)
          . unSourceMap
      compile =
        compileSourceWithAnnotationsWithoutImports True
          . M.fromList
          . unSourceMap
      analyze = runDetectors parse compile id
      fuzz = runFuzzer dSettings compile
   in SourceTools compile analyze fuzz

initializeSolidVMDebugger :: (Maybe DebugSettings -> SourceTools) -> IO (Maybe (DebugSettings, IO ()))
initializeSolidVMDebugger tools =
  let restServer = restDebuggerAnd sourceToolsAPI (sourceToolsServer . tools . Just)
   in initializeDebugger restServer

initializeSolidVMDebuggerSimple :: IO (Maybe (DebugSettings, IO ()))
initializeSolidVMDebuggerSimple = initializeSolidVMDebugger defaultSourceTools
