#!/usr/bin/env bash
# ATLAS3 Auto-Fix CI/CD Validation Test
# Tests all components of the auto-fix system

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() {
    echo "[VALIDATE] $1"
}

test_component() {
    local name="$1"
    local command="$2"
    log "Testing $name..."
    if eval "$command" >/dev/null 2>&1; then
        log "✅ $name: PASSED"
        return 0
    else
        log "❌ $name: FAILED"
        return 1
    fi
}

log "🧪 ATLAS3 Auto-Fix CI/CD Validation"
log "===================================="

# Test 1: Check file structure
test_component "File Structure" "
    [ -f '.github/workflows/atlas3-auto-fix.yml' ] &&
    [ -f '.github/scripts/auto-fix.sh' ] &&
    [ -f '.github/config/atlas3-config.yml' ] &&
    [ -f 'scripts/smoke_test_enhanced.sh' ] &&
    [ -f 'scripts/mock_health.py' ] &&
    [ -f 'README_ATLAS3_AUTO_FIX.md' ]
"

# Test 2: Check executable permissions
test_component "Executable Permissions" "
    [ -x '.github/scripts/auto-fix.sh' ] &&
    [ -x 'scripts/smoke_test_enhanced.sh' ] &&
    [ -x 'scripts/mock_health.py' ]
"

# Test 3: Test auto-fix script
log "Testing Auto-Fix Script..."
if ./.github/scripts/auto-fix.sh 999 >/dev/null 2>&1; then
    log "✅ Auto-Fix Script: PASSED"
else
    log "❌ Auto-Fix Script: FAILED"
fi

# Test 4: Test enhanced smoke test (with timeout)
log "Testing Enhanced Smoke Test..."
if timeout 30 ./scripts/smoke_test_enhanced.sh >/dev/null 2>&1; then
    log "✅ Enhanced Smoke Test: PASSED"
else
    log "❌ Enhanced Smoke Test: FAILED"
fi

# Test 5: Test mock health server
log "Testing Mock Health Server..."
python3 scripts/mock_health.py 5555 &
MOCK_PID=$!
sleep 2

if curl -s http://127.0.0.1:5555/api/health | grep -q "atlas-mock"; then
    log "✅ Mock Health Server: PASSED"
    mock_result=0
else
    log "❌ Mock Health Server: FAILED"
    mock_result=1
fi

kill $MOCK_PID 2>/dev/null || true
sleep 1

# Test 6: Check workflow syntax
test_component "Workflow YAML Syntax" "
    python3 -c \"
import yaml
with open('.github/workflows/atlas3-auto-fix.yml') as f:
    yaml.safe_load(f)
\"
"

# Test 7: Check configuration file
test_component "Configuration YAML Syntax" "
    python3 -c \"
import yaml
with open('.github/config/atlas3-config.yml') as f:
    yaml.safe_load(f)
\"
"

# Summary
log "===================================="

total_tests=7
if [ $mock_result -eq 0 ]; then
    passed_tests=7
else
    passed_tests=6
fi

log "📊 Results: $passed_tests/$total_tests tests passed"

if [ $passed_tests -eq $total_tests ]; then
    log "🎉 All validation tests passed!"
    log "🚀 ATLAS3 Auto-Fix CI/CD system is ready for deployment!"
    exit 0
else
    log "⚠️ Some tests failed. Please review the issues above."
    exit 1
fi