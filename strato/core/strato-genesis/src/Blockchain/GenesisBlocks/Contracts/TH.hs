{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.GenesisBlocks.Contracts.TH
  ( typecheckAndEmbedFile
  , typecheckAndEmbedFiles
  ) where

import           Blockchain.SolidVM.CodeCollectionDB
import           Data.ByteString                     (ByteString)
import           Data.FileEmbed                      (embedFile)
import qualified Data.Map                            as Map
import qualified Data.Text                           as Text
import           Language.Haskell.TH.Syntax
import           System.FilePath                     ((</>))

unravel :: Exp -> Q String
unravel (AppE _ r)            = unravel r
unravel (LitE (BytesPrimL s)) = pure $ show s
unravel e                     = fail $ "unravel: " ++ show e

runTypechecker :: Exp -> Map.Map Text.Text Text.Text -> Q Exp
runTypechecker qexp =
  either (fail . show) (pure . const qexp)
  . compileSourceWithAnnotationsWithoutImports False True

typecheckAndEmbedFile :: FilePath -> Q Exp
typecheckAndEmbedFile fp = do
  qexp <- embedFile fp
  bs <- unravel qexp
  runTypechecker qexp $ Map.singleton (Text.pack fp) (Text.pack bs)

typecheckAndEmbedFiles :: String -> [FilePath] -> Q Exp
typecheckAndEmbedFiles dir files = do
  let fps = (dir </>) <$> files
  qexps <- traverse embedFile fps
  bss <- traverse unravel qexps
  let fpsAndExps = zip fps qexps
  qexp <- do
    typ <- [t| [(FilePath, ByteString)] |]
    let e = ListE $ (\(fp,ex) -> TupE [Just . LitE $ StringL fp, Just ex]) <$> fpsAndExps
    pure $ SigE e typ
  runTypechecker qexp
    . Map.fromList
    . map (\(fp, bs) -> (Text.pack fp, Text.pack bs))
    $ zip fps bss