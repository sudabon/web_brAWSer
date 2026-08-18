export type AwsService = {
  id: string;
  name: string;
  path: string;
};

export const AWS_SERVICES: AwsService[] = [
  { id: "s3", name: "S3", path: "/s3/home" },
  { id: "ec2", name: "EC2", path: "/ec2/home" },
  { id: "iam", name: "IAM", path: "/iam/home" },
  { id: "lambda", name: "Lambda", path: "/lambda/home" },
  { id: "cloudwatch", name: "CloudWatch", path: "/cloudwatch/home" },
  { id: "cloudformation", name: "CloudFormation", path: "/cloudformation/home" },
  { id: "ecs", name: "ECS", path: "/ecs/home" },
  { id: "eks", name: "EKS", path: "/eks/home" },
  { id: "rds", name: "RDS", path: "/rds/home" },
  { id: "dynamodb", name: "DynamoDB", path: "/dynamodbv2/home" },
  { id: "vpc", name: "VPC", path: "/vpc/home" },
  { id: "route53", name: "Route 53", path: "/route53/home" },
  { id: "cloudfront", name: "CloudFront", path: "/cloudfront/v4/home" },
  { id: "apigateway", name: "API Gateway", path: "/apigateway/home" },
  { id: "sns", name: "SNS", path: "/sns/home" },
  { id: "sqs", name: "SQS", path: "/sqs/home" },
  { id: "secretsmanager", name: "Secrets Manager", path: "/secretsmanager/home" },
  { id: "kms", name: "KMS", path: "/kms/home" },
  { id: "cloudtrail", name: "CloudTrail", path: "/cloudtrail/home" },
  { id: "config", name: "Config", path: "/config/home" },
  { id: "organizations", name: "Organizations", path: "/organizations/v2" },
  { id: "billing", name: "Billing", path: "/billing/home" },
  { id: "costexplorer", name: "Cost Explorer", path: "/cost-management/home" },
  { id: "ssm", name: "Systems Manager", path: "/systems-manager/home" },
  { id: "logs", name: "CloudWatch Logs", path: "/cloudwatch/home#logsV2:logs-insights" },
];

export function consoleServiceUrl(region: string, path: string): string {
  const [pathname, hash] = path.split("#");
  const url = new URL(`https://${region}.console.aws.amazon.com${pathname ?? "/console/home"}`);
  url.searchParams.set("region", region);
  if (hash) {
    url.hash = hash;
  }
  return url.toString();
}
