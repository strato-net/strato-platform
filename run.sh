#!/bin/bash

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /etc/nginx/auth.htpasswd admin ${uiPassword}
fi

ln -sf nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf
service nginx start
tail -n0 -F /var/log/nginx/*.log
