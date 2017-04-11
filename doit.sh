#!/bin/bash

#cd /usr/bin/bloc/
blocserver="/usr/bin/blockapps-bloc"
locale-gen "en_US.UTF-8"
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
exec $blocserver -P $pghost -u $pguser -p $pgpasswd --stratourl=$stratourl/strato-api/eth/v1.2 --cirrusurl=$cirrusurl 
