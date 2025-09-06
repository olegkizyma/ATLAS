// Pipeline module (Phase 1 extraction)
// Responsibilities: intent routing, actionable staging, continuation state helpers, phase tagging

export const PHASE = {
  ATLAS_PLAN: 'atlas_plan',
  GRISHA_PRECHECK: 'grisha_precheck',
  EXECUTION: 'execution',
  GRISHA_VERDICT: 'grisha_verdict',
  GRISHA_FOLLOWUP: 'grisha_followup'
};

export function initSession(sessionId, sessions) {
  const session = sessions.get(sessionId) || {
    id: sessionId,
    history: [],
    currentAgent: 'atlas',
    lastInteraction: Date.now(),
    pipeline: null,
    nextAction: null,
    intent: null
  };
  sessions.set(sessionId, session);
  return session;
}

export function startActionablePipeline(session, userMessage, atlasPlan, grishaPre) {
  session.pipeline = {
    type: 'actionable',
    stage: 'prechecked',
    userMessage,
    atlasPlan,
    grishaPre,
    iter: 0
  };
  session.nextAction = 'tetyana_execute';
}

export function markNeedsMore(session, need, lastReport) {
  if (!session.pipeline) return;
  session.pipeline.stage = 'needs_more';
  session.pipeline.need = need;
  session.pipeline.lastReport = lastReport;
  session.nextAction = 'tetyana_supplement';
}

export function clearPipeline(session) {
  session.pipeline = null;
  session.nextAction = null;
}

export function tagResponse(base, phase) {
  return { ...base, phase };
}

export function executionMode() {
  return (process.env.EXECUTION_MODE || 'staged').toLowerCase();
}

export function shouldImmediateExecute(intent) {
  if (executionMode() === 'immediate' && intent === 'actionable') return true;
  return false;
}
