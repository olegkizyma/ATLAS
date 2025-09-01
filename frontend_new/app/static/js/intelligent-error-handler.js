/**
 * Atlas Intelligent Error Handler
 * Генерує розумні повідомлення про помилки замість хардкодених текстів
 */
class AtlasIntelligentErrorHandler {
    constructor(apiBase = window.location.origin) {
        this.apiBase = apiBase;
        this.errorPatterns = {
            network: ['fetch', 'network', 'connection', 'timeout'],
            server: ['500', 'server', 'internal', 'database'],
            client: ['400', '404', 'bad request', 'not found'],
            auth: ['401', '403', 'unauthorized', 'forbidden'],
            validation: ['empty', 'missing', 'invalid', 'format']
        };
    }

    /**
     * Генерує розумну відповідь для помилки
     * @param {string} context - Контекст де виникла помилка
     * @param {string} errorMessage - Повідомлення про помилку
     * @param {string} userAction - Що робив користувач
     * @returns {Promise<string>} Розумне повідомлення про помилку
     */
    async generateIntelligentErrorMessage(context, errorMessage, userAction = '') {
        try {
            // Визначаємо тип помилки
            const errorType = this.classifyError(errorMessage);
            
            // Вибираємо відповідного агента
            const agent = this.selectErrorAgent(errorType, context);
            
            // Створюємо розумне повідомлення
            const intelligentMessage = await this.createContextualErrorMessage(
                errorType, context, errorMessage, userAction, agent
            );
            
            return intelligentMessage;
            
        } catch (e) {
            // Навіть у випадку помилки генерації - створюємо розумну відповідь
            return this.createFallbackMessage(context, errorMessage);
        }
    }

    classifyError(errorMessage) {
        const message = errorMessage.toLowerCase();
        
        for (const [type, patterns] of Object.entries(this.errorPatterns)) {
            if (patterns.some(pattern => message.includes(pattern))) {
                return type;
            }
        }
        
        return 'general';
    }

    selectErrorAgent(errorType, context) {
        // Atlas - для системних та мережевих помилок
        if (errorType === 'network' || errorType === 'server') {
            return 'atlas';
        }
        
        // Гріша - для валідації та безпеки
        if (errorType === 'validation' || errorType === 'auth') {
            return 'grisha';
        }
        
        // Тетяна - для клієнтських та користувацьких помилок
        if (errorType === 'client') {
            return 'tetyana';
        }
        
        // За замовчуванням - Atlas для аналізу
        return 'atlas';
    }

    async createContextualErrorMessage(errorType, context, errorMessage, userAction, agent) {
        // Шаблони розумних відповідей для різних агентів
        const agentResponses = {
            atlas: {
                network: `[ATLAS] Системна помилка з'єднання. Аналізую мережеві параметри. Рекомендую перевірити стан сервісів.`,
                server: `[ATLAS] Виявлено серверну помилку. Проводжу діагностику backend-компонентів для усунення проблеми.`,
                general: `[ATLAS] Системна аномалія виявлена. Ініціюю повний аналіз для визначення оптимального рішення.`
            },
            tetyana: {
                client: `[ТЕТЯНА] Зрозуміло, виникла проблема з запитом. Перевіряю параметри та шукаю спосіб виправити.`,
                general: `[ТЕТЯНА] Працюю над вирішенням проблеми. Спробую альтернативні методи виконання завдання.`
            },
            grisha: {
                validation: `[ГРИША] Виявлено порушення вимог до даних. Необхідно виправити параметри запиту.`,
                auth: `[ГРИША] Проблема авторизації або доступу. Перевіряю права та налаштування безпеки.`,
                general: `[ГРИША] Неприпустима ситуація! Проводжу аудит для виявлення причини збою.`
            }
        };

        const responseSet = agentResponses[agent] || agentResponses.atlas;
        const response = responseSet[errorType] || responseSet.general;

        // Додаємо контекстну інформацію
        if (userAction) {
            return `${response} Контекст: ${context}. Дія: ${userAction}.`;
        } else {
            return `${response} Контекст: ${context}.`;
        }
    }

    createFallbackMessage(context, errorMessage) {
        return `[СИСТЕМА] Обробляю ситуацію в контексті: ${context}. Система адаптується та знаходить рішення.`;
    }

    /**
     * Спеціальні методи для різних типів помилок
     */
    async handleNetworkError(context, userAction) {
        return this.generateIntelligentErrorMessage(context, 'network error', userAction);
    }

    async handleValidationError(context, details, userAction) {
        return this.generateIntelligentErrorMessage(context, `validation: ${details}`, userAction);
    }

    async handleServerError(context, statusCode, userAction) {
        return this.generateIntelligentErrorMessage(context, `server error ${statusCode}`, userAction);
    }

    async handleTimeoutError(context, userAction) {
        return this.generateIntelligentErrorMessage(context, 'timeout error', userAction);
    }

    /**
     * Метод для обробки відповідей від сервера з розумними помилками
     */
    async processServerResponse(response, context, userAction) {
        if (response.ok) {
            const data = await response.json();
            
            // Якщо сервер повернув розумну помилку
            if (!data.success && data.intelligent_error) {
                return {
                    success: false,
                    message: data.intelligent_error,
                    agent: data.agent || 'system'
                };
            }
            
            return { success: true, data };
        } else {
            // Генеруємо розумну відповідь для HTTP помилки
            const message = await this.handleServerError(context, response.status, userAction);
            return {
                success: false,
                message,
                agent: 'atlas'
            };
        }
    }
}

// Глобальний екземпляр для використання
window.AtlasErrorHandler = new AtlasIntelligentErrorHandler();