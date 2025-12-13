#!/bin/bash
# ============================================================================
# REGRESSION CHECK SCRIPT
# ============================================================================
# Runs all tests and provides a detailed report
# Use after each feature implementation to ensure nothing broke
# ============================================================================

set -e

echo "=============================================="
echo "📊 REGRESSION CHECK - $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
UNIT_PASSED=0
UNIT_FAILED=0
INTEGRATION_PASSED=0
INTEGRATION_FAILED=0

# ============================================================================
# STEP 1: Check git status
# ============================================================================
echo "🔍 Git Status:"
echo "  Branch: $(git branch --show-current)"
echo "  Commit: $(git log -1 --format='%h %s')"
echo ""

# ============================================================================
# STEP 2: Run unit tests
# ============================================================================
echo "🧪 Running Unit Tests..."
echo "----------------------------------------------"

if npm run test:unit 2>/dev/null; then
  echo -e "${GREEN}✅ Unit tests passed${NC}"
  UNIT_PASSED=1
else
  echo -e "${RED}❌ Unit tests failed${NC}"
  UNIT_FAILED=1
fi
echo ""

# ============================================================================
# STEP 3: Run integration tests
# ============================================================================
echo "🔗 Running Integration Tests..."
echo "----------------------------------------------"

if npm run test:integration 2>/dev/null; then
  echo -e "${GREEN}✅ Integration tests passed${NC}"
  INTEGRATION_PASSED=1
else
  echo -e "${YELLOW}⚠️  Integration tests skipped or failed${NC}"
  INTEGRATION_FAILED=1
fi
echo ""

# ============================================================================
# STEP 4: Summary
# ============================================================================
echo "=============================================="
echo "📋 REGRESSION SUMMARY"
echo "=============================================="

if [ $UNIT_FAILED -eq 0 ] && [ $INTEGRATION_FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 ALL TESTS PASSING!${NC}"
  echo ""
  echo "Safe to commit. Suggested message format:"
  echo ""
  echo '  git commit -m "feat(scope): description'
  echo ''
  echo '  - SC-X.X: criterion ✓'
  echo '  - SC-X.X: criterion ✓'
  echo ''
  echo '  Tests: X passing"'
  exit 0
else
  echo -e "${RED}⚠️  REGRESSIONS DETECTED${NC}"
  echo ""
  echo "Do NOT commit until all tests pass."
  echo "Run individual test files to debug:"
  echo "  npm run test -- tests/unit/linking/session.test.ts"
  exit 1
fi

