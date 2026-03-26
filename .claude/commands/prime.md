Spawn a subagent using the default-prime interpreter-executor framework.

Read the agent definition from `.claude/agents/default-prime.md` and use its full content as the behavioral preamble for the subagent.

The subagent MUST:
1. Follow the BRIEF -> EXECUTE two-stage protocol defined in default-prime.md exactly
2. Have full access to the codebase (read, write, edit, bash, grep, glob)
3. Return its complete output back to you — do NOT summarize or truncate
4. Use model override `opus` for extended thinking capability

Task for the subagent:

$ARGUMENTS
