// Pipeline module (Phase 1 extraction)
// Responsibilities: intent routing, actionable staging, continuation state helpers, phase tagging

export const PHASE = {
  ATLAS_PLAN: 'atlas_plan',
  ATLAS_REFORMULATION: 'atlas_reformulation',
  GRISHA_SECURITY_CHECK: 'grisha_security_check',
  GRISHA_VISUAL_MONITORING: 'grisha_visual_monitoring',
  EXECUTION: 'execution',
  GRISHA_TASK_VERIFICATION: 'grisha_task_verification',
  GRISHA_FOLLOWUP: 'grisha_followup',
  TETYANA_PROBE: 'tetyana_probe',
  GRISHA_INFORMATION_REQUEST: 'grisha_information_request',
  ATLAS_FEASIBILITY: 'atlas_feasibility'
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

export function startActionablePipeline(session, userMessage, atlasPlan, grishaSecurityCheck) {
  session.pipeline = {
    type: 'actionable',
    stage: 'security_approved',
    userMessage,
    atlasPlan,
    grishaSecurityCheck,
    iter: 0
  };
  session.nextAction = 'grisha_visual_monitoring';
}

export function startPendingSecurityCheck(session, userMessage, atlasPlan) {
  session.pipeline = {
    type: 'actionable',
    stage: 'pending_security_check',
    userMessage,
    atlasPlan,
    grishaSecurityCheck: null,
    iter: 0
  };
  session.nextAction = 'grisha_security_check';
}

export function startProbePipeline(session, userMessage, atlasDraft, grishaShortage) {
  session.probe = {
    stage: 'pending_probe',
    userMessage,
    atlasDraft,
    shortage: grishaShortage,
    attempts: 0,
    maxAttempts: 2
  };
  session.nextAction = 'tetyana_probe';
}

export function clearProbe(session) {
  session.probe = null;
  if (session.nextAction === 'tetyana_probe' || session.nextAction === 'probe_review') session.nextAction = null;
}

export function startGrishaVisualMonitoring(session) {
  if (!session.pipeline) return;
  session.pipeline.stage = 'visual_monitoring';
  session.nextAction = 'tetyana_execute';
}

export function startGrishaTaskVerification(session, tetyanaResults) {
  if (!session.pipeline) return;
  session.pipeline.stage = 'task_verification';
  session.pipeline.tetyanaResults = tetyanaResults;
  session.nextAction = 'grisha_task_verification';
}

export function markNeedsGrishaInformation(session, informationNeeded, reason) {
  if (!session.pipeline) return;
  session.pipeline.stage = 'needs_grisha_info';
  session.pipeline.informationNeeded = informationNeeded;
  session.pipeline.reason = reason;
  session.nextAction = 'grisha_information_request';
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
