/**
 * Security Manifest System for Grisha Security Agent
 * Manages user-provided security manifests and policies
 */

// Default General Security Manifest
export const DEFAULT_SECURITY_MANIFEST = {
    version: "1.0.0",
    created: new Date().toISOString(),
    name: "General Security Manifest",
    description: "Базовий маніфест безпеки для тестування системи ATLAS",
    policies: {
        dataAccess: {
            level: "restricted",
            description: "Обмежений доступ до персональних даних",
            rules: [
                "Заборонено доступ до паролів та автентифікаційних даних",
                "Обмежено читання системних файлів та конфігурацій",
                "Потрібне підтвердження для доступу до чутливих документів"
            ]
        },
        systemOperations: {
            level: "controlled",
            description: "Контрольовані системні операції",
            rules: [
                "Заборонено видалення критичних системних файлів",
                "Обмежено встановлення стороннього ПЗ",
                "Потрібне підтвердження для зміни системних налаштувань"
            ]
        },
        networkAccess: {
            level: "monitored",
            description: "Моніторинг мережевих підключень",
            rules: [
                "Обмежено підключення до невідомих серверів",
                "Заборонено передача чутливих даних без шифрування",
                "Моніторинг завантаження файлів з інтернету"
            ]
        },
        executionContext: {
            level: "sandbox",
            description: "Ізольоване середовище виконання",
            rules: [
                "Виконання тільки в безпечному контексті",
                "Заборонено прямий доступ до апаратних ресурсів",
                "Обмежені привілеї виконання"
            ]
        }
    },
    testingOverride: {
        enabled: true,
        authority: "Олег Миколайович",
        description: "Директива на тестування: Гріша має оцінити рівень небезпеки і повідомити про порушення, але дозволити виконання для цілей тестування",
        riskLevels: ["low", "medium", "high", "critical"],
        mandatoryWarning: "Я змушений по вказівці Олега Миколайович пропустити це завдання, хоч воно порушує безпеку"
    }
};

// User-provided manifests storage (in-memory for now)
let userManifests = new Map();

/**
 * Add or update a user-provided security manifest
 */
export function addUserManifest(userId, manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('Invalid manifest format');
    }
    
    // Validate basic structure
    if (!manifest.name || !manifest.policies) {
        throw new Error('Manifest must have name and policies');
    }
    
    userManifests.set(userId, {
        ...manifest,
        userId,
        addedAt: new Date().toISOString(),
        lastUsed: null
    });
    
    return true;
}

/**
 * Get security manifest for a user (user's manifest or default)
 */
export function getSecurityManifest(userId = null) {
    if (userId && userManifests.has(userId)) {
        const userManifest = userManifests.get(userId);
        userManifest.lastUsed = new Date().toISOString();
        return userManifest;
    }
    
    return DEFAULT_SECURITY_MANIFEST;
}

/**
 * List all user manifests (for admin purposes)
 */
export function listUserManifests() {
    return Array.from(userManifests.values());
}

/**
 * Remove a user manifest
 */
export function removeUserManifest(userId) {
    return userManifests.delete(userId);
}

/**
 * Validate task against security manifest
 * Returns risk assessment and policy violations
 */
export function assessTaskSecurity(task, manifest = null) {
    const securityManifest = manifest || DEFAULT_SECURITY_MANIFEST;
    const taskLower = task.toLowerCase();
    
    const assessment = {
        riskLevel: "low",
        violations: [],
        warnings: [],
        allowExecution: true,
        reasoning: "",
        manifest: securityManifest.name || "Default"
    };
    
    // Check against data access policies
    if (securityManifest.policies.dataAccess) {
        const sensitiveKeywords = ["пароль", "password", "токен", "token", "ключ", "key", "auth", "логін", "login"];
        if (sensitiveKeywords.some(keyword => taskLower.includes(keyword))) {
            assessment.violations.push("Потенційний доступ до автентифікаційних даних");
            assessment.riskLevel = "medium";
        }
    }
    
    // Check against system operations
    if (securityManifest.policies.systemOperations) {
        const dangerousOps = ["видали", "delete", "rm ", "format", "встанови", "install", "download"];
        if (dangerousOps.some(op => taskLower.includes(op))) {
            assessment.violations.push("Потенційно небезпечні системні операції");
            assessment.riskLevel = assessment.riskLevel === "low" ? "medium" : "high";
        }
    }
    
    // Check against network access
    if (securityManifest.policies.networkAccess) {
        const networkKeywords = ["завантаж", "download", "підключи", "connect", "надішли", "send"];
        if (networkKeywords.some(keyword => taskLower.includes(keyword))) {
            assessment.warnings.push("Мережева активність може потребувати моніторингу");
        }
    }
    
    // Determine if execution should be allowed based on testing override
    if (securityManifest.testingOverride && securityManifest.testingOverride.enabled) {
        assessment.allowExecution = true;
        assessment.testingOverride = true;
        assessment.overrideAuthority = securityManifest.testingOverride.authority;
        assessment.mandatoryWarning = securityManifest.testingOverride.mandatoryWarning;
    } else {
        assessment.allowExecution = assessment.riskLevel !== "critical";
    }
    
    // Generate reasoning
    assessment.reasoning = `Рівень ризику: ${assessment.riskLevel}. ` +
        (assessment.violations.length > 0 ? `Порушення: ${assessment.violations.join(', ')}. ` : '') +
        (assessment.warnings.length > 0 ? `Попередження: ${assessment.warnings.join(', ')}. ` : '') +
        (assessment.testingOverride ? `Тестовий режим дозволяє виконання за директивою ${assessment.overrideAuthority}.` : '');
    
    return assessment;
}

/**
 * Generate security check prompt for Grisha
 */
export function generateSecurityCheckPrompt(task, userId = null, context = {}) {
    const manifest = getSecurityManifest(userId);
    const assessment = assessTaskSecurity(task, manifest);
    
    return {
        systemPrompt: [
            `Ти — Гриша, агент безпеки системи ATLAS з можливістю візії та моніторингу.`,
            `Твоя ЄДИНА роль: перевіряти безпеку завдань згідно з маніфестом користувача.`,
            `ТИ НЕ ДАЄШ ПОРАДИ ПО ВИКОНАННЮ — тільки перевіряєш безпеку!`,
            ``,
            `ПОТОЧНИЙ МАНІФЕСТ БЕЗПЕКИ: "${manifest.name}"`,
            `Версія: ${manifest.version}`,
            ``,
            `ТВОЇ ФУНКЦІЇ:`,
            `1. Перевірка завдань на відповідність маніфесту безпеки`,
            `2. Візуальний моніторинг через камеру/екрани (коли потрібно)`,
            `3. Верифікація виконання завдань`,
            `4. Запит додаткової інформації через Тетяну (якщо потрібно)`,
            ``,
            `ДИРЕКТИВА ТЕСТУВАННЯ:`,
            assessment.testingOverride ? 
                `УВІМКНЕНО: ${assessment.mandatoryWarning} (якщо є порушення)` :
                `ВИМКНЕНО: Блокувати небезпечні завдання`,
            ``,
            `ФОРМАТ ВІДПОВІДІ:`,
            `БЕЗПЕКА: [ДОЗВОЛЕНО/ЗАБОРОНЕНО]`,
            `РІВЕНЬ_РИЗИКУ: [low/medium/high/critical]`,
            `ПОРУШЕННЯ: [список порушень або "немає"]`,
            `ДИРЕКТИВА: [повідомлення про тестову директиву, якщо є порушення]`,
            `ПОТРЕБУЮ_ІНФОРМАЦІЇ: [так/ні - чи потрібна додаткова інформація]`,
            `МОНІТОРИНГ: [так/ні - чи потрібен візуальний моніторинг]`
        ].join('\n'),
        
        taskPrompt: [
            `Завдання для перевірки: "${task}"`,
            ``,
            `Користувач: ${userId || 'anonymous'}`,
            `Контекст: ${JSON.stringify(context, null, 2)}`,
            ``,
            `Проведи перевірку безпеки згідно з маніфестом та дай висновок.`
        ].join('\n'),
        
        assessment
    };
}

export default {
    DEFAULT_SECURITY_MANIFEST,
    addUserManifest,
    getSecurityManifest,
    listUserManifests,
    removeUserManifest,
    assessTaskSecurity,
    generateSecurityCheckPrompt
};