#!/bin/bash

backup=""
sslFlag=""
if [ -f backup_priv.pem ]; then
    backup=$(cat /backup_priv.pem)
fi
if [ -f ssl.pem ]; then
    sslCert=$(cat /ssl.pem)
    sslFlag="-s /ssl.pem"
fi
if [ "${backup}" = "" ]; then
    x509-sign-subject -n "${MERCATA_USERNAME}" $sslFlag > subject.json
else
    x509-sign-subject -r /backup_priv.pem -n "${MERCATA_USERNAME}" $sslFlag > subject.json
fi

cat subject.json
