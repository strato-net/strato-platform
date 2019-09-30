#!/usr/bin/env bash
declare -A rooms
rooms[lior]=3875495400
rooms[victor]=3699779139
rooms[eli]=4391858555
rooms[brian]=7399845198
rooms[kieren]=4417789185
rooms[mark]=9518454189
rooms[kelly]=9590270314
rooms[maya]=6339238557
:
if [ $# -lt 1 ]; then
  echo "usage: zoom.sh <name>"
fi
echo ${rooms[$1]} | xclip -selection clipboard -in
echo ${rooms[$1]}
