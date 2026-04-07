module Main where

import Strato.Auth (ensureAuthenticated)

main :: IO ()
main = do
  ensureAuthenticated
  putStrLn "Authenticated."
