# External Blockers

blockers:
  - id: kujo-cli-module-distribution
    command: "kujo run <entry>.kujo"
    evidence: "Lens retains its local CLI parser because external repositories cannot resolve kujo/modules/cli.kujo through the current module search paths; copying the module would create a second source of truth."
    status: needs-contract-first
    next_action: "Publish/install the first-party CLI module or add a supported module search path/package dependency, then migrate parser call sites and add parser parity tests."
