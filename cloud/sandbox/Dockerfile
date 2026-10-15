# THE CLOUD SANDBOX: one AgentCore microVM, one run (docs/cloud/PLAN.md).
#
# arm64, because AgentCore runs nothing else. Built in AWS CodeBuild by
# scripts/cloud-setup.mjs, so no Mac ever needs Docker for it.
#
# Claude Code is pinned to the version the Mac runs (the build passes it), so a
# transcript written in the cloud resumes on the Mac and the other way round.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
RUN test -n "$CLAUDE_CODE_VERSION" && test -n "$CODEX_VERSION"

# git for the bundle, tar for the transcripts, what `npm ci` needs to build
# native modules in a project's own dependencies, and bubblewrap, which Codex's
# own command sandbox runs on.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tar gzip python3 make g++ openssh-client procps bubblewrap \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}" && npm cache clean --force

# The server runs as root: a run happens at the SAME absolute paths it has on
# the user's machine (/Users/<name>/..., /home/<name>/..., and the Mac's own
# temp folder for the per-run settings), which only root can create. The agent
# itself runs as `agent`, owning only its task folder and its account folder
# (cloud/sandbox/server.mjs, `runAs`).
RUN useradd --create-home --home-dir /opt/agent --shell /bin/bash agent \
 && mkdir -p /var/lib/agentbox

COPY server.mjs mcp-stub.mjs usage.mjs /opt/agentbox/

ENV AGENTBOX_RUN_AS=agent
EXPOSE 8080
CMD ["node", "/opt/agentbox/server.mjs"]
