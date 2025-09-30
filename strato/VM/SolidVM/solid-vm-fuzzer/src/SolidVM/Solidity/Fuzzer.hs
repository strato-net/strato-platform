{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module SolidVM.Solidity.Fuzzer
  ( runFuzzer,
    module SolidVM.Solidity.Fuzzer.Types,
  )
where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.MemVMContext
import Blockchain.SolidVM.Simple
import Blockchain.Strato.Model.Address
import Blockchain.VMContext (VMBase, runningTests)
import Control.Lens
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Reader
import qualified Data.Aeson as Aeson
import Data.Bool (bool)
import qualified Data.ByteString.Lazy as BL
import Data.List (sortBy)
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromMaybe, maybeToList)
import Data.Ord (comparing)
import Data.Source
import qualified Data.Text as T
import Data.Text.Encoding as T
import Data.Traversable (for)
import Debugger
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Model.Type (Type)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Fuzzer.Types
import Test.QuickCheck
import UnliftIO

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

formatTestName :: T.Text -> T.Text
formatTestName fName = case T.splitOn "_" fName of
  ("it" : rest) -> "Unit test '" <> T.intercalate " " rest <> "'"
  ("property" : rest) -> "Property test '" <> T.intercalate " " rest <> "'"
  _ -> "Custom test '" <> fName <> "'"

withTestName :: (Functor f, Functor g) => T.Text -> f (g a) -> f (g (T.Text, a))
withTestName = fmap . fmap . (,) . formatTestName

success :: Applicative f => SourceAnnotation a -> f FuzzerResult
success ctx = pure . FuzzerSuccess $ "Test succeeded" <$ ctx

runFuzzer :: (MonadUnliftIO m, MonadCatch m, A.Selectable FilePath (Either String String) m) =>
  Maybe DebugSettings ->
  (SourceMap -> m (Either [SourceAnnotation T.Text] CodeCollection)) ->
  SourceMap ->
  m [FuzzerTestAndResult]
runFuzzer dSettings compile src = compile src >>= \case
  Left errs -> pure $ FuzzerFailure Nothing . fmap ("Compilation error: ",) <$> errs
  Right cc -> do
    let args = FuzzerArgs src "" [] "" [] Nothing
    runNoLoggingT . evalMemContextM dSettings . flip runReaderT args $ do
      lift . modify' $ runningTests .~ True
      let contractsInSourceOrder =
            sortBy (comparing (\(_, c') -> c' ^. contractContext . sourceAnnotationStart)) (M.toList $ _contracts cc)
       in fmap concat . for contractsInSourceOrder $ \(cName, c) ->
        if not (describePrefix `T.isPrefixOf` labelToText cName)
          then pure []
          else case _funcArgs <$> _constructor c of
            Just (_ : _) -> pure . fmap (\f -> FuzzerFailure Nothing $ ("Contract constructor", "Expected constructor to have zero arguments") <$ _funcContext f) . maybeToList $ _constructor c
            _ -> fuzzContract cName (_contractContext c) $ \bh addr -> do
              _ <- for (M.lookup "beforeAll" $ _functions c) $ test bh addr "beforeAll"
              let functionsInSourceOrder = sortBy (comparing (\(_, f') -> f' ^. funcContext . sourceAnnotationStart)) (M.toList $ _functions c)
              testResults <- fmap catMaybes . for functionsInSourceOrder $ \(fName, f) -> fmap (fmap (withTestName $ T.pack fName)) $
                if
                    | testPrefix `T.isPrefixOf` labelToText fName -> do
                        _ <- for (M.lookup "beforeEach" $ _functions c) $ test bh addr "beforeEach"
                        result <- Just <$> test bh addr fName f
                        _ <- for (M.lookup "afterEach" $ _functions c) $ test bh addr "afterEach"
                        pure result
                    | propertyPrefix `T.isPrefixOf` labelToText fName -> do
                        _ <- for (M.lookup "beforeEach" $ _functions c) $ test bh addr "beforeEach"
                        result <- Just <$> prop bh addr fName f
                        _ <- for (M.lookup "afterEach" $ _functions c) $ test bh addr "afterEach"
                        pure result
                    | otherwise -> pure Nothing
              _ <- for (M.lookup "afterAll" $ _functions c) $ test bh addr "afterAll"
              pure testResults

accessible :: Maybe Visibility -> Bool
accessible (Just External) = True
accessible (Just Public)   = True
accessible Nothing         = True
accessible _               = False

emptyOrBool :: [(a, IndexedType)] -> Bool
emptyOrBool []                                = True
emptyOrBool [(_, IndexedType _ SVMType.Bool)] = True
emptyOrBool _                                 = False

test :: VMBase m => BlockHeader -> Address -> SolidString -> Func -> FuzzerM m FuzzerResult
test bh addr fName f =
  if accessible $ _funcVisibility f
    then if null $ _funcArgs f
           then if emptyOrBool $ _funcVals f
                  then fuzzFunction bh addr (_funcContext f) fName []
                  else pure . FuzzerFailure Nothing $ ("Test must return () or (bool).") <$ _funcContext f
           else pure . FuzzerFailure Nothing $ ("Expected unit test to have zero arguments. To write a property test, prefix the function name with " <> propertyPrefix <> ".") <$ _funcContext f
    else pure . FuzzerFailure Nothing $ "Test must be a public or external function" <$ _funcContext f

escapeText :: T.Text -> T.Text
escapeText =
  T.replace "\"" "\\\""
    . T.replace "\\" "\\\\"

generateArgs :: [Type] -> IO [T.Text]
generateArgs = traverse generateArg
  where
    generateArg (SVMType.Int _ _) = T.pack . show . abs <$> (generate arbitrary :: IO Integer)
    generateArg (SVMType.String _) = (\t -> "\"" <> t <> "\"") . escapeText <$> generate arbitrary
    generateArg (SVMType.Bytes _ _) = (\t -> "\"" <> t <> "\"") . escapeText <$> generate arbitrary
    generateArg SVMType.Decimal = T.pack . show <$> (generate arbitrary :: IO Double)
    generateArg SVMType.Bool = bool "false" "true" <$> (generate arbitrary :: IO Bool)
    generateArg (SVMType.UserDefined _ a) = generateArg a
    generateArg (SVMType.Address _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Address)
    generateArg (SVMType.Account _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Address)
    generateArg (SVMType.UnknownLabel _ _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Address)
    generateArg (SVMType.Struct _ _) = pure "<struct>" -- haha lol
    generateArg (SVMType.Enum _ _ _) = T.pack . show . abs <$> (generate arbitrary :: IO Integer)
    generateArg (SVMType.Array t l) = do
      n <- case l of
        Just n -> pure . toInteger $ n - 1
        Nothing -> abs <$> generate arbitrary
      ts <- traverse (const $ generateArg t) [0 .. n]
      pure $ "[" <> T.intercalate "," ts <> "]"
    generateArg (SVMType.Contract _) = ("0x" <>) . T.pack . show <$> (generate arbitrary :: IO Address)
    generateArg (SVMType.Mapping _ _ _) = pure "<mapping>" --haha lol
    generateArg (SVMType.Error _ _) = pure "<error>" -- haha xd
    generateArg (SVMType.Variadic) = pure "<variadic>"

prop :: VMBase m => BlockHeader -> Address -> SolidString -> Func -> FuzzerM m FuzzerResult
prop bh addr fName f =
  if accessible $ _funcVisibility f
    then if null $ _funcArgs f
           then pure . FuzzerFailure Nothing $ ("Expected property test to have at least one argument. To write a unit test, prefix the function name with " <> testPrefix <> ".") <$ _funcContext f
           else if emptyOrBool $ _funcVals f
                  then runProp
                  else pure . FuzzerFailure Nothing $ ("Test must return () or (bool).") <$ _funcContext f
    else pure . FuzzerFailure Nothing $ "Test must be a public or external function" <$ _funcContext f
  where
    runProp :: VMBase m => FuzzerM m FuzzerResult
    runProp = do
      n <- asks $ fromMaybe defaultFuzzerRuns . view fuzzerArgsMaxRuns
      runPropNTimes n
    runPropNTimes :: VMBase m => Integer -> FuzzerM m FuzzerResult
    runPropNTimes n | n <= 0 = success $ _funcContext f
    runPropNTimes n = do
      args <- liftIO . generateArgs $ indexedTypeType . snd <$> _funcArgs f
      $logInfoS "runPropNTimes/generateArgs" $ "(" <> T.intercalate ", " args <> ")"
      r <- fuzzFunction bh addr (_funcContext f) fName args
      case r of
        FuzzerSuccess _ -> runPropNTimes $ n - 1
        _ -> pure r

fuzzContract :: VMBase m => SolidString -> SourceAnnotation a -> (BlockHeader -> Address -> FuzzerM m [FuzzerTestAndResult]) -> FuzzerM m [FuzzerTestAndResult]
fuzzContract cName ctx f = local ((fuzzerArgsContractName .~ cName) . (fuzzerArgsCreateArgs .~ [])) $ do
  ~FuzzerArgs {..} <- ask
  contractAddress <- liftIO $ generate arbitrary
  let svmErr (Left e) = e
      svmErr (Right e) = InternalError "SolidVM for non-solidvm code" (show e)
      txArgs =
        def & createNewAddress .~ contractAddress
          & createCode .~ (Code $ T.decodeUtf8 $ BL.toStrict $ Aeson.encode _fuzzerArgsSrc)
          & createContractName .~ labelToText _fuzzerArgsContractName
          & createArgs . argsArgs .~ _fuzzerArgsCreateArgs
          & createArgs . argsMetadata ?~ M.empty
      failure txs e = pure [FuzzerFailure (Just $ FuzzerFailureDetails contractAddress _fuzzerArgsContractName _fuzzerArgsCreateArgs txs) $ (labelToText cName <> " constructor", e) <$ ctx]
      exception txs = failure txs . T.pack . show
  createResults <- lift $ create txArgs
  case erException createResults of
    Just e -> exception [] $ svmErr e
    Nothing -> f (txArgs ^. createArgs . argsBlockData) contractAddress

fuzzFunction :: VMBase m => BlockHeader -> Address -> SourceAnnotation a -> SolidString -> [T.Text] -> FuzzerM m FuzzerResult
fuzzFunction bh contractAddress ctx fName args = local ((fuzzerArgsFuncName .~ fName) . (fuzzerArgsCallArgs .~ args)) $ do
  ~FuzzerArgs {..} <- ask
  let txArgs' =
        def & callArgs . argsBlockData .~ bh
          & callCodeAddress .~ contractAddress
          & callFuncName .~ labelToText _fuzzerArgsFuncName
          & callArgs . argsArgs .~ _fuzzerArgsCallArgs
          & callArgs . argsMetadata ?~ M.empty
  callResults <- lift $ call txArgs'
  let failure txs e = pure . FuzzerFailure (Just $ FuzzerFailureDetails contractAddress _fuzzerArgsContractName _fuzzerArgsCreateArgs txs) $ e <$ ctx
      exception txs = failure txs . T.pack . show
      failure' = failure [FuzzerTx _fuzzerArgsFuncName _fuzzerArgsCallArgs]
      exception' = exception [FuzzerTx _fuzzerArgsFuncName _fuzzerArgsCallArgs]
  $logInfoS "runFuzzerOnce/callResults" (maybe "No return value" T.pack $ erReturnVal callResults)
  case erException callResults of
    Nothing -> case erReturnVal callResults of
      Just ret | ret == "()" || ret == "(true)" -> success ctx
      _ -> failure' $ "Test " <> labelToText _fuzzerArgsFuncName <> " failed with arguments (" <> T.intercalate ", " _fuzzerArgsCallArgs <> ")"
    Just e -> exception' e
