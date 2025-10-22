{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.GenesisBlocks.Contracts.TH where

import Blockchain.SolidVM.CodeCollectionDB
import           Data.FileEmbed                    (embedDir)
import           Data.List                         (isSuffixOf)
import qualified Data.Map                          as Map
import           Data.Maybe
import qualified Data.Text as Text
import Language.Haskell.TH.Syntax

typecheckAndEmbedDir :: String -> Maybe [FilePath] -> Q Exp
typecheckAndEmbedDir dir mFilesToTypecheck = do
  qexp <- embedDir dir
  let unravel (AppE _ r) = unravel r
      unravel (LitE (BytesPrimL s)) = pure $ show s
      unravel e = fail $ "typecheckAndEmbedDir/unravel: " ++ show e
  fpsAndBss <- case qexp of
    SigE (ListE exps) _ -> catMaybes <$> traverse (\case
        TupE [Just (LitE (StringL p)), Just b] | ".sol" `isSuffixOf` p
                              && maybe True (elem p) mFilesToTypecheck -> Just . (p,) <$> unravel b
        TupE [Just (LitE (StringL _)), Just _]                         -> pure Nothing
        ex -> fail $ "typecheckAndEmbedDir: Expression is not a tuple: " ++ show ex
      ) exps
    _ -> fail $ "typecheckAndEmbedDir: embedDir did not return a list of files: " ++ show qexp
  either (fail . show) (pure . const qexp)
    . compileSourceWithAnnotationsWithoutImports False True
    . Map.fromList
    . map (\(fp, bs) -> (Text.pack fp, Text.pack bs))
    $ fpsAndBss

fileList :: [FilePath] -> Q Exp
fileList files = do
  typ <- [t| [FilePath] |]
  let e = ListE $ LitE . StringL <$> files
  pure $ SigE e typ