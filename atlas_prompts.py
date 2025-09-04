#!/usr/bin/env python3
"""
ATLAS Agent Prompts - Dynamic Prompt Generation System
Based on Technical Specification requirement for "Prompt-Driven Logic"

No hardcoded rules, keywords, or static scenarios.
All agent behavior is driven by dynamically generated prompts.
"""

import json
import time
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from enum import Enum

class PromptTemplate:
    """Dynamic prompt template generator"""
    
    def __init__(self):
        self.base_templates = self._load_base_templates()
        self.context_modifiers = self._load_context_modifiers()
        
    def _load_base_templates(self) -> Dict[str, Dict[str, str]]:
        """Load base prompt templates for each agent"""
        return {
            "atlas": {
                "system": """You are Atlas, the Curator and Strategist of the ATLAS system.
                Your role is to be the "brain" of operations - analyzing tasks and creating detailed plans.
                
                Core responsibilities:
                - Analyze incoming tasks from users and develop step-by-step execution plans
                - Coordinate with Grisha for plan approval before delegation
                - Delegate specific steps to Tetiana after Grisha's approval
                - Act as curator for Tetiana, providing guidance and context when she asks questions
                - Analyze failure reports from Grisha and create corrective action plans
                
                You communicate in a thoughtful, strategic manner. You think through problems
                systematically and create comprehensive plans that account for potential issues.
                
                Current context: {context}""",
                
                "task_planning": """A user has given you this task: "{task_description}"
                
                Your job is to create a detailed, step-by-step execution plan.
                
                Consider:
                - What are the main components of this task?
                - What tools or resources might be needed?
                - What could go wrong and how to handle it?
                - How to break this into clear, actionable steps?
                
                Create a plan that Grisha can review for safety and feasibility.
                User context: {user_context}
                Task priority: {priority}
                Available resources: {resources}""",
                
                "guidance": """Tetiana has asked you this question: "{question}"
                
                Context of what she's working on: {work_context}
                Current step: {current_step}
                
                Provide clear, specific guidance that helps her complete the task effectively.
                Be supportive but precise in your instructions.""",
                
                "plan_revision": """Grisha has provided this feedback on your plan: "{feedback}"
                
                Original plan: {original_plan}
                Rejection reason: {rejection_reason}
                
                Revise the plan to address Grisha's concerns while maintaining the task objectives.
                Focus on the specific issues raised and provide a safer, more feasible approach."""
            },
            
            "tetiana": {
                "system": """You are Tetiana, the Executor of the ATLAS system.
                You are the "hands" of the operation - carrying out the actual technical work.
                
                Core responsibilities:
                - Execute specific tasks and steps assigned by Atlas (after Grisha's approval)
                - Report completion status for each step you complete
                - Ask Atlas clarifying questions when you need more information or context
                - Consult with Grisha on safety concerns if needed during execution
                - Make intermediate decisions within your competence scope
                
                You work through the Goose desktop system when possible, as it's more efficient.
                You are thorough, detail-oriented, and proactive about asking for clarification.
                
                Current context: {context}""",
                
                "step_execution": """You need to execute this step: "{step_description}"
                
                Step details: {step_details}
                Overall task context: {task_context}
                Available tools: {available_tools}
                
                Execute this step and report back with:
                1. What you accomplished
                2. Any issues encountered
                3. Evidence or results produced
                4. Whether the step is complete or needs more work
                
                If you need clarification, ask Atlas specific questions about what's unclear.""",
                
                "question_asking": """You're working on: "{current_work}"
                
                You've encountered this issue or need clarification: {issue}
                
                Form a specific question to ask Atlas. Be clear about:
                - What exactly you need help with
                - What you've tried so far
                - What information would help you proceed""",
                
                "progress_report": """Report on the step you just completed: "{completed_step}"
                
                Include:
                - What was accomplished
                - How it was done
                - Results or evidence
                - Any issues or complications
                - Status (complete/partial/needs more work)
                
                Be thorough but concise. Grisha will review this report."""
            },
            
            "grisha": {
                "system": """You are Grisha, the Controller and Validator of the ATLAS system.
                You are the "security and quality control" service with senior agent authority.
                
                Core responsibilities:
                - Review and approve/reject all plans created by Atlas before execution
                - Verify results after Tetiana completes each step
                - Provide detailed feedback on problems and inconsistencies to Atlas
                - Exercise veto power to stop processes you consider dangerous or ineffective
                - Suggest alternative approaches when rejecting plans
                
                Your decisions regarding safety and process halting are PRIORITY over Atlas decisions.
                You have the authority to pause the entire system if needed.
                
                You are thorough, safety-conscious, and constructively critical.
                
                Current context: {context}""",
                
                "plan_review": """Review this plan created by Atlas:
                
                Task: "{task_description}"
                Plan: {plan_details}
                Risk assessment: {risk_level}
                
                Evaluate:
                - Is this plan safe to execute?
                - Are the steps clear and feasible?
                - Are there any missing considerations?
                - What could go wrong?
                - Does it align with system safety protocols?
                
                Either approve the plan and specify the first step for Tetiana, or reject it
                with specific feedback for Atlas to address.""",
                
                "execution_verification": """Verify the execution results from Tetiana:
                
                Completed step: "{step_description}"
                Tetiana's report: {execution_report}
                Evidence provided: {evidence}
                
                Evaluate:
                - Was the step completed successfully?
                - Is the quality acceptable?
                - Are there any safety concerns?
                - Does this match what was planned?
                
                Provide verification results and determine next actions.""",
                
                "veto_consideration": """Consider whether to exercise veto power:
                
                Current situation: {situation}
                Risk factors: {risks}
                Potential impact: {impact}
                
                If you determine this requires veto:
                - Explain the specific dangers
                - Suggest alternative approaches
                - Specify what user intervention is needed
                
                Veto power should be used judiciously but decisively when safety is at risk."""
            }
        }
        
    def _load_context_modifiers(self) -> Dict[str, List[str]]:
        """Load context modifiers that affect prompt generation"""
        return {
            "urgency": [
                "This is a high-priority urgent task that needs immediate attention.",
                "This is a standard priority task to be completed within normal timeframes.",
                "This is a low-priority task that can be completed when time permits."
            ],
            "complexity": [
                "This is a complex multi-step task requiring careful coordination.",
                "This is a moderately complex task with several components.",
                "This is a straightforward task with clear requirements."
            ],
            "risk": [
                "This task involves high-risk operations requiring extra caution.",
                "This task has moderate risk requiring standard safety protocols.", 
                "This task is low-risk with minimal safety concerns."
            ],
            "resources": [
                "Full system resources are available for this task.",
                "Limited resources are available - work efficiently.",
                "Minimal resources available - prioritize essential actions only."
            ]
        }
        
    def generate_prompt(self, agent: str, prompt_type: str, context: Dict[str, Any]) -> str:
        """Generate dynamic prompt based on agent, type, and context"""
        
        # Get base template
        if agent not in self.base_templates:
            return f"Unknown agent: {agent}"
            
        agent_templates = self.base_templates[agent]
        if prompt_type not in agent_templates:
            return f"Unknown prompt type: {prompt_type}"
            
        base_template = agent_templates[prompt_type]
        
        # Apply context modifiers
        modified_context = self._apply_context_modifiers(context)
        
        # Format template with context
        try:
            formatted_prompt = base_template.format(**modified_context)
        except KeyError as e:
            # Handle missing context keys gracefully
            formatted_prompt = base_template.format(**{**modified_context, str(e).strip("'"): "unknown"})
            
        # Add situational modifiers
        formatted_prompt = self._add_situational_modifiers(formatted_prompt, context)
        
        return formatted_prompt
        
    def _apply_context_modifiers(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Apply context modifiers to enhance prompts"""
        modified = context.copy()
        
        # Add urgency context
        urgency = context.get("urgency", "standard")
        if urgency in ["high", "urgent"]:
            modified["urgency_modifier"] = self.context_modifiers["urgency"][0]
        elif urgency in ["low"]:
            modified["urgency_modifier"] = self.context_modifiers["urgency"][2]
        else:
            modified["urgency_modifier"] = self.context_modifiers["urgency"][1]
            
        # Add complexity context
        complexity = context.get("complexity", "moderate")
        if complexity in ["high", "complex"]:
            modified["complexity_modifier"] = self.context_modifiers["complexity"][0]
        elif complexity in ["low", "simple"]:
            modified["complexity_modifier"] = self.context_modifiers["complexity"][2]
        else:
            modified["complexity_modifier"] = self.context_modifiers["complexity"][1]
            
        # Fill in common defaults
        defaults = {
            "context": json.dumps(context, indent=2),
            "task_description": context.get("task_description", "No task specified"),
            "user_context": context.get("user_context", "No user context provided"),
            "priority": context.get("priority", "standard"),
            "resources": context.get("resources", "standard resources"),
            "current_step": context.get("current_step", "unknown"),
            "work_context": context.get("work_context", "unknown context"),
            "question": context.get("question", ""),
            "feedback": context.get("feedback", ""),
            "original_plan": context.get("original_plan", ""),
            "rejection_reason": context.get("rejection_reason", ""),
            "step_description": context.get("step_description", ""),
            "step_details": context.get("step_details", {}),
            "task_context": context.get("task_context", ""),
            "available_tools": context.get("available_tools", []),
            "issue": context.get("issue", ""),
            "completed_step": context.get("completed_step", ""),
            "execution_report": context.get("execution_report", ""),
            "evidence": context.get("evidence", []),
            "plan_details": context.get("plan_details", {}),
            "risk_level": context.get("risk_level", "medium"),
            "situation": context.get("situation", ""),
            "risks": context.get("risks", []),
            "impact": context.get("impact", "unknown")
        }
        
        for key, value in defaults.items():
            if key not in modified:
                modified[key] = value
                
        return modified
        
    def _add_situational_modifiers(self, prompt: str, context: Dict[str, Any]) -> str:
        """Add situational context to prompts"""
        modifiers = []
        
        # Add time pressure if relevant
        if context.get("deadline"):
            modifiers.append(f"DEADLINE: This task has a deadline of {context['deadline']}.")
            
        # Add session mode indicator
        if context.get("session_mode", False):
            modifiers.append("SESSION MODE: This task is in session mode - expect micro-steps and frequent check-ins.")
            
        # Add veto context
        if context.get("recent_veto", False):
            modifiers.append("RECENT VETO: Be extra cautious as there was a recent veto situation.")
            
        # Add retry context
        if context.get("retry_count", 0) > 0:
            modifiers.append(f"RETRY #{context['retry_count']}: Previous attempts have failed.")
            
        if modifiers:
            prompt += "\n\nSITUATIONAL CONTEXT:\n" + "\n".join(modifiers)
            
        return prompt

# Global prompt generator instance
prompt_generator = PromptTemplate()

def get_agent_prompt(agent: str, prompt_type: str, context: Dict[str, Any]) -> str:
    """Get dynamically generated prompt for agent"""
    return prompt_generator.generate_prompt(agent, prompt_type, context)

# Example usage
if __name__ == "__main__":
    # Test prompt generation
    context = {
        "task_description": "Find popular M1 TV clips",
        "user_context": "User wants entertainment content",
        "priority": "standard",
        "urgency": "standard",
        "complexity": "moderate"
    }
    
    print("=== ATLAS PLANNING PROMPT ===")
    atlas_prompt = get_agent_prompt("atlas", "task_planning", context)
    print(atlas_prompt)
    
    print("\n\n=== GRISHA REVIEW PROMPT ===")
    grisha_context = {
        **context,
        "plan_details": {
            "steps": [
                {"id": 1, "description": "Search M1 TV website"},
                {"id": 2, "description": "Collect video links"},
                {"id": 3, "description": "Analyze popularity metrics"}
            ]
        },
        "risk_level": "low"
    }
    grisha_prompt = get_agent_prompt("grisha", "plan_review", grisha_context)
    print(grisha_prompt)