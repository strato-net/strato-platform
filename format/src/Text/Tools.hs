

module Text.Tools where

import Text.Colors as C

box :: [String] -> String
box strings = unlines $
  [C.magenta ("╔" ++ replicate (width - 2) '═' ++ "╗")]
  ++ map (\s -> C.magenta "║ " ++ C.white s ++ replicate (width - printedLength s - 4) ' ' ++ C.magenta " ║") strings
  ++ [C.magenta ("╚" ++ replicate (width - 2) '═' ++ "╝")]
  where width = maximum (map length strings) + 4
        printedLength = go False
        go :: Bool -> String -> Int
        go True ('m':t) = go False t
        go True (_:t) = go True t
        go False ('\ESC':t) = go True t
        go False (_:t) = 1 + go False t
        go _ [] = 0




boringBox :: [String] -> String
boringBox strings = unlines $
  [C.magenta (replicate width '=')]
  ++ map (\s -> C.magenta "| " ++ C.white s ++ replicate (width - printedLength s - 4) ' ' ++ C.magenta " |") strings
  ++ [C.magenta (replicate width '=')]
  where width = maximum (map length strings) + 4
        printedLength = go False
        go :: Bool -> String -> Int
        go True ('m':t) = go False t
        go True (_:t) = go True t
        go False ('\ESC':t) = go True t
        go False (_:t) = 1 + go False t
        go _ [] = 0


tab::String->String
tab []          = []
tab ('\n':rest) = '\n':' ':' ':' ':' ':tab rest
tab (c:rest)    = c:tab rest


setTitle :: String->IO()
setTitle value = do
  putStr $ "\ESC]0;" ++ value ++ "\007"


shorten :: Int -> String -> String
shorten maxLen s | length s <= maxLen = s
shorten maxLen s = take maxLen s ++ "..."


wrap :: Int -> String -> [String]
wrap maxLen s | length s > maxLen = take maxLen s:wrap maxLen (drop maxLen s)
wrap _ s = [s]
