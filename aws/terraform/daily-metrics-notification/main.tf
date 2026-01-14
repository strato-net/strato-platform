/**
 * Daily Network Metrics Notification Infrastructure
 *
 * Sets up:
 * - SNS topic for notifications
 * - Lambda function to aggregate CloudWatch metrics
 * - EventBridge Scheduler to trigger Lambda daily
 * - IAM roles and permissions
 *
 * The SNS topic should be connected to Amazon Q -> Slack (#ops-monitoring)
 * outside of this configuration.
 */

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
  default     = "production"
}

variable "notification_schedule" {
  description = "Cron expression for daily notifications (default: 9 AM UTC)"
  type        = string
  default     = "cron(0 9 * * ? *)"
}

# SNS Topic for notifications
resource "aws_sns_topic" "metrics_notifications" {
  name              = "strato-network-metrics-daily"
  display_name      = "STRATO Network Metrics Daily Report"

  tags = {
    Environment = var.environment
    Purpose     = "Daily network metrics notifications"
  }
}

# SNS Topic Policy to allow EventBridge and Lambda to publish
resource "aws_sns_topic_policy" "metrics_notifications_policy" {
  arn = aws_sns_topic.metrics_notifications.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.metrics_notifications.arn
      }
    ]
  })
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_metrics_role" {
  name = "strato-metrics-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
  }
}

# IAM Policy for Lambda - CloudWatch Logs
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_metrics_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# IAM Policy for Lambda - CloudWatch Metrics Read
resource "aws_iam_role_policy" "lambda_cloudwatch_metrics" {
  name = "cloudwatch-metrics-read"
  role = aws_iam_role.lambda_metrics_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics"
        ]
        Resource = "*"
      }
    ]
  })
}

# IAM Policy for Lambda - SNS Publish
resource "aws_iam_role_policy" "lambda_sns_publish" {
  name = "sns-publish"
  role = aws_iam_role.lambda_metrics_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.metrics_notifications.arn
      }
    ]
  })
}

# Lambda Function
resource "aws_lambda_function" "daily_metrics" {
  filename         = "lambda-deployment.zip"
  function_name    = "strato-daily-metrics-notification"
  role            = aws_iam_role.lambda_metrics_role.arn
  handler         = "index.handler"
  source_code_hash = filebase64sha256("lambda-deployment.zip")
  runtime         = "nodejs20.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      SNS_TOPIC_ARN = aws_sns_topic.metrics_notifications.arn
      AWS_REGION    = var.aws_region
    }
  }

  tags = {
    Environment = var.environment
    Purpose     = "Daily network metrics aggregation"
  }
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.daily_metrics.function_name}"
  retention_in_days = 14

  tags = {
    Environment = var.environment
  }
}

# IAM Role for EventBridge Scheduler
resource "aws_iam_role" "scheduler_role" {
  name = "strato-metrics-scheduler-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
  }
}

# IAM Policy for EventBridge Scheduler to invoke Lambda
resource "aws_iam_role_policy" "scheduler_lambda_invoke" {
  name = "lambda-invoke"
  role = aws_iam_role.scheduler_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = aws_lambda_function.daily_metrics.arn
      }
    ]
  })
}

# EventBridge Scheduler to trigger Lambda daily
resource "aws_scheduler_schedule" "daily_metrics_schedule" {
  name       = "strato-daily-metrics-notification"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = var.notification_schedule

  target {
    arn      = aws_lambda_function.daily_metrics.arn
    role_arn = aws_iam_role.scheduler_role.arn
  }

  description = "Trigger daily network metrics notification Lambda"
}

# Outputs
output "sns_topic_arn" {
  description = "ARN of the SNS topic for metrics notifications"
  value       = aws_sns_topic.metrics_notifications.arn
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.daily_metrics.function_name
}

output "scheduler_name" {
  description = "Name of the EventBridge Scheduler"
  value       = aws_scheduler_schedule.daily_metrics_schedule.name
}
