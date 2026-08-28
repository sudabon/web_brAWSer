import { AWS_SERVICES } from "./awsServices";

const CONSOLE_HOST = /(^|\.)console\.aws\.amazon\.com$/i;

// AWS_SERVICES に無い、よく開くサービスの補完。第1パスセグメント → 表示名。
const EXTRA_SEGMENT_LABELS: Record<string, string> = {
  console: "ホーム",
  acm: "Certificate Manager",
  amplify: "Amplify",
  aos: "OpenSearch",
  apprunner: "App Runner",
  appstream2: "AppStream",
  appsync: "AppSync",
  athena: "Athena",
  backup: "Backup",
  batch: "Batch",
  bedrock: "Bedrock",
  cloud9: "Cloud9",
  cloudshell: "CloudShell",
  codeartifact: "CodeArtifact",
  cognito: "Cognito",
  connect: "Connect",
  controltower: "Control Tower",
  datasync: "DataSync",
  directconnect: "Direct Connect",
  dms: "DMS",
  docdb: "DocumentDB",
  ecr: "ECR",
  efs: "EFS",
  elasticache: "ElastiCache",
  elasticbeanstalk: "Elastic Beanstalk",
  emr: "EMR",
  es: "OpenSearch",
  events: "EventBridge",
  firehose: "Data Firehose",
  fsx: "FSx",
  glue: "Glue",
  globalaccelerator: "Global Accelerator",
  guardduty: "GuardDuty",
  iamv2: "IAM",
  inspector: "Inspector",
  inspectorv2: "Inspector",
  iot: "IoT Core",
  kinesis: "Kinesis",
  lightsail: "Lightsail",
  macie: "Macie",
  memorydb: "MemoryDB",
  mq: "Amazon MQ",
  msk: "MSK",
  neptune: "Neptune",
  networkfirewall: "Network Firewall",
  quicksight: "QuickSight",
  ram: "RAM",
  redshiftv2: "Redshift",
  redshift: "Redshift",
  "resource-groups": "Resource Groups",
  sagemaker: "SageMaker",
  scheduler: "EventBridge Scheduler",
  securityhub: "Security Hub",
  servicecatalog: "Service Catalog",
  servicequotas: "Service Quotas",
  ses: "SES",
  singlesignon: "IAM Identity Center",
  states: "Step Functions",
  storagegateway: "Storage Gateway",
  support: "Support",
  timestream: "Timestream",
  transfer: "Transfer Family",
  wafv2: "WAF",
  workspaces: "WorkSpaces",
  xray: "X-Ray",
};

// 第1セグメントが共通で、第2セグメントで分かれるもの。
const NESTED_SEGMENT_LABELS: Record<string, Record<string, string>> = {
  codesuite: {
    codeartifact: "CodeArtifact",
    codebuild: "CodeBuild",
    codecommit: "CodeCommit",
    codedeploy: "CodeDeploy",
    codepipeline: "CodePipeline",
  },
};

// 同一パス配下をハッシュで切り替えるもの。
const HASH_SEGMENT_LABELS: { segment: string; hash: RegExp; label: string }[] = [
  { segment: "cloudwatch", hash: /^#?logsV2/i, label: "CloudWatch Logs" },
];

const SEGMENT_LABELS = buildSegmentLabels();

/** AWS マネジメントコンソールの URL から、開いているサービスの表示名を返す。 */
export function consoleServiceLabel(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!CONSOLE_HOST.test(parsed.hostname)) {
    return undefined;
  }
  const [segment, nested] = parsed.pathname.split("/").filter(Boolean);
  if (!segment) {
    return undefined;
  }
  const byHash = HASH_SEGMENT_LABELS.find(
    (rule) => rule.segment === segment && rule.hash.test(parsed.hash),
  );
  if (byHash) {
    return byHash.label;
  }
  const byNested = nested ? NESTED_SEGMENT_LABELS[segment]?.[nested] : undefined;
  return byNested ?? SEGMENT_LABELS[segment];
}

function buildSegmentLabels(): Record<string, string> {
  const labels: Record<string, string> = { ...EXTRA_SEGMENT_LABELS };
  for (const service of AWS_SERVICES) {
    const segment = service.path.split("#")[0]?.split("/").filter(Boolean)[0];
    if (segment && !(segment in labels)) {
      labels[segment] = service.name;
    }
  }
  return labels;
}
