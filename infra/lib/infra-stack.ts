import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BackendStack } from "./backend-stack.ts";

export interface InfraStackProps extends cdk.StackProps {
  githubConnectionArn?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  githubBranch?: string;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps = {}) {
    super(scope, id, props);

    const backendStack = new BackendStack(this, "Backend", {
      env: props?.env,
    });

    // Cross-stack outputs
    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `http://${backendStack.instance.instancePublicIp}:3000`,
      description: "API Endpoint URL",
    });
  }
}
