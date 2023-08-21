#!/bin/sh

arn=$(aws sts get-caller-identity | jq -r '.Arn')
user_name=${arn#*/}

# Prompt the user for input
echo "Please enter outh_client_id:"
read outh_client_id

echo "Please enter outh_client_secret:"
read outh_client_secret

echo "Please enter ext_storage_s3_access_key_id:"
read ext_storage_s3_access_key_id

echo "Please enter ext_storage_s3_secret_access_key:"
read ext_storage_s3_secret_access_key

echo "Please enter stripe_publishable_key:"
read stripe_publishable_key

echo "Please enter stripe_secret_key:"
read stripe_secret_key

echo "Please enter strato version for ex: 9.0.0-8354b3ddb:"
read version

kubectl delete -f strato-platform-manifest.yaml
rm -f strato-platform-manifest.yaml
cp strato-platform-manifest.tpl.yaml strato-platform-manifest.yaml

sed -i "" "s/<REPLACE_WITH_NAMESPACE>/$user_name/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_OAUTH_CLIENT_ID>/$outh_client_id/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_OAUTH_CLIENT_SECRET>/$outh_client_secret/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_EXT_STORAGE_S3_ACCESS_KEY_ID>/$ext_storage_s3_access_key_id/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_EXT_STORAGE_S3_SECRET_ACCESS_KEY>/$ext_storage_s3_secret_access_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_STRIPE_PUBLISHABLE_KEY>/$stripe_publishable_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_STRIPE_SECRET_KEY>/$stripe_secret_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_VERSION>/$version/g" strato-platform-manifest.yaml

kubectl apply -f strato-platform-manifest.yaml
sleep 30
ingress=$(kubectl get ingress -n $user_name | awk 'NR==2 { print $4 }')

echo "platform url: $ingress"
