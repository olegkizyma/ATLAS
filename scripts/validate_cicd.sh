#!/usr/bin/env bash
set -euo pipefail

# ATLAS CI/CD Validation Script
# Tests the CI/CD setup without requiring external services

echo "🧠 ATLAS CI/CD Infrastructure Validation"
echo "========================================"

# Test 1: File structure validation
echo ""
echo "📁 Testing file structure..."

required_files=(
    "intelligent_atlas/requirements.txt"
    "intelligent_atlas/core/intelligent_engine.py"
    "intelligent_atlas/config/dynamic_config.py"
    "start_stack_macos.sh"
    "start_stack.sh"
    "stop_stack.sh"
    "status_stack.sh"
    "scripts/smoke_e2e.sh"
    ".github/workflows/ci.yml"
    ".github/workflows/macos-deployment.yml"
    ".github/dependabot.yml"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (missing)"
        exit 1
    fi
done

# Test 2: Script permissions
echo ""
echo "🔧 Testing script permissions..."

scripts=(
    "start_stack_macos.sh"
    "start_stack.sh"
    "stop_stack.sh"
    "status_stack.sh"
    "scripts/smoke_e2e.sh"
)

for script in "${scripts[@]}"; do
    if [ -x "$script" ]; then
        echo "✅ $script (executable)"
    else
        echo "❌ $script (not executable)"
        exit 1
    fi
done

# Test 3: CI/CD configuration validation
echo ""
echo "⚙️ Testing CI/CD configuration..."

# Check CI workflow has required jobs
if grep -q "intelligent-atlas-tests" .github/workflows/ci.yml; then
    echo "✅ CI workflow has intelligent-atlas-tests job"
else
    echo "❌ CI workflow missing intelligent-atlas-tests job"
    exit 1
fi

if grep -q "e2e-smoke" .github/workflows/ci.yml; then
    echo "✅ CI workflow has e2e-smoke job"
else
    echo "❌ CI workflow missing e2e-smoke job"
    exit 1
fi

# Check deployment workflow
if grep -q "validate-macos" .github/workflows/macos-deployment.yml; then
    echo "✅ Deployment workflow has validation"
else
    echo "❌ Deployment workflow missing validation"
    exit 1
fi

# Check Dependabot
if grep -q "intelligent_atlas" .github/dependabot.yml; then
    echo "✅ Dependabot configured for intelligent_atlas"
else
    echo "❌ Dependabot missing intelligent_atlas configuration"
    exit 1
fi

# Test 4: Service endpoint validation (without actually calling them)
echo ""
echo "🌐 Testing service endpoint configuration..."

expected_ports=("5001" "3010" "3000" "3001")
for port in "${expected_ports[@]}"; do
    if grep -q "$port" scripts/smoke_e2e.sh; then
        echo "✅ Port $port configured in smoke tests"
    else
        echo "❌ Port $port missing from smoke tests"
        exit 1
    fi
done

# Test 5: Documentation updates
echo ""
echo "📚 Testing documentation updates..."

if grep -q "CI/CD Pipeline" README.md; then
    echo "✅ README contains CI/CD documentation"
else
    echo "❌ README missing CI/CD documentation"
    exit 1
fi

if grep -q "Pure Intelligent System" scripts/README_SMOKE.md; then
    echo "✅ Smoke test documentation updated"
else
    echo "❌ Smoke test documentation not updated"
    exit 1
fi

# Test 6: Python syntax validation (basic)
echo ""
echo "🐍 Testing Python syntax..."

python_files=(
    "intelligent_atlas/config/dynamic_config.py"
    "intelligent_atlas/core/intelligent_engine.py"
    "intelligent_atlas/core/web_interface.py"
)

for file in "${python_files[@]}"; do
    if python3 -m py_compile "$file" 2>/dev/null; then
        echo "✅ $file (syntax valid)"
    else
        echo "❌ $file (syntax error)"
        exit 1
    fi
done

echo ""
echo "🎉 All CI/CD infrastructure validation tests passed!"
echo ""
echo "Summary:"
echo "  ✅ File structure complete"
echo "  ✅ Script permissions correct"
echo "  ✅ CI/CD configuration valid"
echo "  ✅ Service endpoints configured"
echo "  ✅ Documentation updated"
echo "  ✅ Python syntax valid"
echo ""
echo "Ready for deployment! 🚀"