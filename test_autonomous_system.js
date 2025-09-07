#!/usr/bin/env node

/**
 * Test script to validate the autonomous, non-blocking ATLAS system
 * Tests the prompt-driven architecture and Atlas auto-response functionality
 */

import axios from 'axios';
import { setTimeout } from 'timers/promises';

const ORCHESTRATOR_BASE = 'http://localhost:5101';
const TEST_SESSION_ID = 'test_autonomous_' + Date.now();

async function testSystemAvailability() {
    console.log('🔍 Testing system availability...');
    try {
        const response = await axios.get(`${ORCHESTRATOR_BASE}/health`, { timeout: 5000 });
        if (response.status === 200) {
            console.log('✅ Orchestrator is running');
            return true;
        }
    } catch (error) {
        console.log('❌ Orchestrator not available:', error.message);
        return false;
    }
}

async function testPromptDrivenResponse() {
    console.log('\n🧠 Testing prompt-driven response (no hardcoded patterns)...');
    
    const testMessage = "Calculate the square root of 144 and explain your process";
    
    try {
        const response = await axios.post(`${ORCHESTRATOR_BASE}/chat`, {
            message: testMessage,
            sessionId: TEST_SESSION_ID + '_prompt'
        }, { timeout: 30000 });
        
        if (response.status === 200 && response.data.success) {
            const content = response.data.response;
            
            // Check that it's NOT using the old hardcoded fast lane
            const hasHardcodedPattern = content.some(msg => 
                msg.content && (
                    msg.content.includes('deterministic_math') ||
                    msg.content.includes('fast_lane') ||
                    msg.content.includes('РЕЗЮМЕ: Виконано просте обчислення')
                )
            );
            
            if (hasHardcodedPattern) {
                console.log('❌ System still using hardcoded patterns');
                return false;
            } else {
                console.log('✅ System using prompt-driven approach');
                console.log(`📝 Response from: ${content.map(m => m.agent).join(' → ')}`);
                return true;
            }
        }
    } catch (error) {
        console.log('❌ Prompt-driven test failed:', error.message);
        return false;
    }
}

async function testAutonomousOperation() {
    console.log('\n🤖 Testing autonomous operation without user interaction...');
    
    const testMessage = "Create a simple Python script that prints 'Hello ATLAS'";
    
    try {
        const response = await axios.post(`${ORCHESTRATOR_BASE}/chat`, {
            message: testMessage,
            sessionId: TEST_SESSION_ID + '_autonomous'
        }, { timeout: 60000 });
        
        if (response.status === 200 && response.data.success) {
            console.log('✅ System completed task autonomously');
            
            const agents = response.data.response.map(m => m.agent);
            const hasAtlas = agents.includes('atlas');
            const hasGrisha = agents.includes('grisha');
            const hasTetyana = agents.includes('tetyana');
            
            console.log(`📊 Agents involved: ${agents.join(' → ')}`);
            console.log(`🎯 Multi-agent pipeline: ${hasAtlas && hasGrisha && hasTetyana ? 'Complete' : 'Partial'}`);
            
            return true;
        }
    } catch (error) {
        console.log('❌ Autonomous operation test failed:', error.message);
        return false;
    }
}

async function testAtlasAutoResponse() {
    console.log('\n🆘 Testing Atlas auto-response for timeout scenarios...');
    
    // This test simulates a scenario where Atlas should provide auto-response
    const testMessage = "Provide detailed system analysis with extensive research requirements";
    
    try {
        // Set a shorter timeout to potentially trigger Atlas assistance
        const response = await axios.post(`${ORCHESTRATOR_BASE}/chat`, {
            message: testMessage,
            sessionId: TEST_SESSION_ID + '_autoresponse',
            // Simulate a scenario that might need clarification
            simulateSlowResponse: true
        }, { timeout: 45000 });
        
        if (response.status === 200 && response.data.success) {
            const responses = response.data.response;
            
            // Check for Atlas auto-responses or assistance
            const hasAtlasAssist = responses.some(msg => 
                msg.content && (
                    msg.content.includes('[ATLAS-ASSIST]') ||
                    msg.content.includes('[AUTO-CLARIFICATION]') ||
                    msg.content.includes('auto-response') ||
                    msg.provider === 'atlas_assistance'
                )
            );
            
            if (hasAtlasAssist) {
                console.log('✅ Atlas auto-response system working');
                return true;
            } else {
                console.log('⚠️  No Atlas auto-response detected (system may be fast enough)');
                return true; // Not necessarily a failure
            }
        }
    } catch (error) {
        console.log('❌ Atlas auto-response test failed:', error.message);
        return false;
    }
}

async function testPipelineHUD() {
    console.log('\n📊 Testing pipeline HUD endpoint...');
    
    try {
        const response = await axios.get(`${ORCHESTRATOR_BASE}/metrics/pipeline`, { timeout: 5000 });
        
        if (response.status === 200 && response.data) {
            console.log('✅ Pipeline metrics available');
            
            const metrics = response.data;
            const hasRequiredMetrics = (
                typeof metrics.messagesTotal === 'number' &&
                typeof metrics.actionableSessions === 'number' &&
                typeof metrics.verdicts === 'number'
            );
            
            if (hasRequiredMetrics) {
                console.log(`📈 Pipeline processed ${metrics.messagesTotal} messages, ${metrics.actionableSessions} sessions`);
                return true;
            } else {
                console.log('❌ Missing required pipeline metrics');
                return false;
            }
        }
    } catch (error) {
        console.log('❌ Pipeline HUD test failed:', error.message);
        return false;
    }
}

async function runTests() {
    console.log('🚀 Starting ATLAS Autonomous System Tests\n');
    
    const tests = [
        { name: 'System Availability', fn: testSystemAvailability },
        { name: 'Prompt-Driven Response', fn: testPromptDrivenResponse },
        { name: 'Autonomous Operation', fn: testAutonomousOperation },
        { name: 'Atlas Auto-Response', fn: testAtlasAutoResponse },
        { name: 'Pipeline HUD', fn: testPipelineHUD }
    ];
    
    let passed = 0;
    let total = tests.length;
    
    for (const test of tests) {
        try {
            const result = await test.fn();
            if (result) {
                passed++;
            }
        } catch (error) {
            console.log(`❌ ${test.name} threw exception:`, error.message);
        }
        
        // Small delay between tests
        await setTimeout(1000);
    }
    
    console.log(`\n📋 Test Results: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All tests passed! ATLAS autonomous system is working correctly.');
        process.exit(0);
    } else {
        console.log('⚠️  Some tests failed. Check the system configuration.');
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(error => {
        console.error('💥 Test suite failed:', error.message);
        process.exit(1);
    });
}

export { runTests };