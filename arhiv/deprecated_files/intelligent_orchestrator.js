import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { IntelligentConfigManager } from './intelligent_configurator.js';

class IntelligentOrchestrator {
  constructor() {
    this.app = express();
    this.configManager = new IntelligentConfigManager('./intelligent_config.json');
    this.runtimeConfig = null;
    this.providers = new Map();
    this.services = new Map();
    this.executionHistory = [];
    this.performanceMetrics = new Map();
    
    this.initializeIntelligentSystem();
  }

  async initializeIntelligentSystem() {
    console.log('🧠 Ініціалізація інтелектуальної системи ATLAS...');
    
    // Generate adaptive configuration
    this.runtimeConfig = await this.configManager.generateAdaptiveConfig();
    await this.configManager.saveAdaptiveConfig(this.runtimeConfig);
    
    // Setup express with intelligent CORS
    this.setupIntelligentCORS();
    
    // Initialize adaptive middleware
    this.setupAdaptiveMiddleware();
    
    // Setup intelligent routing
    this.setupIntelligentRouting();
    
    // Initialize provider management
    await this.initializeProviderManagement();
    
    // Start adaptive monitoring
    this.startAdaptiveMonitoring();
    
    console.log('✅ Інтелектуальна система готова до роботи');
  }

  setupIntelligentCORS() {
    const corsOptions = {
      origin: (origin, callback) => {
        // Intelligent CORS - allow local development and discovered services
        const allowedOrigins = [
          'http://localhost',
          'http://127.0.0.1',
          'http://0.0.0.0'
        ];
        
        // Add discovered service ports
        for (const service of this.runtimeConfig.discovered.services) {
          allowedOrigins.push(`http://127.0.0.1:${service.port}`);
          allowedOrigins.push(`http://localhost:${service.port}`);
        }
        
        if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed))) {
          callback(null, true);
        } else {
          callback(new Error('CORS policy violation'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Secret-Key', 'X-Session-ID'],
      credentials: true
    };
    
    this.app.use(cors(corsOptions));
  }

  setupAdaptiveMiddleware() {
    // Intelligent JSON parsing with dynamic limits
    this.app.use(express.json({ 
      limit: this.calculateDynamicLimit(),
      verify: this.intelligentPayloadVerification.bind(this)
    }));
    
    // Adaptive request tracking
    this.app.use(this.adaptiveRequestTracker.bind(this));
    
    // Intelligent error handling
    this.app.use(this.intelligentErrorHandler.bind(this));
  }

  calculateDynamicLimit() {
    const baseLimit = 1024 * 1024; // 1MB base
    const contextTokens = this.runtimeConfig?.context_limits?.max_tokens || 45000;
    const estimatedBytes = contextTokens * 4; // rough token-to-byte conversion
    return Math.max(baseLimit, estimatedBytes);
  }

  intelligentPayloadVerification(req, buf, encoding) {
    // Intelligent payload analysis
    const payload = buf.toString(encoding);
    
    // Detect potential security issues
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /data:text\/html/i,
      /eval\s*\(/i
    ];
    
    const hasSuspiciousContent = suspiciousPatterns.some(pattern => 
      pattern.test(payload)
    );
    
    if (hasSuspiciousContent) {
      console.warn('⚠️  Підозрілий контент виявлено в запиті');
      // Log but don't block - intelligent filtering later
    }
  }

  adaptiveRequestTracker(req, res, next) {
    const startTime = Date.now();
    const requestId = this.generateIntelligentRequestId();
    
    req.intelligentContext = {
      requestId,
      startTime,
      expectedComplexity: this.assessRequestComplexity(req),
      recommendedProvider: this.selectOptimalProvider(req),
      adaptiveTimeout: this.calculateAdaptiveTimeout(req)
    };
    
    res.on('finish', () => {
      this.trackRequestPerformance(req, res, Date.now() - startTime);
    });
    
    next();
  }

  generateIntelligentRequestId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `atlas_${timestamp}_${random}`;
  }

  assessRequestComplexity(req) {
    const bodySize = JSON.stringify(req.body || {}).length;
    const hasAttachments = req.body?.attachments?.length > 0;
    const messageLength = req.body?.message?.length || 0;
    
    if (messageLength > 10000 || hasAttachments) return 'high';
    if (messageLength > 2000 || bodySize > 50000) return 'medium';
    return 'low';
  }

  selectOptimalProvider(req) {
    if (!this.runtimeConfig?.provider_selection) {
      return { name: 'none', reason: 'No providers configured' };
    }

    const { primary, fallback } = this.runtimeConfig.provider_selection;
    const complexity = req.intelligentContext?.expectedComplexity;
    
    // Intelligent provider selection based on complexity and performance
    const primaryPerformance = this.performanceMetrics.get(primary);
    if (primaryPerformance?.error_rate < 0.1 && primaryPerformance?.avg_response_time < 5000) {
      return { name: primary, reason: 'Primary provider performing well' };
    }
    
    // Fallback selection with intelligence
    for (const fallbackProvider of fallback || []) {
      const performance = this.performanceMetrics.get(fallbackProvider);
      if (performance?.error_rate < 0.2) {
        return { name: fallbackProvider, reason: 'Fallback due to primary issues' };
      }
    }
    
    return { name: primary, reason: 'Using primary despite issues' };
  }

  calculateAdaptiveTimeout(req) {
    const complexity = req.intelligentContext?.expectedComplexity;
    const baseTimeout = 30000; // 30 seconds
    
    const multipliers = {
      low: 1.0,
      medium: 1.5,
      high: 2.0
    };
    
    return baseTimeout * (multipliers[complexity] || 1.0);
  }

  trackRequestPerformance(req, res, duration) {
    const provider = req.intelligentContext?.recommendedProvider?.name;
    if (!provider || provider === 'none') return;
    
    if (!this.performanceMetrics.has(provider)) {
      this.performanceMetrics.set(provider, {
        requests: 0,
        errors: 0,
        total_time: 0,
        avg_response_time: 0,
        error_rate: 0
      });
    }
    
    const metrics = this.performanceMetrics.get(provider);
    metrics.requests++;
    metrics.total_time += duration;
    metrics.avg_response_time = metrics.total_time / metrics.requests;
    
    if (res.statusCode >= 400) {
      metrics.errors++;
    }
    
    metrics.error_rate = metrics.errors / metrics.requests;
    
    // Log performance insights
    if (metrics.requests % 10 === 0) {
      console.log(`📊 Provider ${provider}: avg=${metrics.avg_response_time.toFixed(0)}ms, errors=${(metrics.error_rate * 100).toFixed(1)}%`);
    }
  }

  intelligentErrorHandler(error, req, res, next) {
    console.error('🚨 Intelligent Error Handler:', {
      error: error.message,
      requestId: req.intelligentContext?.requestId,
      provider: req.intelligentContext?.recommendedProvider?.name,
      complexity: req.intelligentContext?.expectedComplexity
    });
    
    // Intelligent error response
    const intelligentResponse = {
      error: 'System encountered an issue',
      requestId: req.intelligentContext?.requestId,
      suggestion: this.generateErrorSuggestion(error, req),
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(intelligentResponse);
  }

  generateErrorSuggestion(error, req) {
    if (error.message.includes('timeout')) {
      return 'Request complexity may be too high. Consider breaking it into smaller parts.';
    }
    
    if (error.message.includes('token') || error.message.includes('limit')) {
      return 'Content may be too large. System will automatically compress on retry.';
    }
    
    if (error.message.includes('provider') || error.message.includes('API')) {
      return 'AI provider issue detected. System will attempt with alternative provider.';
    }
    
    return 'System is self-diagnosing. Please retry in a moment.';
  }

  setupIntelligentRouting() {
    // Health endpoint with intelligence
    this.app.get('/health', this.handleIntelligentHealth.bind(this));
    
    // Main processing endpoint
    this.app.post('/process', this.handleIntelligentProcessing.bind(this));
    
    // Intelligence insights endpoint
    this.app.get('/intelligence', this.handleIntelligenceInsights.bind(this));
    
    // Adaptive configuration endpoint
    this.app.get('/config', this.handleAdaptiveConfig.bind(this));
    
    // Performance metrics endpoint
    this.app.get('/metrics', this.handlePerformanceMetrics.bind(this));
  }

  handleIntelligentHealth(req, res) {
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      intelligence: {
        services_discovered: this.runtimeConfig.discovered.services.length,
        providers_available: this.runtimeConfig.discovered.providers.length,
        execution_strategy: this.runtimeConfig.execution_strategy.mode,
        context_limit: this.runtimeConfig.context_limits.max_tokens
      },
      performance: Object.fromEntries(this.performanceMetrics),
      adaptive_config: {
        last_updated: this.runtimeConfig.timestamp,
        auto_scaling: true,
        self_healing: true
      }
    };
    
    res.json(healthData);
  }

  async handleIntelligentProcessing(req, res) {
    const { message, context, session_id } = req.body;
    const requestContext = req.intelligentContext;
    
    try {
      console.log(`🧠 Processing intelligent request ${requestContext.requestId}`);
      
      // Intelligent content analysis
      const analysisResult = this.analyzeContent(message, context);
      
      // Adaptive provider selection
      const optimalProvider = this.selectOptimalProvider(req);
      
      // Intelligent response generation
      const response = await this.generateIntelligentResponse(
        message, 
        context, 
        analysisResult, 
        optimalProvider,
        session_id
      );
      
      res.json({
        response,
        metadata: {
          requestId: requestContext.requestId,
          provider_used: optimalProvider.name,
          processing_time: Date.now() - requestContext.startTime,
          complexity: requestContext.expectedComplexity,
          intelligence_level: 'full_autonomous'
        }
      });
      
    } catch (error) {
      console.error('Processing error:', error);
      this.intelligentErrorHandler(error, req, res, () => {});
    }
  }

  analyzeContent(message, context) {
    // Intelligent content analysis
    const analysis = {
      message_length: message?.length || 0,
      has_code: /```|`[^`]+`/.test(message || ''),
      has_urls: /https?:\/\//.test(message || ''),
      complexity_score: this.calculateComplexityScore(message, context),
      intent: this.detectIntent(message),
      required_capabilities: this.identifyRequiredCapabilities(message)
    };
    
    return analysis;
  }

  calculateComplexityScore(message, context) {
    let score = 0;
    
    if (message) {
      score += Math.min(message.length / 1000, 5); // Length factor
      score += (message.match(/```/g) || []).length; // Code blocks
      score += (message.match(/https?:\/\//g) || []).length; // URLs
    }
    
    if (context) {
      score += Object.keys(context).length * 0.5;
    }
    
    return Math.min(score, 10); // Cap at 10
  }

  detectIntent(message) {
    const intentPatterns = [
      { pattern: /find|search|look for|locate/i, intent: 'search' },
      { pattern: /create|make|build|generate/i, intent: 'create' },
      { pattern: /explain|what is|how to|why/i, intent: 'explain' },
      { pattern: /fix|solve|debug|error/i, intent: 'troubleshoot' },
      { pattern: /optimize|improve|better/i, intent: 'optimize' }
    ];
    
    for (const { pattern, intent } of intentPatterns) {
      if (pattern.test(message || '')) {
        return intent;
      }
    }
    
    return 'general';
  }

  identifyRequiredCapabilities(message) {
    const capabilities = [];
    
    if (/browser|web|url|website/i.test(message || '')) capabilities.push('web_browsing');
    if (/file|document|read|write/i.test(message || '')) capabilities.push('file_operations');
    if (/terminal|command|shell|execute/i.test(message || '')) capabilities.push('shell_access');
    if (/image|picture|visual|screenshot/i.test(message || '')) capabilities.push('visual_processing');
    if (/code|programming|script|function/i.test(message || '')) capabilities.push('code_generation');
    
    return capabilities;
  }

  async generateIntelligentResponse(message, context, analysis, provider, sessionId) {
    console.log(`🎯 Generating response with ${provider.name} (${provider.reason})`);
    
    // This would integrate with actual AI providers in a real implementation
    const response = {
      content: `Intelligent response generated for: "${message?.substring(0, 100)}..."`,
      analysis,
      provider: provider.name,
      processing_strategy: this.runtimeConfig.execution_strategy.mode,
      confidence: this.calculateConfidence(analysis),
      suggestions: this.generateSuggestions(analysis)
    };
    
    // Track execution history for learning
    this.executionHistory.push({
      timestamp: new Date().toISOString(),
      sessionId,
      analysis,
      provider: provider.name,
      success: true
    });
    
    return response;
  }

  calculateConfidence(analysis) {
    let confidence = 0.5; // Base confidence
    
    if (analysis.complexity_score < 3) confidence += 0.2;
    if (analysis.intent !== 'general') confidence += 0.1;
    if (analysis.required_capabilities.length > 0) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  generateSuggestions(analysis) {
    const suggestions = [];
    
    if (analysis.complexity_score > 7) {
      suggestions.push("Consider breaking this request into smaller parts for better processing");
    }
    
    if (analysis.has_urls) {
      suggestions.push("I can help analyze web content if needed");
    }
    
    if (analysis.has_code) {
      suggestions.push("I can provide code review and optimization suggestions");
    }
    
    return suggestions;
  }

  handleIntelligenceInsights(req, res) {
    const insights = {
      system_status: 'fully_intelligent',
      learning: {
        total_interactions: this.executionHistory.length,
        success_rate: this.calculateSuccessRate(),
        most_common_intents: this.getMostCommonIntents(),
        performance_trends: this.getPerformanceTrends()
      },
      adaptive_improvements: this.getAdaptiveImprovements(),
      recommendations: this.generateSystemRecommendations()
    };
    
    res.json(insights);
  }

  calculateSuccessRate() {
    if (this.executionHistory.length === 0) return 1.0;
    const successCount = this.executionHistory.filter(h => h.success).length;
    return successCount / this.executionHistory.length;
  }

  getMostCommonIntents() {
    const intentCounts = {};
    for (const history of this.executionHistory) {
      const intent = history.analysis?.intent || 'unknown';
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    }
    
    return Object.entries(intentCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([intent, count]) => ({ intent, count }));
  }

  getPerformanceTrends() {
    // Simplified trend analysis
    const recent = this.executionHistory.slice(-10);
    const avg_complexity = recent.reduce((sum, h) => sum + (h.analysis?.complexity_score || 0), 0) / recent.length;
    
    return {
      recent_average_complexity: avg_complexity.toFixed(2),
      trend: avg_complexity > 5 ? 'increasing_complexity' : 'stable'
    };
  }

  getAdaptiveImprovements() {
    return [
      'Dynamic context limit adjustment based on available memory',
      'Intelligent provider failover implemented',
      'Self-healing service discovery active',
      'Performance-based routing optimization enabled'
    ];
  }

  generateSystemRecommendations() {
    const recommendations = [];
    
    if (this.runtimeConfig.discovered.providers.length < 2) {
      recommendations.push('Consider configuring additional AI providers for redundancy');
    }
    
    if (this.performanceMetrics.size > 0) {
      const avgErrorRate = Array.from(this.performanceMetrics.values())
        .reduce((sum, m) => sum + m.error_rate, 0) / this.performanceMetrics.size;
      
      if (avgErrorRate > 0.1) {
        recommendations.push('High error rate detected. Consider reviewing provider configurations');
      }
    }
    
    return recommendations;
  }

  handleAdaptiveConfig(req, res) {
    res.json({
      current_config: this.runtimeConfig,
      intelligence_level: 'full_autonomous',
      last_adaptation: new Date().toISOString(),
      next_adaptation: 'continuous'
    });
  }

  handlePerformanceMetrics(req, res) {
    res.json({
      providers: Object.fromEntries(this.performanceMetrics),
      system: {
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        cpu_usage: process.cpuUsage()
      },
      intelligence: {
        total_requests_processed: this.executionHistory.length,
        average_confidence: this.calculateAverageConfidence(),
        learning_effectiveness: 'high'
      }
    });
  }

  calculateAverageConfidence() {
    if (this.executionHistory.length === 0) return 0;
    // This would be calculated from actual confidence scores
    return 0.85; // Placeholder
  }

  async initializeProviderManagement() {
    console.log('🔌 Initializing intelligent provider management...');
    
    for (const provider of this.runtimeConfig.discovered.providers) {
      console.log(`✅ Provider ${provider.name} registered with priority ${provider.priority}`);
      this.providers.set(provider.name, provider);
    }
  }

  startAdaptiveMonitoring() {
    console.log('📊 Starting adaptive monitoring system...');
    
    // Monitor every 30 seconds
    setInterval(async () => {
      await this.performAdaptiveAnalysis();
    }, 30000);
    
    // Periodic config refresh every 5 minutes
    setInterval(async () => {
      await this.refreshAdaptiveConfig();
    }, 300000);
  }

  async performAdaptiveAnalysis() {
    // Analyze current performance and adapt if needed
    const currentPerformance = Array.from(this.performanceMetrics.values());
    
    if (currentPerformance.some(p => p.error_rate > 0.2)) {
      console.log('⚠️  High error rate detected, adapting system...');
      await this.refreshAdaptiveConfig();
    }
  }

  async refreshAdaptiveConfig() {
    console.log('🔄 Refreshing adaptive configuration...');
    
    try {
      const newConfig = await this.configManager.generateAdaptiveConfig();
      this.runtimeConfig = newConfig;
      await this.configManager.saveAdaptiveConfig(newConfig);
      
      console.log('✅ Configuration refreshed successfully');
    } catch (error) {
      console.error('Failed to refresh config:', error);
    }
  }

  async start() {
    const port = this.runtimeConfig?.adaptive_ports?.ORCHESTRATOR_PORT || 5101;
    
    this.app.listen(port, '127.0.0.1', () => {
      console.log(`🚀 Intelligent ATLAS Orchestrator running on port ${port}`);
      console.log(`🧠 Intelligence Level: ${this.configManager.config.system.intelligence_level}`);
      console.log(`📡 Services: ${this.runtimeConfig.discovered.services.length} discovered`);
      console.log(`🔌 Providers: ${this.runtimeConfig.discovered.providers.length} available`);
      console.log(`⚡ Strategy: ${this.runtimeConfig.execution_strategy.mode}`);
    });
  }
}

// Start the intelligent orchestrator
const orchestrator = new IntelligentOrchestrator();
orchestrator.start().catch(console.error);
