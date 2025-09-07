/**
 * ATLAS Vision Module - Computer Vision Integration
 * Автоматичний парсинг фото з покращенням та візуальною передачею послідовності
 */

class AtlasVision {
    constructor() {
        this.apiBase = window.ATLAS_CFG?.frontendBase || window.location.origin;
        this.isAvailable = false;
        this.currentAnalysis = null;
        this.currentSequence = null;
        
        // Ініціалізація
        this.init();
    }
    
    async init() {
        try {
            // Перевіряємо доступність комп'ютерного зору
            const response = await fetch(`${this.apiBase}/api/vision/status`);
            const status = await response.json();
            this.isAvailable = status.vision_available;
            
            if (this.isAvailable) {
                console.log('[ATLAS Vision] Computer vision available');
                this.setupUI();
            } else {
                console.warn('[ATLAS Vision] Computer vision not available');
            }
        } catch (error) {
            console.error('[ATLAS Vision] Initialization failed:', error);
            this.isAvailable = false;
        }
    }
    
    setupUI() {
        // Створюємо інтерфейс для завантаження зображень
        this.createVisionInterface();
        
        // Додаємо обробники drag & drop
        this.setupDragAndDrop();
    }
    
    createVisionInterface() {
        // Перевіряємо чи вже існує інтерфейс
        if (document.getElementById('atlas-vision-panel')) {
            return;
        }
        
        const visionPanel = document.createElement('div');
        visionPanel.id = 'atlas-vision-panel';
        visionPanel.className = 'vision-panel';
        visionPanel.innerHTML = `
            <div class="vision-header">
                <h3>🎥 ATLAS Vision</h3>
                <button id="vision-toggle" class="vision-toggle">Згорнути</button>
            </div>
            <div class="vision-content">
                <div class="vision-upload-area" id="vision-upload">
                    <div class="upload-prompt">
                        <i class="upload-icon">📷</i>
                        <p>Перетягніть фото сюди або клікніть для вибору</p>
                        <p class="upload-hint">Підтримуються: JPG, PNG, WEBP</p>
                    </div>
                    <input type="file" id="vision-file-input" accept="image/*" style="display: none;">
                </div>
                
                <div class="vision-controls" style="display: none;">
                    <button id="vision-analyze" class="vision-btn primary">Аналізувати</button>
                    <button id="vision-enhance" class="vision-btn secondary">Покращити</button>
                    <button id="vision-sequence" class="vision-btn accent">Створити відео</button>
                </div>
                
                <div class="vision-preview" id="vision-preview" style="display: none;">
                    <div class="preview-original">
                        <h4>Оригінал</h4>
                        <img id="vision-original" class="preview-image" />
                    </div>
                    <div class="preview-enhanced" style="display: none;">
                        <h4>Покращене</h4>
                        <img id="vision-enhanced" class="preview-image" />
                    </div>
                </div>
                
                <div class="vision-analysis" id="vision-analysis" style="display: none;">
                    <h4>Аналіз</h4>
                    <div class="analysis-content"></div>
                </div>
                
                <div class="vision-sequence" id="vision-sequence-panel" style="display: none;">
                    <h4>Послідовність дій</h4>
                    <div class="sequence-steps"></div>
                    <video id="vision-video" controls style="display: none; width: 100%; max-height: 300px;"></video>
                </div>
            </div>
        `;
        
        // Додаємо CSS стилі
        this.addVisionStyles();
        
        // Вставляємо панель в DOM
        const container = document.querySelector('.chat-interface') || document.body;
        container.appendChild(visionPanel);
        
        // Налаштовуємо обробники подій
        this.setupEventListeners();
    }
    
    addVisionStyles() {
        if (document.getElementById('atlas-vision-styles')) {
            return;
        }
        
        const style = document.createElement('style');
        style.id = 'atlas-vision-styles';
        style.textContent = `
            .vision-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 400px;
                max-height: 80vh;
                background: rgba(0, 20, 0, 0.95);
                border: 1px solid #00ff00;
                border-radius: 8px;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                z-index: 1000;
                overflow-y: auto;
            }
            
            .vision-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                border-bottom: 1px solid #00ff00;
                background: rgba(0, 40, 0, 0.8);
            }
            
            .vision-header h3 {
                margin: 0;
                font-size: 16px;
            }
            
            .vision-toggle {
                background: transparent;
                border: 1px solid #00ff00;
                color: #00ff00;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 12px;
            }
            
            .vision-toggle:hover {
                background: rgba(0, 255, 0, 0.1);
            }
            
            .vision-content {
                padding: 15px;
            }
            
            .vision-upload-area {
                border: 2px dashed #00ff00;
                border-radius: 6px;
                padding: 30px 20px;
                text-align: center;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            
            .vision-upload-area:hover {
                background: rgba(0, 255, 0, 0.05);
                border-color: #00ff88;
            }
            
            .vision-upload-area.drag-over {
                background: rgba(0, 255, 0, 0.1);
                border-color: #00ff88;
                transform: scale(1.02);
            }
            
            .upload-icon {
                font-size: 24px;
                display: block;
                margin-bottom: 10px;
            }
            
            .upload-hint {
                font-size: 12px;
                opacity: 0.7;
                margin-top: 5px;
            }
            
            .vision-controls {
                display: flex;
                gap: 10px;
                margin: 15px 0;
                flex-wrap: wrap;
            }
            
            .vision-btn {
                background: transparent;
                border: 1px solid #00ff00;
                color: #00ff00;
                padding: 8px 16px;
                cursor: pointer;
                border-radius: 4px;
                font-size: 12px;
                transition: all 0.3s ease;
            }
            
            .vision-btn:hover {
                background: rgba(0, 255, 0, 0.1);
                transform: translateY(-1px);
            }
            
            .vision-btn.primary {
                border-color: #00ff88;
                color: #00ff88;
            }
            
            .vision-btn.secondary {
                border-color: #88ff00;
                color: #88ff00;
            }
            
            .vision-btn.accent {
                border-color: #ff8800;
                color: #ff8800;
            }
            
            .vision-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .preview-image {
                width: 100%;
                max-height: 200px;
                object-fit: contain;
                border: 1px solid #00ff00;
                border-radius: 4px;
            }
            
            .vision-preview {
                margin: 15px 0;
            }
            
            .preview-original, .preview-enhanced {
                margin-bottom: 15px;
            }
            
            .preview-original h4, .preview-enhanced h4 {
                margin: 0 0 8px 0;
                font-size: 14px;
            }
            
            .vision-analysis {
                margin: 15px 0;
                padding: 10px;
                background: rgba(0, 60, 0, 0.3);
                border-radius: 4px;
            }
            
            .analysis-content {
                font-size: 12px;
                line-height: 1.4;
            }
            
            .vision-sequence {
                margin: 15px 0;
            }
            
            .sequence-steps {
                margin-bottom: 15px;
            }
            
            .sequence-step {
                display: flex;
                align-items: center;
                padding: 8px;
                margin: 5px 0;
                background: rgba(0, 40, 0, 0.5);
                border-radius: 4px;
                font-size: 12px;
            }
            
            .sequence-step.active {
                background: rgba(0, 255, 0, 0.2);
                border: 1px solid #00ff00;
            }
            
            .step-icon {
                margin-right: 10px;
                font-size: 16px;
            }
            
            .step-description {
                flex: 1;
            }
            
            .step-duration {
                font-size: 10px;
                opacity: 0.7;
            }
            
            @media (max-width: 768px) {
                .vision-panel {
                    position: relative;
                    width: 100%;
                    max-height: none;
                    top: 0;
                    right: 0;
                    margin: 20px 0;
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    setupEventListeners() {
        // Toggle панелі
        document.getElementById('vision-toggle').addEventListener('click', () => {
            const content = document.querySelector('.vision-content');
            const toggle = document.getElementById('vision-toggle');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggle.textContent = 'Згорнути';
            } else {
                content.style.display = 'none';
                toggle.textContent = 'Розгорнути';
            }
        });
        
        // Завантаження файлу
        const uploadArea = document.getElementById('vision-upload');
        const fileInput = document.getElementById('vision-file-input');
        
        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));
        
        // Кнопки управління
        document.getElementById('vision-analyze').addEventListener('click', () => this.analyzeImage());
        document.getElementById('vision-enhance').addEventListener('click', () => this.enhanceImage());
        document.getElementById('vision-sequence').addEventListener('click', () => this.createVideoSequence());
    }
    
    setupDragAndDrop() {
        const uploadArea = document.getElementById('vision-upload');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.remove('drag-over');
            });
        });
        
        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        });
    }
    
    async handleFileSelect(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.showError('Будь ласка, виберіть файл зображення');
            return;
        }
        
        try {
            // Показуємо завантажене зображення
            const reader = new FileReader();
            reader.onload = (e) => {
                const originalImg = document.getElementById('vision-original');
                originalImg.src = e.target.result;
                
                // Зберігаємо дані зображення
                this.currentImageData = e.target.result;
                
                // Показуємо прев'ю та контроли
                document.getElementById('vision-preview').style.display = 'block';
                document.querySelector('.vision-controls').style.display = 'flex';
                
                console.log('[ATLAS Vision] Image loaded successfully');
            };
            
            reader.readAsDataURL(file);
            
        } catch (error) {
            console.error('[ATLAS Vision] File handling error:', error);
            this.showError('Помилка завантаження файлу');
        }
    }
    
    async analyzeImage() {
        if (!this.currentImageData) {
            this.showError('Спочатку завантажте зображення');
            return;
        }
        
        try {
            this.setLoading('vision-analyze', true);
            
            const response = await fetch(`${this.apiBase}/api/vision/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: this.currentImageData,
                    generate_video: false
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.currentAnalysis = result.analysis;
                this.currentSequence = result.sequence;
                this.displayAnalysis(result);
                this.displaySequence(result.sequence);
                
                console.log('[ATLAS Vision] Analysis completed:', result);
            } else {
                this.showError(result.error || 'Помилка аналізу зображення');
            }
            
        } catch (error) {
            console.error('[ATLAS Vision] Analysis error:', error);
            this.showError('Помилка зв\'язку з сервером');
        } finally {
            this.setLoading('vision-analyze', false);
        }
    }
    
    async enhanceImage() {
        if (!this.currentImageData) {
            this.showError('Спочатку завантажте зображення');
            return;
        }
        
        try {
            this.setLoading('vision-enhance', true);
            
            const response = await fetch(`${this.apiBase}/api/vision/enhance`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: this.currentImageData
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                const enhancedImg = document.getElementById('vision-enhanced');
                enhancedImg.src = result.enhanced_image;
                
                document.querySelector('.preview-enhanced').style.display = 'block';
                console.log('[ATLAS Vision] Image enhancement completed');
            } else {
                this.showError(result.error || 'Помилка покращення зображення');
            }
            
        } catch (error) {
            console.error('[ATLAS Vision] Enhancement error:', error);
            this.showError('Помилка покращення зображення');
        } finally {
            this.setLoading('vision-enhance', false);
        }
    }
    
    async createVideoSequence() {
        if (!this.currentImageData) {
            this.showError('Спочатку завантажте зображення');
            return;
        }
        
        try {
            this.setLoading('vision-sequence', true);
            
            const response = await fetch(`${this.apiBase}/api/vision/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: this.currentImageData,
                    generate_video: true
                })
            });
            
            const result = await response.json();
            
            if (result.success && result.video_available) {
                // Показуємо відео
                const video = document.getElementById('vision-video');
                video.src = result.video_path;
                video.style.display = 'block';
                
                this.animateSequenceSteps(result.sequence);
                
                console.log('[ATLAS Vision] Video sequence created:', result.video_path);
            } else {
                this.showError(result.video_error || 'Помилка створення відео');
            }
            
        } catch (error) {
            console.error('[ATLAS Vision] Video creation error:', error);
            this.showError('Помилка створення відео послідовності');
        } finally {
            this.setLoading('vision-sequence', false);
        }
    }
    
    displayAnalysis(result) {
        const analysisPanel = document.getElementById('vision-analysis');
        const content = analysisPanel.querySelector('.analysis-content');
        
        const analysis = result.analysis;
        let html = `<p><strong>Опис сцени:</strong> ${result.scene_description}</p>`;
        
        if (analysis.objects && analysis.objects.length > 0) {
            html += `<p><strong>Об'єкти (${analysis.objects.length}):</strong></p><ul>`;
            analysis.objects.forEach(obj => {
                html += `<li>${obj.class} (${Math.round(obj.confidence * 100)}%)</li>`;
            });
            html += '</ul>';
        }
        
        if (analysis.faces && analysis.faces.length > 0) {
            html += `<p><strong>Обличчя:</strong> ${analysis.faces.length}</p>`;
        }
        
        if (analysis.hands && analysis.hands.length > 0) {
            html += `<p><strong>Руки:</strong> ${analysis.hands.length}</p>`;
        }
        
        if (analysis.people && analysis.people.length > 0) {
            html += `<p><strong>Люди:</strong> ${analysis.people.length}</p>`;
        }
        
        content.innerHTML = html;
        analysisPanel.style.display = 'block';
    }
    
    displaySequence(sequence) {
        const sequencePanel = document.getElementById('vision-sequence-panel');
        const stepsContainer = sequencePanel.querySelector('.sequence-steps');
        
        let html = '';
        sequence.forEach((step, index) => {
            const icon = this.getStepIcon(step.type);
            html += `
                <div class="sequence-step" data-step="${index}">
                    <span class="step-icon">${icon}</span>
                    <span class="step-description">${step.description}</span>
                    <span class="step-duration">${step.duration}s</span>
                </div>
            `;
        });
        
        stepsContainer.innerHTML = html;
        sequencePanel.style.display = 'block';
    }
    
    animateSequenceSteps(sequence) {
        const steps = document.querySelectorAll('.sequence-step');
        let currentStep = 0;
        
        const animateStep = () => {
            // Деактивуємо попередній крок
            steps.forEach(step => step.classList.remove('active'));
            
            if (currentStep < steps.length) {
                // Активуємо поточний крок
                steps[currentStep].classList.add('active');
                
                // Плануємо наступний крок
                const duration = sequence[currentStep].duration * 1000;
                setTimeout(() => {
                    currentStep++;
                    animateStep();
                }, duration);
            }
        };
        
        animateStep();
    }
    
    getStepIcon(type) {
        const icons = {
            'detection': '🔍',
            'tracking': '👆',
            'analysis': '📊',
            'recognition': '🧠',
            'understanding': '💡',
            'default': '⚡'
        };
        
        return icons[type] || icons['default'];
    }
    
    setLoading(buttonId, loading) {
        const button = document.getElementById(buttonId);
        if (loading) {
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = 'Обробляється...';
        } else {
            button.disabled = false;
            button.textContent = button.dataset.originalText || button.textContent;
        }
    }
    
    showError(message) {
        console.error('[ATLAS Vision] Error:', message);
        
        // Можна додати toast notification або інший спосіб показу помилок
        alert(`ATLAS Vision: ${message}`);
    }
    
    // Публічні методи для інтеграції з основним додатком
    isVisionAvailable() {
        return this.isAvailable;
    }
    
    getCurrentAnalysis() {
        return this.currentAnalysis;
    }
    
    getCurrentSequence() {
        return this.currentSequence;
    }
}

// Експортуємо для використання в основному додатку
window.AtlasVision = AtlasVision;

// Автоматична ініціалізація якщо DOM готовий
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.atlasVision = new AtlasVision();
    });
} else {
    window.atlasVision = new AtlasVision();
}
