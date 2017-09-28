#!/bin/bash

set -x
set -e

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /etc/nginx/auth.htpasswd admin ${uiPassword}
fi

authBasic=${authBasic:-true}
if [ "$authBasic" = true ] ; then
	ln -sf nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf
else
	sed '/auth_basic/d' nginx-nossl.conf > nginx-nossl-noauth.conf
	ln -sf nginx-nossl-noauth.conf /etc/nginx/nginx.conf
fi

service nginx start || exit 1 # Restart container if nginx failed to start (wait for all upstreams to become available)
tail -n0 -F /var/log/nginx/*.log
