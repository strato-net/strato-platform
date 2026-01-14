# AWS Infrastructure for STRATO Platform

This directory contains AWS infrastructure configurations for the STRATO blockchain platform.

## Daily Metrics Notification

Automated daily Slack notifications with network metrics from CloudWatch.

### Architecture

```
CloudWatch Metrics
       ↓
EventBridge Scheduler (daily trigger)
       ↓
Lambda Function (metrics aggregation)
       ↓
SNS Topic
       ↓
Amazon Q
       ↓
Slack (#ops-monitoring)
```

### Metrics Reported

The daily report includes the following metrics (24-hour averages):

**Testnet Sync Metrics:**
- Average sync time per block
- Average total sync time

**Mainnet Sync Metrics:**
- Average sync time per block
- Average total sync time

**Transaction Metrics:**
- Average transaction time (from Oracle service)

### CloudWatch Metrics Sources

The following CloudWatch metrics are collected:

| Namespace | Metric Name | Description |
|-----------|-------------|-------------|
| `Testnet/Synctest/TimeMins` | TestnetSyncTime | Total sync time for testnet |
| `Testnet/Synctest/TimePerBlockSec` | TestnetSyncTimePerBlock | Sync time per block for testnet |
| `Mainnet/Synctest/TimeMins` | MainnetSyncTime | Total sync time for mainnet |
| `Mainnet/Synctest/TimePerBlockSec` | MainnetSyncTimePerBlock | Sync time per block for mainnet |
| `Testnet/Oracle/Transactions` | TransactionDuration | Oracle transaction duration |

These metrics are pushed by:
- `pipelines/Jenkinsfile.synctest` - Sync test metrics
- `mercata/services/oracle/src/utils/txMetricsService.ts` - Transaction metrics

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Terraform >= 1.0
3. Node.js >= 18.x (for Lambda function development)
4. Access to AWS account with permissions to create:
   - Lambda functions
   - SNS topics
   - EventBridge Schedulers
   - IAM roles and policies
   - CloudWatch Logs

### Setup Instructions

#### 1. Build Lambda Deployment Package

```bash
cd lambda/daily-metrics-notification
npm install --production
zip -r ../lambda-deployment.zip .
cd ..
```

#### 2. Deploy with Terraform

```bash
cd terraform/daily-metrics-notification

# Initialize Terraform
terraform init

# Review the execution plan
terraform plan

# Apply the configuration
terraform apply
```

#### 3. Configure SNS to Amazon Q Integration

After Terraform deployment, you need to manually configure the SNS topic to forward notifications to Slack via Amazon Q:

1. Go to AWS Console → Amazon Q
2. Set up a Slack integration for #ops-monitoring channel
3. Configure the SNS topic (output from Terraform) to trigger the Amazon Q integration

Alternatively, you can use AWS Chatbot:

1. Go to AWS Console → AWS Chatbot
2. Create a new Slack channel configuration
3. Select the Slack workspace and #ops-monitoring channel
4. Subscribe the SNS topic (ARN from Terraform output) to this Chatbot configuration

#### 4. Verify Deployment

```bash
# Test the Lambda function manually
aws lambda invoke \
  --function-name strato-daily-metrics-notification \
  --payload '{}' \
  response.json

# Check the response
cat response.json

# View Lambda logs
aws logs tail /aws/lambda/strato-daily-metrics-notification --follow
```

### Configuration

The following variables can be customized in `terraform/daily-metrics-notification/main.tf`:

- `aws_region` - AWS region (default: us-east-1)
- `environment` - Environment name (default: production)
- `notification_schedule` - Cron expression for daily trigger (default: 9 AM UTC)

To change the schedule, update the `notification_schedule` variable:

```hcl
variable "notification_schedule" {
  default = "cron(0 9 * * ? *)"  # 9 AM UTC daily
}
```

EventBridge Scheduler cron format: `cron(Minutes Hours Day-of-month Month Day-of-week Year)`

Examples:
- `cron(0 9 * * ? *)` - 9 AM UTC every day
- `cron(0 0 * * ? *)` - Midnight UTC every day
- `cron(0 12 * * ? *)` - Noon UTC every day

### Monitoring

#### Lambda Function Logs

```bash
# View recent logs
aws logs tail /aws/lambda/strato-daily-metrics-notification --since 1h

# Follow logs in real-time
aws logs tail /aws/lambda/strato-daily-metrics-notification --follow
```

#### Check Scheduler Status

```bash
# Get scheduler details
aws scheduler get-schedule \
  --name strato-daily-metrics-notification \
  --group-name default
```

#### Verify SNS Topic

```bash
# List SNS subscriptions
aws sns list-subscriptions-by-topic \
  --topic-arn $(terraform output -raw sns_topic_arn)
```

### Troubleshooting

#### Lambda Not Triggering

1. Check EventBridge Scheduler status:
   ```bash
   aws scheduler get-schedule --name strato-daily-metrics-notification --group-name default
   ```

2. Verify IAM permissions for the scheduler role

3. Check Lambda function logs for errors

#### No Metrics Data

1. Verify CloudWatch metrics are being published:
   ```bash
   aws cloudwatch list-metrics --namespace Testnet/Synctest/TimeMins
   ```

2. Check the time range - metrics need to be published in the last 24 hours

3. Review Lambda logs for specific errors

#### SNS Not Delivering to Slack

1. Verify SNS topic has a subscription configured
2. Check Amazon Q or AWS Chatbot integration status
3. Test SNS manually:
   ```bash
   aws sns publish \
     --topic-arn $(terraform output -raw sns_topic_arn) \
     --subject "Test Message" \
     --message "This is a test notification"
   ```

### Manual Trigger

To manually trigger the notification (useful for testing):

```bash
aws lambda invoke \
  --function-name strato-daily-metrics-notification \
  --payload '{}' \
  response.json
```

### Cleanup

To remove all infrastructure:

```bash
cd terraform/daily-metrics-notification
terraform destroy
```

## Cost Estimate

This infrastructure has minimal cost:

- **Lambda**: ~$0.20/month (assuming 1 invocation per day at 3 seconds each)
- **EventBridge Scheduler**: Free tier covers 14M invocations/month
- **SNS**: $0.50/month for 1000 notifications (far exceeds daily usage)
- **CloudWatch Logs**: ~$0.50/month (14 days retention)

**Total estimated cost: ~$1-2/month**

## Security Considerations

- Lambda function uses least-privilege IAM roles
- SNS topic has restricted publish permissions
- CloudWatch metrics are read-only
- All resources are tagged for tracking
- Lambda logs are retained for 14 days for audit

## Related Files

- `lambda/daily-metrics-notification/index.js` - Lambda function code
- `lambda/daily-metrics-notification/package.json` - Lambda dependencies
- `terraform/daily-metrics-notification/main.tf` - Infrastructure as code
- `pipelines/Jenkinsfile.synctest` - Sync metrics collection
- `mercata/services/oracle/src/utils/txMetricsService.ts` - Transaction metrics

## Support

For issues or questions, please refer to:
- GitHub Issues: https://github.com/blockapps/strato-platform/issues
- Internal Slack: #engineering or #ops-monitoring
