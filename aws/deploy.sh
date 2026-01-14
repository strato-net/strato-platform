#!/bin/bash

# Deploy Daily Metrics Notification Infrastructure
# This script packages the Lambda function and deploys it with Terraform

set -e

echo "========================================="
echo "Daily Metrics Notification Deployment"
echo "========================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform not found. Please install Terraform >= 1.0"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install and configure AWS CLI"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js >= 18.x"
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# Build Lambda package
echo "Building Lambda deployment package..."
cd lambda/daily-metrics-notification

if [ ! -f "package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi

# Install dependencies
echo "Installing Lambda dependencies..."
npm install --production

# Create deployment package
echo "Creating deployment package..."
zip -r ../../terraform/daily-metrics-notification/lambda-deployment.zip . -x "*.git*" "*.DS_Store"

cd ../..

echo "✅ Lambda package created"
echo ""

# Deploy with Terraform
echo "Deploying infrastructure with Terraform..."
cd terraform/daily-metrics-notification

# Initialize Terraform if needed
if [ ! -d ".terraform" ]; then
    echo "Initializing Terraform..."
    terraform init
fi

# Apply Terraform configuration
echo ""
echo "Applying Terraform configuration..."
terraform apply

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Configure SNS to Amazon Q/Slack integration:"
echo "   - Go to AWS Console → Amazon Q or AWS Chatbot"
echo "   - Set up Slack integration for #ops-monitoring"
echo "   - Subscribe the SNS topic to the integration"
echo ""
echo "2. Test the Lambda function:"
echo "   aws lambda invoke --function-name strato-daily-metrics-notification --payload '{}' response.json"
echo ""
echo "3. View logs:"
echo "   aws logs tail /aws/lambda/strato-daily-metrics-notification --follow"
echo ""
echo "SNS Topic ARN: $(terraform output -raw sns_topic_arn)"
echo ""
