# Eval Report: lens-hardening-before-after

## Summary

| Metric | Value |
|--------|-------|
| Suite | lens-hardening-before-after |
| Version | 0.0.0 |
| Total Tests | 14 |
| Passed | 4 |
| Failed | 10 |
| Duration | 17327ms |
| Parallel Requested | false |
| Parallel Used | false |
| Parallel Mode | serial |
| Parallel Workers | 1 |
| Pass Rate | 0% |

### Result: ❌ 10 FAILED

## Test Results

| # | Status | Test | Check | Message |
|---|--------|------|-------|---------|
| 1 | ✅ | Correctness: Kujo test suite passes | command_succeeds | Command succeeded (exit 0) |
| 2 | ✅ | Correctness: bridge test suite passes | command_succeeds | Command succeeded (exit 0) |
| 3 | ✅ | Usability: version command succeeds | output_contains | Output contains expected text |
| 4 | ✅ | Failure: missing auth fails before browser boundary | command_succeeds | Command succeeded (exit 0) |
| 5 | ❌ | Failure: missing auth path is not disclosed | command_succeeds | Command failed with exit code 1 |
| 6 | ❌ | Reliability: console evidence is bounded and counted | command_succeeds | Command failed with exit code 1 |
| 7 | ❌ | Reliability: network evidence is bounded and counted | command_succeeds | Command failed with exit code 1 |
| 8 | ❌ | Reliability: link evidence is bounded and counted | command_succeeds | Command failed with exit code 1 |
| 9 | ❌ | Reliability: custom viewport dimensions are bounded | command_succeeds | Command failed with exit code 1 |
| 10 | ❌ | Safety: output paths reject unsafe final targets | command_succeeds | Command failed with exit code 1 |
| 11 | ❌ | Failure: malformed provider output has a stable guard | command_succeeds | Command failed with exit code 1 |
| 12 | ❌ | Safety: accessibility evidence passes through redaction | command_succeeds | Command failed with exit code 1 |
| 13 | ❌ | Usability: evidence truncation produces a warning | command_succeeds | Command failed with exit code 1 |
| 14 | ❌ | Reliability: report outputs use explicit overwrite | command_succeeds | Command failed with exit code 1 |

## Failed Test Details

### Failure: missing auth path is not disclosed

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK missing-auth-redaction
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Reliability: console evidence is bounded and counted

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK console-bound
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Reliability: network evidence is bounded and counted

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK network-bound
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Reliability: link evidence is bounded and counted

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK links-bound
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Reliability: custom viewport dimensions are bounded

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK viewport-bound
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Safety: output paths reject unsafe final targets

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK write-path-validation
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Failure: malformed provider output has a stable guard

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK malformed-provider-guard
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Safety: accessibility evidence passes through redaction

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK accessibility-redaction
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Usability: evidence truncation produces a warning

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK limit-warning
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

### Reliability: report outputs use explicit overwrite

- **Check**: `command_succeeds`
- **Message**: Command failed with exit code 1
- **allowed_command_patterns**: []
- **allowed_commands**: []
- **blocked_arg_patterns**: []
- **command**: $LENS_CHECK forced-overwrite
- **command_pattern_match_mode**: substring
- **exit_code**: 1
- **stderr**: 
- **stdout**: 

---
*Report generated by Eval*
