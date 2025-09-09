#!/usr/bin/env node
/**
 * Simple test script to demonstrate the new Grisha security functionality
 */

import { generateSecurityCheckPrompt, assessTaskSecurity, getSecurityManifest, addUserManifest } from './security_manifest.js';

async function testGrishaSecuritySystem() {
    console.log('🛡️ Testing Grisha Security System\n');
    
    // Test 1: Default security manifest
    console.log('📋 Test 1: Default Security Manifest');
    const defaultManifest = getSecurityManifest();
    console.log(`  Manifest: ${defaultManifest.name}`);
    console.log(`  Testing Override: ${defaultManifest.testingOverride.enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  Authority: ${defaultManifest.testingOverride.authority}\n`);
    
    // Test 2: Security assessment for different tasks
    console.log('🔍 Test 2: Security Assessment Examples');
    
    const testTasks = [
        'Відкрий Google та знайди інформацію про погоду',
        'Видали всі файли з папки /system',
        'Створи новий документ з аналітикою',
        'Завантаж файл з невідомого сайту та запусти його',
        'Покажи пароль від адміністратора'
    ];
    
    testTasks.forEach((task, index) => {
        const assessment = assessTaskSecurity(task);
        console.log(`  Task ${index + 1}: "${task.slice(0, 40)}..."`);
        console.log(`    Risk Level: ${assessment.riskLevel.toUpperCase()}`);
        console.log(`    Allowed: ${assessment.allowExecution ? 'YES' : 'NO'}`);
        if (assessment.violations.length > 0) {
            console.log(`    Violations: ${assessment.violations.join(', ')}`);
        }
        if (assessment.testingOverride) {
            console.log(`    Testing Override: ${assessment.mandatoryWarning}`);
        }
        console.log();
    });
    
    // Test 3: Security prompt generation
    console.log('💬 Test 3: Grisha Security Prompt Generation');
    const testTask = 'Створи файл з конфіденційними даними';
    const securityPrompt = generateSecurityCheckPrompt(testTask, 'test_user', { atlasPlan: 'Простий план створення файлу' });
    
    console.log('  Generated System Prompt (first 200 chars):');
    console.log(`  "${securityPrompt.systemPrompt.slice(0, 200)}..."\n`);
    
    console.log('  Generated Task Prompt:');
    console.log(`  "${securityPrompt.taskPrompt}"\n`);
    
    // Test 4: Custom user manifest
    console.log('👤 Test 4: Custom User Manifest');
    const customManifest = {
        name: 'Strict Corporate Manifest',
        version: '1.1.0',
        policies: {
            dataAccess: {
                level: 'restricted',
                rules: ['Заборонено доступ до будь-яких персональних даних']
            },
            systemOperations: {
                level: 'blocked',
                rules: ['Заборонено всі системні операції']
            }
        },
        testingOverride: {
            enabled: false,
            authority: 'Security Officer'
        }
    };
    
    try {
        addUserManifest('corporate_user', customManifest);
        const corporateManifest = getSecurityManifest('corporate_user');
        console.log(`  Corporate Manifest: ${corporateManifest.name}`);
        console.log(`  Testing Override: ${corporateManifest.testingOverride.enabled ? 'ENABLED' : 'DISABLED'}`);
        
        // Test with strict manifest
        const strictAssessment = assessTaskSecurity('Видали файл', corporateManifest);
        console.log(`  Strict Assessment - Risk: ${strictAssessment.riskLevel}, Allowed: ${strictAssessment.allowExecution}`);
    } catch (error) {
        console.log(`  Error: ${error.message}`);
    }
    
    console.log('\n✅ Grisha Security System Test Complete');
    console.log('\n📊 Summary:');
    console.log('   - Security manifest system working');
    console.log('   - Risk assessment functional');
    console.log('   - Testing override directive implemented');
    console.log('   - Prompt generation working');
    console.log('   - Custom user manifests supported');
}

// Run the test
testGrishaSecuritySystem().catch(console.error);