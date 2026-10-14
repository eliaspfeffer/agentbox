// THE TWO THINGS A CLOUD RUN NEEDS FROM AWS, AND NOTHING ELSE.
//
// main/cloud/run.mjs is written against two small interfaces so a test can
// run it against the real sandbox server on this machine (see
// tests/a-cloud-run-brings-the-agents-work-home.test.mjs). These are the real
// ones: the AgentCore session (invoke, stop) and the S3 bucket (put, get, and
// the presigned links the sandbox uses, so it holds no AWS rights of its own).
//
// They sign as the `agentbox-cloud` profile that scripts/cloud-setup.mjs made:
// an IAM user that may only start and stop sessions on one runtime and read
// and write one bucket's `runs/`. Never the 12-hour admin sign-in.
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from '@aws-sdk/client-bedrock-agentcore';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// A link the sandbox uses must outlive the longest run (8 hours) plus the
// upload at its end, with room to spare.
const LINK_SECONDS = 12 * 60 * 60;

// A request that hangs is retried by the caller; one that never returns would
// freeze the run. AgentCore holds a poll for at most 25 seconds.
const HTTP = { requestTimeout: 60_000, connectionTimeout: 10_000 };

export function awsTransport({ region, runtimeArn, profile }) {
  const client = new BedrockAgentCoreClient({ region, profile, requestHandler: HTTP });
  return {
    async invoke(sessionId, payload) {
      const out = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: sessionId,
        payload: Buffer.from(JSON.stringify(payload)),
        contentType: 'application/json',
        accept: 'application/json',
      }));
      const text = await out.response.transformToString();
      return JSON.parse(text);
    },
    async stop(sessionId) {
      await client.send(new StopRuntimeSessionCommand({ agentRuntimeArn: runtimeArn, runtimeSessionId: sessionId }));
    },
  };
}

export function awsStorage({ region, bucket, profile }) {
  // WHEN_REQUIRED: by default the SDK now signs a checksum of the body into
  // every upload link, which a link made before the body exists cannot match,
  // so every upload from the sandbox would be refused.
  const s3 = new S3Client({ region, profile, requestHandler: HTTP, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  return {
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    async get(key) {
      try {
        const o = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Buffer.from(await o.Body.transformToByteArray());
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    getUrl: (key) => getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: LINK_SECONDS }),
    putUrl: (key) => getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: LINK_SECONDS }),
  };
}
