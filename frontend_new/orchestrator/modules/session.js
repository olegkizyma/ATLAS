// session.js - Session state management and adaptive cycles
export const sessionCycleState = new Map(); // sessionId -> { cycleCount, usedTools, usedMSPs, lastState }

export function getExecutionMode(sessionId, currentCycle) {
  if (currentCycle === 3) {
    return {
      mode: "msp_specific",
      description: "Обмеження до конкретних MSP серверів"
    };
  } else if (currentCycle === 6) {
    return {
      mode: "tool_specific", 
      description: "Фокус на конкретних інструментах"
    };
  } else {
    return {
      mode: "normal",
      description: "Повний доступ до всіх ресурсів"
    };
  }
}

export function updateSessionState(sessionId, cycle, usedTools = [], usedMSPs = []) {
  if (!sessionCycleState.has(sessionId)) {
    sessionCycleState.set(sessionId, { 
      cycleCount: 0, 
      usedTools: new Set(), 
      usedMSPs: new Set(),
      lastState: null
    });
  }
  
  const state = sessionCycleState.get(sessionId);
  state.cycleCount = cycle;
  usedTools.forEach(tool => state.usedTools.add(tool));
  usedMSPs.forEach(msp => state.usedMSPs.add(msp));
  state.lastState = { cycle, timestamp: Date.now() };
  
  return state;
}

// Функція для аналізу виводу та відстеження використаних інструментів та MSP
export function analyzeExecutionOutput(output, sessionId) {
  const usedTools = [];
  const usedMSPs = [];
  
  // Аналізуємо використання інструментів (на основі типових патернів Goose)
  const toolPatterns = [
    /use_tool:\s*(\w+)/gi,
    /tool_call:\s*(\w+)/gi,
    /executing\s+(\w+)\s+tool/gi,
    /running\s+(\w+)\s+command/gi,
    /\*\*(\w+)\*\*:\s+/gi, // **tool_name**: pattern
    /`(\w+)`\s+tool/gi,
    /browser_(\w+)/gi,
    /file_(\w+)/gi,
    /terminal_(\w+)/gi,
    /system_(\w+)/gi
  ];
  
  toolPatterns.forEach(pattern => {
    const matches = Array.from(output.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 2) {
        usedTools.push(match[1].toLowerCase());
      }
    });
  });
  
  // Аналізуємо використання MSP серверів
  const mspPatterns = [
    /connecting\s+to\s+(\w+)/gi,
    /server:\s*(\w+)/gi,
    /msp[_\s]*(\w+)/gi,
    /endpoint:\s*(\w+)/gi,
    /service[_\s]*(\w+)/gi
  ];
  
  mspPatterns.forEach(pattern => {
    const matches = Array.from(output.matchAll(pattern));
    matches.forEach(match => {
      if (match[1] && match[1].length > 2) {
        usedMSPs.push(match[1].toLowerCase());
      }
    });
  });
  
  // Оновлюємо стан сесії
  if (usedTools.length > 0 || usedMSPs.length > 0) {
    const currentState = sessionCycleState.get(sessionId);
    if (currentState) {
      updateSessionState(sessionId, currentState.cycleCount, usedTools, usedMSPs);
    }
  }
  
  return { usedTools, usedMSPs };
}

export function getRecommendedResources(sessionId, currentCycle) {
  const state = sessionCycleState.get(sessionId);
  if (!state) {
    return { 
      mode: "normal", 
      msps: [], 
      tools: [], 
      reason: "Нова сесія - повний доступ до ресурсів" 
    };
  }

  if (currentCycle === 3) {
    // Цикл 3: Обмеження до конкретних MSP (топ-3 найбільш використовуваних)
    const topMSPs = Array.from(state.usedMSPs).slice(0, 3);
    return {
      mode: "msp_specific",
      msps: topMSPs,
      tools: [],
      reason: `Цикл 3: Обмеження до найчастіше використовуваних MSP: ${topMSPs.join(', ')}`
    };
  } else if (currentCycle === 6) {
    // Цикл 6: Обмеження до конкретних інструментів (останні 3 використані)
    const recentTools = Array.from(state.usedTools).slice(-3);
    return {
      mode: "tool_specific",
      msps: [],
      tools: recentTools,
      reason: `Цикл 6: Обмеження до останніх використовуваних інструментів: ${recentTools.join(', ')}`
    };
  } else {
    // Стандартні цикли: рекомендації на основі попереднього використання
    const suggestedMSPs = Array.from(state.usedMSPs).slice(0, 5);
    const suggestedTools = Array.from(state.usedTools).slice(-5);
    return {
      mode: "normal",
      msps: suggestedMSPs,
      tools: suggestedTools,
      reason: "Рекомендації на основі попереднього використання"
    };
  }
}