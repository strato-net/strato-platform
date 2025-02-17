#!/bin/sh

# Check if aws cli exists
if command -v aws > /dev/null; then
    echo "aws command exists."
else
    echo "aws command does not exist. exiting."
    echo "install and configure aws cli https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if kubectl cli exists
if command -v kubectl > /dev/null; then
    echo "kubectl command exists."
else
    echo "kubectl command does not exist. exiting"
    echo "install and configure kubectl cli https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html"
    exit 1
fi

# Check if jq exists
if command -v jq > /dev/null; then
    echo "jq command exists."
else
    echo "jq command does not exist. exiting"
    echo "install jq with 'brew install jq'"
    exit 1
fi

# Retrieving user arn
arn=$(aws sts get-caller-identity | jq -r '.Arn')

# Check if arn exists
if [ -z "$arn" ]; then
    echo "User details not found. Check if aws cli configured correctly. Exiting"
    exit 1
fi

# Retrieving user_name
user_name=${arn#*/}

# Prompt the user for inputs
echo "Please enter oauth_client_id:"
read oauth_client_id

echo "Please enter oauth_client_secret:"
read oauth_client_secret

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

# Copying a template and replacing place holders
rm -f strato-platform-manifest.yaml
cp strato-platform-manifest.tpl.yaml strato-platform-manifest.yaml

sed -i "" "s/<REPLACE_WITH_NAMESPACE>/$user_name/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_OAUTH_CLIENT_ID>/$oauth_client_id/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_OAUTH_CLIENT_SECRET>/$oauth_client_secret/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_EXT_STORAGE_S3_ACCESS_KEY_ID>/$ext_storage_s3_access_key_id/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_EXT_STORAGE_S3_SECRET_ACCESS_KEY>/$ext_storage_s3_secret_access_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_STRIPE_PUBLISHABLE_KEY>/$stripe_publishable_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_STRIPE_SECRET_KEY>/$stripe_secret_key/g" strato-platform-manifest.yaml
sed -i "" "s/<REPLACE_WITH_VERSION>/$version/g" strato-platform-manifest.yaml

# Cleaning up existig deployments
kubectl delete -f strato-platform-manifest.yaml

# Running a template now
kubectl apply -f strato-platform-manifest.yaml
sleep 30
ingress=$(kubectl get ingress -n $user_name | awk 'NR==2 { print $4 }')

echo "platform url: $ingress"
