// workflow.js - Main workflow orchestration logic
import { mistralJsonOnly, summarizeTaskSpec, capTail, capHead } from '../utils.js';

// Check Tetyana's completion status from her execution output
export async function checkTetianaCompletionStatus(execText, sessionId, MISTRAL_API_KEY) {
  if (!MISTRAL_API_KEY) {
    return { isComplete: false, canContinue: true, reason: 'No AI available to assess completion' };
  }
  
  const sys = `Ти - аналітик завершеності задач. Проаналізуй вивід виконавця (Тетяна) і визнач:
1. isComplete: чи явно сказала Тетяна, що завдання ЗАВЕРШЕНО
2. canContinue: чи може Тетяна продовжити роботу, чи сказала що НЕ МОЖЕ
3. reason: коротке пояснення твого рішення

Відповідь тільки у форматі JSON: {"isComplete": boolean, "canContinue": boolean, "reason": "string"}`;

  const userMessage = `Проаналізуй вивід Тетяни на предмет завершеності:\n\n${execText.slice(-2000)}`;
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: 3, 
      temperature: 0.1, 
      sessionId 
    });
    
    return {
      isComplete: result.isComplete || false,
      canContinue: result.canContinue !== false, 
      reason: result.reason || 'Аналіз завершено'
    };
  } catch (e) {
    console.warn('Failed to assess completion status:', e.message);
    return { isComplete: false, canContinue: true, reason: 'Помилка аналізу завершеності' };
  }
}

// Grisha: створює цільові завдання для незалежної перевірки
export async function grishaCreateTargetedVerificationTasks(taskSpec, execText, msps = [], context = {}) {
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const ORCH_GRISHA_MAX_ATTEMPTS = parseInt(process.env.ORCH_GRISHA_MAX_ATTEMPTS || '20', 10);
  const ORCH_MAX_EXEC_REPORT_CHARS = parseInt(process.env.ORCH_MAX_EXEC_REPORT_CHARS || '12000', 10);
  
  if (!MISTRAL_API_KEY) throw new Error('Grisha targeted verification requires Mistral API key');
  
  const sys = `Ти - Гріша, експерт з безпеки та верифікації. 
Створи список цільових завдань для перевірки виконання через окремі сесії з виконавцем (Тетяна).
Кожне завдання має бути конкретним і спрямованим на отримання специфічної інформації.

Приклади цільових завдань:
- "Покажи мені скріншоти всіх екранів"
- "Виконай в командному рядку цю команду і скажи вивід"
- "Перевір стан конкретного сервісу"
- "Підтверди наявність конкретного файлу або значення"

Відповідь у JSON: {"tasks": [{"description": "опис завдання", "prompt": "точний промпт для Тетяни"}]}`;

  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  let userMessage = `TaskSpec: ${JSON.stringify(tsSummary)}\n\nВивід виконавця:\n${execTail}`;
  
  if (context.cycle && context.mode) {
    userMessage += `\n\nЦикл: ${context.cycle}, Режим: ${context.mode}`;
    if (context.recommended) {
      userMessage += `\nРекомендовані ресурси: ${JSON.stringify(context.recommended)}`;
    }
  }
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, 
      temperature: 0.2, 
      sessionId: context.sessionId 
    });
    
    return Array.isArray(result.tasks) ? result.tasks : [];
  } catch (e) {
    console.warn('Failed to create verification tasks:', e.message);
    return [];
  }
}

// Grisha: аналізує результати всіх верифікаційних завдань і дає вердикт
export async function grishaAnalyzeVerificationResults(taskSpec, execText, verificationResults, context = {}) {
  const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  const ORCH_GRISHA_MAX_ATTEMPTS = parseInt(process.env.ORCH_GRISHA_MAX_ATTEMPTS || '20', 10);
  const ORCH_MAX_EXEC_REPORT_CHARS = parseInt(process.env.ORCH_MAX_EXEC_REPORT_CHARS || '12000', 10);
  
  if (!MISTRAL_API_KEY) throw new Error('Grisha verdict requires Mistral API key');
  
  const sys = `Ти - Гріша, суддя завершеності завдань. 
Проаналізуй результати всіх верифікаційних завдань і дай фінальний вердикт.

Відповідь у JSON: {
  "isComplete": boolean,
  "issues": ["список проблем"],
  "reasoning": "пояснення рішення",
  "detailed_feedback": "детальний аналіз",
  "atlas_refinement_hint": "підказка для Atlas щодо доопрацювання"
}`;

  const tsSummary = summarizeTaskSpec(taskSpec);
  const execTail = capTail(execText || '', ORCH_MAX_EXEC_REPORT_CHARS);
  
  let verificationSummary = verificationResults.map((vr, i) => 
    `Завдання ${i + 1}: ${vr.task}\nРезультат: ${vr.result.slice(-500)}`
  ).join('\n\n');
  
  let userMessage = `TaskSpec: ${JSON.stringify(tsSummary)}\n\nОригінальний вивід:\n${execTail}\n\nРезультати верифікації:\n${verificationSummary}`;
  
  if (context.cycle && context.mode) {
    userMessage += `\n\nКонтекст: Цикл ${context.cycle}, Режим ${context.mode}`;
  }
  
  try {
    const result = await mistralJsonOnly(sys, userMessage, { 
      maxAttempts: ORCH_GRISHA_MAX_ATTEMPTS, 
      temperature: 0.1, 
      sessionId: context.sessionId 
    });
    
    return {
      isComplete: result.isComplete || false,
      issues: Array.isArray(result.issues) ? result.issues : [],
      reasoning: result.reasoning || 'Аналіз завершено',
      detailed_feedback: result.detailed_feedback || '',
      atlas_refinement_hint: result.atlas_refinement_hint || ''
    };
  } catch (e) {
    console.warn('Failed to analyze verification results:', e.message);
    return { 
      isComplete: false, 
      issues: ['Помилка аналізу верифікації: ' + (e.message || 'невідома помилка')],
      reasoning: 'Технічна помилка під час аналізу'
    };
  }
}