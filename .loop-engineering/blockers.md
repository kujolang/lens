# External Blockers

blockers:
  - id: kujo-cli-module-distribution
    command: "kujo run <entry>.kujo"
    evidence: "KUJO_MODULE_PATH now resolves kujo/modules/cli.kujo from external repositories. Lens still retains its application-specific parser and needs an explicit adapter contract before replacing it with the smaller first-party parse(spec) API."
    status: needs-contract-first
    next_action: "Define the parse(spec) adapter contract for Lens's command, validation, and help behavior, then migrate call sites and add parser parity tests."
