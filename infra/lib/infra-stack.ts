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

    const _backendStack = new BackendStack(this, "Backend", {
      env: props?.env,
    });
  }
}
