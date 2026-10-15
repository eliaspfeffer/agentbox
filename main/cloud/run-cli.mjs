#!/usr/bin/env node
// THE PROGRAM THE SUPERVISOR STARTS IN PLACE OF `claude` FOR A CLOUD RUN.
//
//   ELECTRON_RUN_AS_NODE=1 <electron> main/cloud/run-cli.mjs <claude's argv>
//
// Same argv, env and cwd as the local run would have had. Everything it does
// is main/cloud/run.mjs; this only connects it to the real AWS account named
// in ~/.agentbox/cloud.json and to this account's saved Claude sign-in.
import { cloudRun, IMPORT_FAILED } from './run.mjs';
import { awsTransport, awsStorage } from './aws.mjs';
import { readCloudConfig, readClaudeToken, codexCloudAuth } from './config.mjs';

const say = (m) => process.stderr.write(`agentbox cloud: ${m}\n`);

async function main() {
  // SIGNED AS THE CLOUD RUNS' OWN USER AND NOBODY ELSE. AWS's libraries read
  // keys from the environment before they read a named profile, so an app
  // started from a shell signed in as an admin would run every cloud call as
  // that admin. Those keys go, and the `agentbox-cloud` profile is what signs.
  for (const k of Object.keys(process.env)) {
    if (/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|PROFILE|DEFAULT_PROFILE|CREDENTIAL_EXPIRATION|WEB_IDENTITY_TOKEN_FILE|ROLE_ARN)$/.test(k)) delete process.env[k];
  }
  const config = readCloudConfig();
  if (!config) { say('cloud runs are not set up on this Mac (run scripts/cloud-setup.mjs)'); return 1; }
  // `--agentbox-import-only`: bring an earlier run in this folder home, and
  // start nothing (Supervisor#_bringCloudHome).
  // `--agentbox-codex app-server ...`: a Codex run, its own `codex app-server`
  // in the sandbox, on the Codex login CODEX_HOME names.
  const importOnly = process.argv[2] === '--agentbox-import-only';
  const codex = process.argv[2] === '--agentbox-codex';
  const token = importOnly || codex ? null : readClaudeToken(process.env.CLAUDE_CONFIG_DIR);
  if (!importOnly && !codex && !token) { say('this Claude account has no cloud sign-in yet (run scripts/cloud-signin.mjs)'); return 1; }
  const codexAuth = codex ? codexCloudAuth(process.env.CODEX_HOME || `${process.env.HOME}/.codex`)?.authJson : null;
  if (codex && !codexAuth) { say('this Codex login cannot go to the cloud right now (no ChatGPT sign-in in its folder, or one about to expire)'); return 1; }
  return cloudRun({
    importOnly,
    engine: codex ? 'codex' : 'claude',
    codexAuth,
    remoteCommand: codex ? 'codex' : 'claude',
    argv: importOnly ? [] : process.argv.slice(codex ? 3 : 2),
    env: process.env,
    cwd: process.cwd(),
    transport: awsTransport(config),
    storage: awsStorage(config),
    claudeToken: token,
  });
}

main().then(
  (code) => process.exit(code ?? 1),
  (err) => { say(`stopped: ${err?.message || err}`); process.exit(IMPORT_FAILED); },
);
