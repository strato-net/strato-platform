{-# LANGUAGE TemplateHaskell #-}

module VRunOptions where

import           HFlags

import VM

defineEQFlag "vm" [|SolidVM::VM|] "SolidVM|SolidVM2022|EVM" "choice of VM to run"
