#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EbSchedulerAutoDeleteStack } from "../lib/eb-scheduler-auto-delete-stack";

const app = new cdk.App();
new EbSchedulerAutoDeleteStack(app, "SchedulerAutoDelete", {
  synthesizer: new cdk.DefaultStackSynthesizer({ qualifier: "ebdelete" })
});
