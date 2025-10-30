
module NetworkInterfaceEvent where

import NetworkInterface

data NetworkInterfaceEvent =
  Connected NetworkInterface
  | Disconnected NetworkInterface
  | Changed (Maybe NetworkInterface) (Maybe NetworkInterface)

diffToEvent :: Maybe NetworkInterface -> Maybe NetworkInterface -> Maybe NetworkInterfaceEvent
diffToEvent old new | old == new = Nothing
diffToEvent (Just old) (Just new) | isDisconnected old = Just $ Connected new
diffToEvent Nothing (Just new) = Just $ Connected new
diffToEvent (Just old) Nothing = Just $ Disconnected old
diffToEvent (Just old) (Just new) | isDisconnected new = Just $ Disconnected old
diffToEvent old new = Just $ Changed old new
