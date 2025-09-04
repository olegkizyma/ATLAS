#!/usr/bin/env python3
"""
ATLAS Backend System - 3-Agent Architecture
Based on Technical Specification v1.0

Implements:
- Atlas Agent (Curator/Strategist)
- Tetiana Agent (Goose Executor)
- Grisha Agent (Controller/Validator) 
- User Controller (External Operator)

Core principles:
- Prompt-driven logic (no hardcoded rules)
- "Living system" communication
- Uncompromising execution
- Hierarchy and security
"""

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
from atlas_prompts import get_agent_prompt

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('atlas.backend')

class AgentRole(Enum):
    """Agent roles in the system"""
    ATLAS = "atlas"       # Curator/Strategist  
    TETIANA = "tetiana"   # Goose Executor
    GRISHA = "grisha"     # Controller/Validator
    USER = "user"         # External Operator

class TaskStatus(Enum):
    """Task execution status"""
    PENDING = "pending"
    PLANNING = "planning"
    APPROVAL = "approval"
    EXECUTION = "execution"
    VERIFICATION = "verification"
    COMPLETED = "completed"
    FAILED = "failed"
    VETOED = "vetoed"

@dataclass
class AgentMessage:
    """Message between agents"""
    sender: AgentRole
    recipient: AgentRole
    content: str
    message_type: str
    timestamp: float = field(default_factory=time.time)
    context: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Task:
    """Task representation"""
    id: str
    description: str
    status: TaskStatus = TaskStatus.PENDING
    plan: Optional[Dict[str, Any]] = None
    current_step: int = 0
    execution_report: Optional[str] = None
    verification_result: Optional[Dict[str, Any]] = None
    messages: List[AgentMessage] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    session_mode: bool = False

class Agent(ABC):
    """Base agent class with prompt-driven behavior"""
    
    def __init__(self, role: AgentRole, system: 'AtlasSystem'):
        self.role = role
        self.system = system
        self.prompts = self._load_prompts()
        
    @abstractmethod
    async def process_message(self, message: AgentMessage) -> Optional[AgentMessage]:
        """Process incoming message and return response"""
        pass
        
    def _load_prompts(self) -> Dict[str, str]:
        """Load agent-specific prompts"""
        return {}  # Prompts are now generated dynamically
        
    def _generate_prompt(self, context: Dict[str, Any], prompt_type: str = "system") -> str:
        """Generate dynamic prompt based on context"""
        return get_agent_prompt(self.role.value, prompt_type, context)

class AtlasAgent(Agent):
    """Atlas - Curator/Strategist Agent"""
    
    def __init__(self, system: 'AtlasSystem'):
        super().__init__(AgentRole.ATLAS, system)
        
    async def process_message(self, message: AgentMessage) -> Optional[AgentMessage]:
        """Process message as Atlas agent"""
        logger.info(f"Atlas processing message from {message.sender.value}: {message.content[:100]}...")
        
        if message.sender == AgentRole.USER and message.message_type == "task":
            return await self._create_task_plan(message)
        elif message.sender == AgentRole.GRISHA and message.message_type == "plan_rejected":
            return await self._revise_plan(message)
        elif message.sender == AgentRole.TETIANA and message.message_type == "question":
            return await self._provide_guidance(message)
        elif message.sender == AgentRole.GRISHA and message.message_type == "verification_failed":
            return await self._create_corrective_plan(message)
            
        return None
        
    async def _create_task_plan(self, message: AgentMessage) -> AgentMessage:
        """Create detailed step-by-step plan using dynamic prompts"""
        task_description = message.content
        context = {
            "task_description": task_description,
            "user_context": message.context.get("user_id", "unknown user"),
            "priority": message.context.get("priority", "standard"),
            "urgency": message.context.get("urgency", "standard"),
            "complexity": self._analyze_task_complexity(task_description),
            "resources": "standard resources"  # Could be dynamic based on system state
        }
        
        # Generate dynamic planning prompt
        planning_prompt = self._generate_prompt(context, "task_planning")
        logger.info(f"Atlas using planning prompt: {planning_prompt[:200]}...")
        
        # This is where Atlas would use the prompt to interact with an LLM
        # For now, create a basic plan based on the prompt guidance
        plan = self._create_plan_from_prompt(context, planning_prompt)
        
        return AgentMessage(
            sender=AgentRole.ATLAS,
            recipient=AgentRole.GRISHA,
            content=f"Plan created for task: {task_description}",
            message_type="plan_approval",
            context={
                "plan": plan, 
                "task_id": message.context.get("task_id"),
                "planning_context": context
            }
        )
        
    def _analyze_task_complexity(self, task_description: str) -> str:
        """Analyze task complexity dynamically"""
        # Simple heuristic - in real implementation this would be more sophisticated
        words = task_description.lower().split()
        complex_indicators = ["analyze", "compare", "integrate", "coordinate", "multiple", "complex", "detailed"]
        simple_indicators = ["find", "get", "show", "list", "display"]
        
        complex_count = sum(1 for word in words if word in complex_indicators)
        simple_count = sum(1 for word in words if word in simple_indicators)
        
        if complex_count > simple_count:
            return "high"
        elif simple_count > complex_count * 2:
            return "low"
        else:
            return "moderate"
            
    def _create_plan_from_prompt(self, context: Dict[str, Any], prompt: str) -> Dict[str, Any]:
        """Create plan based on prompt guidance (placeholder for LLM integration)"""
        task_desc = context["task_description"]
        complexity = context["complexity"]
        
        # Dynamic step creation based on task analysis
        steps = []
        if "find" in task_desc.lower() or "search" in task_desc.lower():
            steps.append({"id": 1, "description": f"Research and locate: {task_desc}", "status": "pending"})
            steps.append({"id": 2, "description": "Validate and organize findings", "status": "pending"})
        else:
            steps.append({"id": 1, "description": f"Analyze task: {task_desc}", "status": "pending"})
            steps.append({"id": 2, "description": "Execute main task actions", "status": "pending"})
            
        if complexity == "high":
            steps.append({"id": len(steps)+1, "description": "Comprehensive verification and quality check", "status": "pending"})
        else:
            steps.append({"id": len(steps)+1, "description": "Verify completion", "status": "pending"})
        
        return {
            "task_id": context.get("task_id"),
            "steps": steps,
            "complexity": complexity,
            "estimated_time": "15-30 minutes" if complexity != "high" else "30-60 minutes",
            "risk_level": "low" if "find" in task_desc.lower() else "medium"
        }
        
    async def _revise_plan(self, message: AgentMessage) -> AgentMessage:
        """Revise plan based on Grisha's feedback"""
        # Dynamic plan revision based on feedback
        return AgentMessage(
            sender=AgentRole.ATLAS,
            recipient=AgentRole.GRISHA,
            content="Revised plan based on your feedback",
            message_type="plan_approval",
            context=message.context
        )
        
    async def _provide_guidance(self, message: AgentMessage) -> AgentMessage:
        """Provide guidance to Tetiana"""
        return AgentMessage(
            sender=AgentRole.ATLAS,
            recipient=AgentRole.TETIANA,
            content="Here's additional context for your question",
            message_type="guidance",
            context=message.context
        )
        
    async def _create_corrective_plan(self, message: AgentMessage) -> AgentMessage:
        """Create corrective plan after verification failure"""
        verification_result = message.context.get("verification_result", {})
        original_plan = message.context.get("approved_plan", {})
        
        # Check if session mode should be activated
        retry_count = message.context.get("retry_count", 0)
        if retry_count >= 2 or verification_result.get("quality_score", 1.0) < 0.5:
            # Activate session mode for critical situations
            logger.info("Activating session mode for task recovery")
            return await self._create_session_mode_plan(message)
        
        # Create regular corrective plan
        corrective_context = {
            "task_description": original_plan.get("task_description", "unknown"),
            "original_plan": original_plan,
            "failure_reason": verification_result.get("failure_reason", "unknown"),
            "retry_count": retry_count,
            "feedback": f"Previous attempt failed: {verification_result.get('failure_reason', 'Unknown issue')}"
        }
        
        revision_prompt = self._generate_prompt(corrective_context, "plan_revision")
        logger.info(f"Atlas creating corrective plan: {revision_prompt[:200]}...")
        
        # Create revised plan
        corrective_plan = self._create_corrective_plan_from_prompt(corrective_context)
        
        return AgentMessage(
            sender=AgentRole.ATLAS,
            recipient=AgentRole.GRISHA,
            content="Corrective plan created based on verification results",
            message_type="plan_approval",
            context={
                **message.context,
                "plan": corrective_plan,
                "retry_count": retry_count + 1,
                "corrective_action": True
            }
        )
        
    async def _create_session_mode_plan(self, message: AgentMessage) -> AgentMessage:
        """Create micro-step session mode plan"""
        original_plan = message.context.get("approved_plan", {})
        failed_step = message.context.get("step", {})
        
        # Break down failed step into micro-steps
        micro_steps = self._create_micro_steps(failed_step, original_plan)
        
        session_plan = {
            "task_id": message.context.get("task_id"),
            "session_mode": True,
            "micro_steps": micro_steps,
            "original_step": failed_step,
            "requires_confirmation": True,
            "step_by_step_execution": True
        }
        
        return AgentMessage(
            sender=AgentRole.ATLAS,
            recipient=AgentRole.GRISHA,
            content=f"Session mode activated - micro-step plan created",
            message_type="plan_approval", 
            context={
                **message.context,
                "plan": session_plan,
                "session_mode": True
            }
        )
        
    def _create_corrective_plan_from_prompt(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Create corrective plan based on failure analysis"""
        original_plan = context.get("original_plan", {})
        failure_reason = context.get("failure_reason", "")
        retry_count = context.get("retry_count", 0)
        
        # Analyze failure and create targeted correction
        corrective_steps = []
        
        if "unclear" in failure_reason.lower() or "ambiguous" in failure_reason.lower():
            # Add clarification step
            corrective_steps.append({
                "id": 1,
                "description": "Clarify task requirements and specifications",
                "status": "pending"
            })
            
        # Add modified version of original steps with safeguards
        original_steps = original_plan.get("steps", [])
        for i, step in enumerate(original_steps):
            modified_step = step.copy()
            modified_step["id"] = len(corrective_steps) + 1
            modified_step["description"] += " (with additional verification)"
            modified_step["safeguards"] = True
            corrective_steps.append(modified_step)
            
        return {
            "task_id": context.get("task_id"),
            "steps": corrective_steps,
            "corrective_action": True,
            "retry_count": retry_count,
            "risk_level": "high" if retry_count > 1 else "medium",
            "additional_verification": True
        }
        
    def _create_micro_steps(self, failed_step: Dict[str, Any], original_plan: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Break down failed step into micro-steps for session mode"""
        step_description = failed_step.get("description", "")
        
        # Create micro-steps based on step type
        micro_steps = []
        
        if "research" in step_description.lower() or "find" in step_description.lower():
            micro_steps = [
                {"id": 1, "description": "Define search criteria", "status": "pending"},
                {"id": 2, "description": "Identify search sources", "status": "pending"},
                {"id": 3, "description": "Execute initial search", "status": "pending"},
                {"id": 4, "description": "Review and filter results", "status": "pending"},
                {"id": 5, "description": "Document findings", "status": "pending"}
            ]
        elif "execute" in step_description.lower():
            micro_steps = [
                {"id": 1, "description": "Prepare execution environment", "status": "pending"},
                {"id": 2, "description": "Execute primary action", "status": "pending"},
                {"id": 3, "description": "Monitor execution progress", "status": "pending"},
                {"id": 4, "description": "Capture execution results", "status": "pending"}
            ]
        else:
            # Generic breakdown
            micro_steps = [
                {"id": 1, "description": f"Prepare for: {step_description}", "status": "pending"},
                {"id": 2, "description": f"Execute: {step_description}", "status": "pending"},
                {"id": 3, "description": f"Verify: {step_description}", "status": "pending"}
            ]
            
        return micro_steps

class TetianaAgent(Agent):
    """Tetiana - Goose Executor Agent"""
    
    def __init__(self, system: 'AtlasSystem'):
        super().__init__(AgentRole.TETIANA, system)
        
    async def process_message(self, message: AgentMessage) -> Optional[AgentMessage]:
        """Process message as Tetiana agent"""
        logger.info(f"Tetiana processing message from {message.sender.value}: {message.content[:100]}...")
        
        if message.sender == AgentRole.ATLAS and message.message_type == "execute_step":
            return await self._execute_step(message)
        elif message.sender == AgentRole.ATLAS and message.message_type == "guidance":
            return await self._continue_with_guidance(message)
            
        return None
        
    async def _execute_step(self, message: AgentMessage) -> AgentMessage:
        """Execute step and report back"""
        # This is where Goose integration would happen
        # For now, simulate execution
        step_info = message.context.get("step", {})
        
        # Simulate asking Atlas for clarification if needed
        if step_info.get("needs_clarification", False):
            return AgentMessage(
                sender=AgentRole.TETIANA,
                recipient=AgentRole.ATLAS,
                content="I need more information to complete this step",
                message_type="question",
                context=message.context
            )
        
        # Simulate execution completion
        execution_report = f"Completed step: {step_info.get('description', 'Unknown step')}"
        
        return AgentMessage(
            sender=AgentRole.TETIANA,
            recipient=AgentRole.GRISHA,
            content=execution_report,
            message_type="execution_complete",
            context={
                **message.context,
                "execution_report": execution_report,
                "evidence": ["log1.txt", "output.json"]  # Mock evidence
            }
        )
        
    async def _continue_with_guidance(self, message: AgentMessage) -> AgentMessage:
        """Continue execution with provided guidance"""
        return AgentMessage(
            sender=AgentRole.TETIANA,
            recipient=AgentRole.GRISHA,
            content="Step completed with provided guidance",
            message_type="execution_complete",
            context=message.context
        )

class GrishaAgent(Agent):
    """Grisha - Controller/Validator Agent"""
    
    def __init__(self, system: 'AtlasSystem'):
        super().__init__(AgentRole.GRISHA, system)
        
    async def process_message(self, message: AgentMessage) -> Optional[AgentMessage]:
        """Process message as Grisha agent"""
        logger.info(f"Grisha processing message from {message.sender.value}: {message.content[:100]}...")
        
        if message.sender == AgentRole.ATLAS and message.message_type == "plan_approval":
            return await self._approve_plan(message)
        elif message.sender == AgentRole.TETIANA and message.message_type == "execution_complete":
            return await self._verify_execution(message)
            
        return None
        
    async def _approve_plan(self, message: AgentMessage) -> AgentMessage:
        """Review and approve/reject plan using dynamic prompts"""
        plan = message.context.get("plan", {})
        planning_context = message.context.get("planning_context", {})
        
        # Generate dynamic review prompt
        review_context = {
            "task_description": planning_context.get("task_description", "unknown task"),
            "plan_details": plan,
            "risk_level": plan.get("risk_level", "unknown"),
            "complexity": planning_context.get("complexity", "unknown"),
            "urgency": planning_context.get("urgency", "standard")
        }
        
        review_prompt = self._generate_prompt(review_context, "plan_review")
        logger.info(f"Grisha using review prompt: {review_prompt[:200]}...")
        
        # Dynamic plan evaluation based on prompt
        approval_result = self._evaluate_plan_with_prompt(plan, review_context, review_prompt)
        
        if not approval_result["approved"]:
            return AgentMessage(
                sender=AgentRole.GRISHA,
                recipient=AgentRole.ATLAS,
                content=f"Plan rejected: {approval_result['reason']}",
                message_type="plan_rejected",
                context={
                    **message.context,
                    "rejection_reason": approval_result["reason"],
                    "suggestions": approval_result.get("suggestions", [])
                }
            )
        
        # Plan approved - send first step to Tetiana
        plan_steps = plan.get("steps", [])
        if plan_steps:
            first_step = plan_steps[0]
            return AgentMessage(
                sender=AgentRole.GRISHA,
                recipient=AgentRole.TETIANA,
                content=f"Execute step: {first_step['description']}",
                message_type="execute_step",
                context={
                    **message.context,
                    "step": first_step,
                    "approved_plan": plan
                }
            )
        
        return None
        
    def _evaluate_plan_with_prompt(self, plan: Dict[str, Any], context: Dict[str, Any], prompt: str) -> Dict[str, Any]:
        """Evaluate plan based on prompt guidance"""
        # Dynamic evaluation logic based on prompt considerations
        
        # Safety checks
        risk_level = plan.get("risk_level", "medium")
        steps = plan.get("steps", [])
        
        # Check for high-risk situations
        if risk_level == "high":
            return {
                "approved": False,
                "reason": "Risk level exceeds safety threshold",
                "suggestions": ["Reduce risk by breaking into smaller steps", "Add safety checkpoints"]
            }
        
        # Check for incomplete plans
        if len(steps) < 2:
            return {
                "approved": False,
                "reason": "Plan is too vague - needs more detailed steps",
                "suggestions": ["Break down into specific actionable steps", "Add verification steps"]
            }
            
        # Check for complexity mismatch
        complexity = context.get("complexity", "moderate")
        if complexity == "high" and len(steps) < 4:
            return {
                "approved": False,
                "reason": "Complex task requires more detailed planning",
                "suggestions": ["Add more intermediate steps", "Include quality checkpoints"]
            }
        
        # Dynamic approval based on context
        urgency = context.get("urgency", "standard")
        if urgency == "high" and not any("priority" in str(step).lower() for step in steps):
            # High urgency tasks approved but with recommendations
            pass
            
        return {
            "approved": True,
            "reason": "Plan meets safety and quality standards",
            "quality_score": 0.85
        }
        
    async def _verify_execution(self, message: AgentMessage) -> AgentMessage:
        """Verify execution results using dynamic prompts"""
        execution_report = message.context.get("execution_report", "")
        evidence = message.context.get("evidence", [])
        step = message.context.get("step", {})
        
        # Generate dynamic verification prompt
        verify_context = {
            "step_description": step.get("description", "unknown step"),
            "execution_report": execution_report,
            "evidence": evidence,
            "completed_step": step.get("description", "unknown")
        }
        
        verify_prompt = self._generate_prompt(verify_context, "execution_verification")
        logger.info(f"Grisha using verification prompt: {verify_prompt[:200]}...")
        
        # Dynamic verification logic
        verification_result = self._verify_with_prompt(verify_context, verify_prompt)
        
        # Check if veto should be applied
        if self._should_apply_veto(verification_result, message.context):
            veto_reason = f"Verification failed: {verification_result.get('failure_reason', 'Unknown issue')}"
            await self.system.apply_veto(veto_reason)
            
            return AgentMessage(
                sender=AgentRole.GRISHA,
                recipient=AgentRole.USER,
                content=f"VETO APPLIED: {veto_reason}",
                message_type="veto_applied",
                context={
                    **message.context,
                    "veto_reason": veto_reason,
                    "verification_result": verification_result
                }
            )
        
        if verification_result["success"]:
            # Check if we should continue with next step or complete task
            approved_plan = message.context.get("approved_plan", {})
            current_step_id = step.get("id", 1)
            all_steps = approved_plan.get("steps", [])
            
            # Find next step
            next_step = None
            for plan_step in all_steps:
                if plan_step["id"] == current_step_id + 1:
                    next_step = plan_step
                    break
            
            if next_step:
                # Continue with next step
                return AgentMessage(
                    sender=AgentRole.GRISHA,
                    recipient=AgentRole.TETIANA,
                    content=f"Execute next step: {next_step['description']}",
                    message_type="execute_step",
                    context={
                        **message.context,
                        "step": next_step
                    }
                )
            else:
                # Task completed
                return AgentMessage(
                    sender=AgentRole.GRISHA,
                    recipient=AgentRole.ATLAS,
                    content="All steps completed successfully",
                    message_type="task_completed",
                    context={
                        **message.context,
                        "verification_result": verification_result
                    }
                )
        else:
            return AgentMessage(
                sender=AgentRole.GRISHA,
                recipient=AgentRole.ATLAS,
                content=f"Step verification failed: {verification_result.get('failure_reason', 'Unknown')}",
                message_type="verification_failed", 
                context={
                    **message.context,
                    "verification_result": verification_result
                }
            )
            
    def _verify_with_prompt(self, context: Dict[str, Any], prompt: str) -> Dict[str, Any]:
        """Verify execution based on prompt guidance"""
        execution_report = context.get("execution_report", "")
        evidence = context.get("evidence", [])
        
        # Dynamic verification based on report content
        success_indicators = ["completed", "done", "finished", "success"]
        failure_indicators = ["failed", "error", "unable", "impossible"]
        
        report_lower = execution_report.lower()
        
        has_success = any(indicator in report_lower for indicator in success_indicators)
        has_failure = any(indicator in report_lower for indicator in failure_indicators)
        has_evidence = len(evidence) > 0
        
        # Determine success based on multiple factors
        if has_failure:
            return {
                "success": False,
                "quality_score": 0.2,
                "failure_reason": "Execution report indicates failure",
                "issues": ["Task execution failed"],
                "evidence_verified": has_evidence
            }
        elif has_success and has_evidence:
            return {
                "success": True,
                "quality_score": 0.95,
                "issues": [],
                "evidence_verified": True
            }
        elif has_success:
            return {
                "success": True,
                "quality_score": 0.8,
                "issues": ["No evidence provided"],
                "evidence_verified": False
            }
        else:
            return {
                "success": False,
                "quality_score": 0.4,
                "failure_reason": "Unclear execution status",
                "issues": ["Report is ambiguous", "No clear success indicators"],
                "evidence_verified": has_evidence
            }
            
    def _should_apply_veto(self, verification_result: Dict[str, Any], context: Dict[str, Any]) -> bool:
        """Determine if veto power should be applied"""
        # Apply veto for critical failures
        if not verification_result.get("success", False):
            quality_score = verification_result.get("quality_score", 1.0)
            
            # Apply veto if quality is very low
            if quality_score < 0.3:
                return True
                
            # Apply veto if there are safety concerns
            issues = verification_result.get("issues", [])
            dangerous_issues = ["safety", "security", "damage", "harmful"]
            if any(dangerous in str(issues).lower() for dangerous in dangerous_issues):
                return True
        
        return False

class AtlasSystem:
    """Main ATLAS system orchestrating agent interactions"""
    
    def __init__(self):
        self.agents = {
            AgentRole.ATLAS: AtlasAgent(self),
            AgentRole.TETIANA: TetianaAgent(self),
            AgentRole.GRISHA: GrishaAgent(self)
        }
        self.tasks: Dict[str, Task] = {}
        self.message_queue = asyncio.Queue()
        self.running = False
        self.veto_active = False
        self.veto_timestamp = 0
        
    async def start(self):
        """Start the ATLAS system"""
        logger.info("Starting ATLAS 3-Agent System...")
        self.running = True
        
        # Start message processing loop
        asyncio.create_task(self._process_messages())
        
    async def stop(self):
        """Stop the ATLAS system"""
        logger.info("Stopping ATLAS system...")
        self.running = False
        
    async def create_task(self, user_id: str, description: str) -> str:
        """Create new task from user"""
        task_id = f"task_{int(time.time())}"
        task = Task(
            id=task_id,
            description=description
        )
        self.tasks[task_id] = task
        
        # Send task to Atlas for planning
        message = AgentMessage(
            sender=AgentRole.USER,
            recipient=AgentRole.ATLAS,
            content=description,
            message_type="task",
            context={"task_id": task_id, "user_id": user_id}
        )
        
        await self.message_queue.put(message)
        logger.info(f"Created task {task_id}: {description}")
        return task_id
        
    async def apply_veto(self, reason: str):
        """Apply Grisha's veto power"""
        logger.warning(f"VETO APPLIED: {reason}")
        self.veto_active = True
        self.veto_timestamp = time.time()
        
        # System pauses for 10 seconds
        await asyncio.sleep(10)
        
        # Send notification to user
        logger.info("Veto requires user intervention to continue")
        
    async def resolve_veto(self, user_id: str, command: str):
        """User resolves veto situation"""
        if self.veto_active:
            logger.info(f"User {user_id} resolved veto with command: {command}")
            self.veto_active = False
            return True
        return False
        
    async def _process_messages(self):
        """Main message processing loop"""
        while self.running:
            if self.veto_active:
                await asyncio.sleep(1)
                continue
                
            try:
                message = await asyncio.wait_for(
                    self.message_queue.get(), 
                    timeout=1.0
                )
                await self._handle_message(message)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                
    async def _handle_message(self, message: AgentMessage):
        """Handle individual message"""
        logger.info(f"Processing message: {message.sender.value} -> {message.recipient.value}")
        
        # Get recipient agent
        recipient_agent = self.agents.get(message.recipient)
        if not recipient_agent:
            logger.warning(f"No agent found for {message.recipient.value}")
            return
            
        # Process message
        response = await recipient_agent.process_message(message)
        
        # Update task message history
        task_id = message.context.get("task_id")
        if task_id and task_id in self.tasks:
            self.tasks[task_id].messages.append(message)
            if response:
                self.tasks[task_id].messages.append(response)
        
        # Queue response message if any
        if response:
            await self.message_queue.put(response)
            
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get current task status"""
        task = self.tasks.get(task_id)
        if not task:
            return None
            
        return {
            "id": task.id,
            "description": task.description,
            "status": task.status.value,
            "current_step": task.current_step,
            "session_mode": task.session_mode,
            "messages": len(task.messages),
            "created_at": task.created_at
        }

# Example usage
async def main():
    """Demo of ATLAS system"""
    system = AtlasSystem()
    await system.start()
    
    # Create a sample task
    task_id = await system.create_task("user1", "Find popular M1 TV clips")
    
    # Let system run for a bit
    await asyncio.sleep(5)
    
    # Check task status
    status = system.get_task_status(task_id)
    print(f"Task status: {json.dumps(status, indent=2)}")
    
    await system.stop()

if __name__ == "__main__":
    asyncio.run(main())