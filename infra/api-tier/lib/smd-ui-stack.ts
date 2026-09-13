import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";
import { ApiTierConfig } from "./config";

export interface SmdUiStackProps extends StackProps {
  config: ApiTierConfig;
  /** The us-east-1 certificate for `config.smdDomainName` (CertificateStack). */
  certificate?: acm.ICertificate;
}

/**
 * The paths the SMD calls on its own origin, as it did behind the node's
 * nginx: CloudFront sends them to the API tier, so the browser keeps one
 * origin and the session and CSRF cookies stay first-party.
 */
const API_PATHS = ["/strato/*", "/strato-api*", "/bloc/*", "/cirrus/*", "/apex-api*", "/apex-ws/*", "/rpc*", "/login*", "/auth/*", "/csrf-init", "/health", "/_ping"];

/**
 * Viewer-request function for the bucket: "/" and "/smd" go to "/smd/" (the
 * bundle is built for that base path), and client-side routes under /smd/
 * (no file extension) get the app's index.html. A function rather than the
 * distribution's error responses, which would also rewrite the API tier's
 * 401s and 404s into index.html.
 */
const ROUTES = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === "/" || uri === "/smd") {
    return { statusCode: 302, statusDescription: "Found", headers: { location: { value: "/smd/" } } };
  }
  if (uri.indexOf("/smd/") === 0 && uri.slice(uri.lastIndexOf("/") + 1).indexOf(".") === -1) {
    request.uri = "/smd/index.html";
  }
  return request;
}
`;

/**
 * The SMD: the built Vite bundle in a private bucket behind CloudFront at
 * /smd/, with the node API, apex, RPC and login paths routed to the API
 * tier. CloudFront forwards the viewer's Host header so the login flow
 * returns to the SMD's hostname; the API tier's ALB therefore carries a
 * certificate for it too (see bin/api-tier.ts).
 */
export class SmdUiStack extends Stack {
  constructor(scope: Construct, id: string, props: SmdUiStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (!config.domainName) throw new Error("SmdUiStack reaches the API tier by its hostname over https: set domainName");
    if (!config.smdDomainName || !props.certificate) throw new Error("SmdUiStack needs smdDomainName and its certificate");

    const bucket = new s3.Bucket(this, "SmdBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.HttpOrigin(config.domainName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        readTimeout: Duration.seconds(60),
      }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Host, cookies, auth headers and query strings reach nginx unchanged.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    const routes = new cloudfront.Function(this, "SmdRoutes", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: `strato smd ${config.envName}: base path and client-side routes`,
      code: cloudfront.FunctionCode.fromInline(ROUTES),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `strato smd ${config.envName}`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: routes, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: Object.fromEntries(API_PATHS.map((p) => [p, apiBehavior])),
      domainNames: [config.smdDomainName],
      certificate: props.certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // The bundle is built outside CDK (`npm run build` in smd-ui, base path
    // /smd/); config.js is rendered here from context, matching
    // smd-ui/docker-run.sh.
    const dist = path.resolve(__dirname, "../../../smd-ui/dist");
    if (config.deploySmdUi) {
      if (!fs.existsSync(path.join(dist, "index.html"))) {
        throw new Error(`deploySmdUi is set but ${dist} has no build; run "npm ci && npm run build" in smd-ui first`);
      }
      if (!config.chainId || !config.networkName) throw new Error("deploySmdUi needs -c chainId=... and -c networkName=... for the SMD's config.js");
      const configJs = [
        "window.ENV = {",
        `  CHAIN_ID: ${config.chainId},`,
        `  NETWORK_NAME: "${config.networkName}",`,
        `  RPC_URL: "/rpc",`,
        `  EXPLORER_URL: "",`,
        `  WAGMI_PROJECT_ID: "${config.wagmiProjectId ?? ""}"`,
        "};",
        "",
      ].join("\n");
      new s3deploy.BucketDeployment(this, "SmdDeployment", {
        destinationBucket: bucket,
        destinationKeyPrefix: "smd/",
        sources: [s3deploy.Source.asset(dist, { exclude: ["config.js"] }), s3deploy.Source.data("config.js", configJs)],
        distribution,
        distributionPaths: ["/smd/*"],
        prune: true,
      });
    }

    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId, description: "Name it in the tier map's frontend_labels variable (<id>=SMD)" });
    new CfnOutput(this, "HostnameRecord", {
      value: `${config.smdDomainName} CNAME ${distribution.distributionDomainName}`,
      description: "The record to create at the registrar for the SMD's hostname",
    });
    new CfnOutput(this, "SmdBucketName", { value: bucket.bucketName });
  }
}
