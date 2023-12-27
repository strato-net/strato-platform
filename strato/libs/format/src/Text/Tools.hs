{-# LANGUAGE TemplateHaskell #-}

module Text.Tools
  ( box,
    boringBox,
    formatBool,
    grayBox,
    multilineLog,
    multilineDebugLog,
    setTitle,
    shorten,
    tab,
    tab',
    wrap,
  )
where

import BlockApps.Logging
import Control.Monad
import qualified Data.Text as T
import Text.Colors as C

box :: [String] -> String
box = boxWithProperty C.magenta

grayBox :: [String] -> String
grayBox = boxWithProperty (C.dim . C.white)

boxWithProperty :: (String -> String) -> [String] -> String
boxWithProperty property strings =
  unlines $
    [property ("╔" ++ replicate (width - 2) '═' ++ "╗")]
      ++ map (\s -> property "║ " ++ C.white s ++ replicate (width - printedLength s - 4) ' ' ++ property " ║") strings
      ++ [property ("╚" ++ replicate (width - 2) '═' ++ "╝")]
  where
    width = maximum (map printedLength strings) + 4

printedLength :: String -> Int
printedLength = go False
  where
    go :: Bool -> String -> Int
    go True ('m' : t) = go False t
    go True (_ : t) = go True t
    go False ('\ESC' : t) = go True t
    go False (_ : t) = 1 + go False t
    go _ [] = 0

multilineLog ::
  MonadLogger m =>
  T.Text ->
  String ->
  m ()
multilineLog source theLines = do
  forM_ (lines theLines) $ \theLine ->
    $logInfoS source $ T.pack theLine
  
multilineDebugLog ::
  MonadLogger m =>
  T.Text ->
  String ->
  m ()
multilineDebugLog source theLines = do
  forM_ (lines theLines) $ \theLine ->
    $logDebugS source $ T.pack theLine


boringBox :: [String] -> String
boringBox [] = ""
boringBox strings =
  unlines $
    [C.magenta (replicate width '=')]
      ++ map (\s -> C.magenta "| " ++ C.white s ++ replicate (width - printedLength s - 4) ' ' ++ C.magenta " |") strings
      ++ [C.magenta (replicate width '=')]
  where
    width = maximum (map printedLength strings) + 4

formatBool :: Bool -> String
formatBool True = C.green "True"
formatBool False = C.red "False"

tab :: String -> String
tab s = ' ' : ' ' : ' ' : ' ' : tab' s

-- This is a second version of "tab" that skips the first line
tab' :: String -> String
tab' [] = []
tab' ('\n' : rest) = '\n' : ' ' : ' ' : ' ' : ' ' : tab' rest
tab' (c : rest) = c : tab' rest

setTitle :: String -> IO ()
setTitle value = do
  putStr $ "\ESC]0;" ++ value ++ "\007"

shorten :: Int -> String -> String
shorten maxLen s | length s <= maxLen = s
shorten maxLen s = take maxLen s ++ "..."

wrap :: Int -> String -> [String]
wrap maxLen s | length s > maxLen = take maxLen s : wrap maxLen (drop maxLen s)
wrap _ s = [s]
