{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Solidity.Fuzzer
  ( runFuzzer,
    module SolidVM.Solidity.Fuzzer.Types,
  )
where

import BlockApps.Logging
import Blockchain.MemVMContext
import Blockchain.SolidVM.Simple
import Blockchain.Strato.Model.Address
import Control.Lens
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Reader
import qualified Data.Aeson as Aeson
import Data.Bool (bool)
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, maybeToList)
import Data.Source
import qualified Data.Text as T
import Data.Traversable (for)
import Debugger
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Fuzzer.Types
import Test.QuickCheck

defaultFuzzerRuns :: Integer
defaultFuzzerRuns = 100
{-# INLINE defaultFuzzerRuns #-}

describePrefix :: T.Text
describePrefix = "Describe_"
{-# INLINE describePrefix #-}

testPrefix :: T.Text
testPrefix = "it_"
{-# INLINE testPrefix #-}

propertyPrefix :: T.Text
propertyPrefix = "property_"
{-# INLINE propertyPrefix #-}

success :: Applicative f => SourceAnnotation a -> f FuzzerResult
success ctx = pure . FuzzerSuccess $ "Test succeeded" <$ ctx

runFuzzer ::
  Maybe DebugSettings ->
  (SourceMap -> Either [SourceAnnotation T.Text] CodeCollection) ->
  SourceMap ->
  IO [FuzzerResult]
runFuzzer dSettings compile src = flip (either $ pure . map (FuzzerFailure Nothing)) (compile src) $ \cc -> do
  let args = FuzzerArgs src "" "" "" "" Nothing
  runLoggingT . evalMemContextM dSettings . flip runReaderT args $
    fmap concat . for (M.toList $ _contracts cc) $ \(cName, c) ->
      if not (describePrefix `T.isPrefixOf` labelToText cName)
        then pure []
        else case _funcArgs <$> _constructor c of
          Just (_ : _) -> pure . fmap (\f -> FuzzerFailure Nothing $ "Expected constructor to have zero arguments" <$ _funcContext f) . maybeToList $ _constructor c
          _ -> fmap concat . for (M.toList $ _functions c) $ \(fName, f) ->
            if
                | testPrefix `T.isPrefixOf` labelToText fName -> (: []) <$> test cName fName f
                | propertyPrefix `T.isPrefixOf` labelToText fName -> (: []) <$> prop cName fName f
                | otherwise -> pure []

test :: SolidString -> SolidString -> Func -> FuzzerM FuzzerResult
test cName fName f = case (_funcVisibility f, _funcArgs f, _funcVals f) of
  (Just External, [], [(_, IndexedType _ SVMType.Bool)]) ->
    flip local (runFuzzerOnce $ _funcContext f) $
      (fuzzerArgsContractName .~ cName)
        . (fuzzerArgsCreateArgs .~ "()")
        . (fuzzerArgsFuncName .~ fName)
        . (fuzzerArgsCallArgs .~ "()")
  (_, [], [(_, IndexedType _ SVMType.Bool)]) ->
    pure . FuzzerFailure Nothing $ "Test must be marked as external" <$ _funcContext f
  (_, _, [(_, IndexedType _ SVMType.Bool)]) ->
    pure . FuzzerFailure Nothing $ ("Expected unit test to have zero arguments. To write a property test, prefix the function name with " <> propertyPrefix <> ".") <$ _funcContext f
  _ ->
    pure . FuzzerFailure Nothing $ ("Test must return (bool).") <$ _funcContext f

escapeText :: T.Text -> T.Text
escapeText =
  T.replace "\"" "\\\""
    . T.replace "\\" "\\\\"

generateArgString :: [Type] -> IO T.Text
generateArgString = fmap (\t -> "(" <> T.intercalate "," t <> ")") . traverse generateArg
  where
    generateArg (SVMType.Int _ _) = T.pack . show . abs <$> (generate arbitrary :: IO Integer)
    generateArg (SVMType.String _) = (\t -> "\"" <> t <> "\"") . escapeText <$> generate arbitrary
    generateArg (SVMType.Bytes _ _) = (\t -> "\"" <> t <> "\"") . escapeText <$> generate arbitrary
    generateArg SVMType.Decimal = T.pack . show <$> (generate arbitrary :: IO Double)
    generateArg SVMType.Bool = bool "false" "true" <$> (generate arbitrary :: IO Bool)
    generateArg (SVMType.UserDefined _ a) = generateArg a
    generateArg (SVMType.Address _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Address)
    generateArg (SVMType.Account _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Account)
    generateArg (SVMType.UnknownLabel _ _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Account)
    generateArg (SVMType.Struct _ _) = pure "<struct>" -- haha lol
    generateArg (SVMType.Enum _ _ _) = T.pack . show . abs <$> (generate arbitrary :: IO Integer)
    generateArg (SVMType.Array t l) = do
      n <- case l of
        Just n -> pure . toInteger $ n - 1
        Nothing -> abs <$> generate arbitrary
      ts <- traverse (const $ generateArg t) [0 .. n]
      pure $ "[" <> T.intercalate "," ts <> "]"
    generateArg (SVMType.Contract _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Account)
    generateArg (SVMType.Mapping _ _ _) = pure "<mapping>" --haha lol
    generateArg (SVMType.Error _ _) = pure "<error>" -- haha xd
    generateArg (SVMType.Variadic) = pure "<variadic>"

prop :: SolidString -> SolidString -> Func -> FuzzerM FuzzerResult
prop cName fName f = case (_funcVisibility f, _funcArgs f, _funcVals f) of
  (Just External, (_ : _), [(_, IndexedType _ SVMType.Bool)]) ->
    flip local runProp $
      (fuzzerArgsContractName .~ cName)
        . (fuzzerArgsCreateArgs .~ "()")
        . (fuzzerArgsFuncName .~ fName)
  (_, (_ : _), [(_, IndexedType _ SVMType.Bool)]) ->
    pure . FuzzerFailure Nothing $ "Test must be marked as external" <$ _funcContext f
  (_, _, [(_, IndexedType _ SVMType.Bool)]) ->
    pure . FuzzerFailure Nothing $ ("Expected property test to have at least one argument. To write a unit test, prefix the function name with " <> testPrefix <> ".") <$ _funcContext f
  _ ->
    pure . FuzzerFailure Nothing $ ("Test must return (bool).") <$ _funcContext f
  where
    runProp :: FuzzerM FuzzerResult
    runProp = do
      n <- asks $ fromMaybe defaultFuzzerRuns . view fuzzerArgsMaxRuns
      runPropNTimes n
    runPropNTimes :: Integer -> FuzzerM FuzzerResult
    runPropNTimes n | n <= 0 = success $ _funcContext f
    runPropNTimes n = do
      argString <- liftIO . generateArgString $ indexedTypeType . snd <$> _funcArgs f
      $logInfoS "runPropNTimes/generateArgString" argString
      r <- flip local (runFuzzerOnce $ _funcContext f) $ fuzzerArgsCallArgs .~ argString
      case r of
        FuzzerSuccess _ -> runPropNTimes $ n - 1
        _ -> pure r

runFuzzerOnce :: SourceAnnotation a -> FuzzerM FuzzerResult
runFuzzerOnce ctx = do
  ~FuzzerArgs {..} <- ask
  contractAddress <- liftIO $ flip Account Nothing <$> generate arbitrary
  let svmErr (Left e) = e
      svmErr (Right e) = InternalError "SolidVM for non-solidvm code" (show e)
      txArgs =
        def & createNewAddress .~ contractAddress
          & createCode .~ (Code . BL.toStrict $ Aeson.encode _fuzzerArgsSrc)
          & createArgs . argsMetadata ?~ M.empty
          & createArgs . argsMetadata . _Just . at "name" ?~ labelToText _fuzzerArgsContractName
          & createArgs . argsMetadata . _Just . at "args" ?~ _fuzzerArgsCreateArgs
      failure txs e = pure . FuzzerFailure (Just $ FuzzerFailureDetails contractAddress _fuzzerArgsContractName _fuzzerArgsCreateArgs txs) $ e <$ ctx
      exception txs = failure txs . T.pack . show
  createResults <- lift $ create txArgs
  case erException createResults of
    Just e -> exception [] $ svmErr e
    Nothing -> do
      let txArgs' =
            def & callArgs . argsBlockData .~ txArgs ^. createArgs . argsBlockData
              & callCodeAddress .~ contractAddress
              & callArgs . argsMetadata ?~ M.empty
              & callArgs . argsMetadata . _Just . at "funcName" ?~ labelToText _fuzzerArgsFuncName
              & callArgs . argsMetadata . _Just . at "args" ?~ _fuzzerArgsCallArgs
      callResults <- lift $ call txArgs'
      let failure' = failure [FuzzerTx _fuzzerArgsFuncName _fuzzerArgsCallArgs]
          exception' = exception [FuzzerTx _fuzzerArgsFuncName _fuzzerArgsCallArgs]
      $logInfoS "runFuzzerOnce/callResults" (maybe "No return value" T.pack $ erReturnVal callResults)
      case erException callResults of
        Nothing -> case erReturnVal callResults of
          Just "(true)" -> success ctx
          _ -> failure' $ "Test " <> labelToText _fuzzerArgsFuncName <> " failed with arguments " <> _fuzzerArgsCallArgs
        Just e -> exception' e
