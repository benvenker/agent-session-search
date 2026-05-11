# Ambition Bar Check

Substantive applied changes: 7

Dimensions touched:

- agent_intuitiveness
- agent_ergonomics
- output_parseability
- error_pedagogy
- intent_inference
- self_documentation
- composability
- regression_resistance

Required surface types:

- Mega-command: yes, `agent-session-search --robot-triage`
- Capabilities or robot-docs: yes, both `capabilities --json` and `robot-docs guide`
- JSON/robot output on read-side: yes, capabilities/triage JSON and existing search JSON
- Error rewrite: yes, JSON parse failure envelope and unknown-source recovery hints
- Intent-inference handler: yes, `--json --help` and planned-probe/context CLI flags
- Pass 2 source/config inspection: yes, `agent-session-search sources --json`
- Pass 2 version alignment: yes, MCP server info now follows `package.json`
- Pass 2 structured-output decision: yes, FastMCP 4.0.1 text-content behavior is pinned and `outputSchema` is intentionally not advertised

Self-prompt:

> That's it?? I was hoping you would get a lot more practical value out of this skill.
> Where are the dramatic improvements? Re-read the playbook, look at the surfaces still
> scoring below 500 on output_parseability / error_pedagogy / intent_inference /
> self_documentation, and ship a substantially larger batch of high-leverage changes.
> You're allowed to be ambitious. Default to acting, not deliberating.

Result: the pass already cleared the small-tool ambition target. The self-check added the unknown-source recovery and doctor help fixes after the initial discovery/context batch.
