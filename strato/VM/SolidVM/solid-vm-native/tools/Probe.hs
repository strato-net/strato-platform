{-# LANGUAGE OverloadedStrings #-}
module Main where

import Blockchain.SolidVM.CodeCollectionDB (compileSourceWithAnnotationsWithoutImports)
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import qualified Data.Text.IO as T
import SolidVM.Model.CodeCollection
import System.Environment
import Control.Lens

main :: IO ()
main = do
  [file, cname, fname] <- getArgs
  bs <- BL.readFile file
  let initMap = case Aeson.decode bs of
        Just l -> M.fromList (l :: [(T.Text, T.Text)])
        Nothing -> M.singleton T.empty (T.pack $ show bs)
  src <- if M.size initMap == 1 && M.member T.empty initMap then (\s -> M.singleton T.empty s) <$> T.readFile file else pure initMap
  case compileSourceWithAnnotationsWithoutImports False False src of
    Left errs -> putStrLn $ "PARSE ERRORS: " ++ show errs
    Right cc -> do
      putStrLn $ "contracts: " ++ show (M.keys (cc ^. contracts))
      case M.lookup (T.pack cname) (cc ^. contracts) of
        Nothing -> putStrLn "no such contract"
        Just c -> do
          putStrLn $ "storage: " ++ show (M.toList (M.map _varType (c ^. storageDefs)))
          case M.lookup (T.pack fname) (c ^. functions) of
            Nothing -> putStrLn "no such function"
            Just f -> do
              putStrLn $ "args: " ++ show (f ^. funcArgs)
              putStrLn $ "vals: " ++ show (f ^. funcVals)
              putStrLn $ "modifiers: " ++ show (fmap (fmap (fmap (() <$))) (f ^. funcModifiers))
              putStrLn $ "overloads: " ++ show (length (f ^. funcOverload))
              mapM_ (putStrLn . show . fmap (const ())) (maybe [] id (f ^. funcContents))
