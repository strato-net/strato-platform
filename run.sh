#!/bin/bash

set -x
set -e
authBasic=${authBasic:-true}
blockTime=${blockTime:-13}

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /etc/nginx/auth.htpasswd admin ${uiPassword}
fi

ln -sf nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf

BLOC_TIMEOUT=$((blockTime * 5))
sed -i 's/<BLOC_TIMEOUT>/'"$BLOC_TIMEOUT"'/g' /etc/nginx/nginx.conf

if [ "$authBasic" != true ] ; then
	sed -i '/auth_basic/d' /etc/nginx/nginx.conf
fi

service nginx start || exit 1 # Restart container if nginx failed to start (wait for all upstreams to become available)
tail -n0 -F /var/log/nginx/*.log
