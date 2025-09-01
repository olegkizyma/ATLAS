"""
Smart Context Summarization System for ATLAS
Implements progressive context summarization to manage token limits efficiently
"""

import json
import logging
import os
from typing import Dict, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)

class ContextSummarizer:
    """
    Handles intelligent context summarization for long conversations
    """
    
    def __init__(self, max_context_tokens: int = 45000, summary_ratio: float = 0.3):
        self.max_context_tokens = max_context_tokens
        self.summary_ratio = summary_ratio  # 30% of original context
        self.conversation_state = {
            "current_session": [],
            "summarized_history": "",
            "last_summary_timestamp": None,
            "token_count_estimate": 0
        }
    
    def estimate_tokens(self, text: str) -> int:
        """
        Rough token estimation: ~4 chars per token for most languages
        More accurate for Ukrainian/Russian: ~3.5 chars per token
        """
        return len(text) // 4 if text else 0
    
    def should_summarize(self, new_content: str) -> bool:
        """
        Determine if we need to summarize context
        """
        estimated_tokens = (
            self.conversation_state["token_count_estimate"] + 
            self.estimate_tokens(new_content)
        )
        
        return estimated_tokens > self.max_context_tokens
    
    def create_summary_prompt(self, context_to_summarize: List[Dict]) -> str:
        """
        Create a focused summary prompt for the AI
        """
        context_text = ""
        for item in context_to_summarize:
            if isinstance(item, dict):
                role = item.get("role", "unknown")
                content = item.get("content", "")
                context_text += f"\n{role.upper()}: {content}\n"
            else:
                context_text += f"\n{item}\n"
        
        summary_prompt = f"""
Створи стислий, але інформативний підсумок наступної розмови, зберігаючи:
1. Ключові технічні деталі та рішення
2. Важливі помилки та їх виправлення  
3. Стан системи та налаштування
4. Основні досягнення та результати

Контекст для підсумовування:
{context_text}

Підсумок повинен бути структурованим та займати не більше {int(len(context_text) * self.summary_ratio)} символів.
"""
        return summary_prompt
    
    def summarize_context(self, context_to_summarize: List[Dict], ai_client) -> str:
        """
        Generate summary using AI
        """
        try:
            summary_prompt = self.create_summary_prompt(context_to_summarize)
            
            response = ai_client.generate_response(
                messages=[{
                    "role": "system", 
                    "content": "Ти експерт з підсумовування технічних розмов. Створи точний та стислий підсумок."
                }, {
                    "role": "user", 
                    "content": summary_prompt
                }],
                max_tokens=2000
            )
            
            summary = response.get("content", "")
            logger.info(f"Context summarized: {len(''.join([str(item) for item in context_to_summarize]))} → {len(summary)} chars")
            
            return summary
            
        except Exception as e:
            logger.error(f"Failed to create summary: {e}")
            # Fallback: simple truncation summary
            return self._create_fallback_summary(context_to_summarize)
    
    def _create_fallback_summary(self, context: List[Dict]) -> str:
        """
        Simple fallback summary when AI summarization fails
        """
        summary_parts = []
        
        for item in context[-5:]:  # Last 5 interactions
            if isinstance(item, dict):
                role = item.get("role", "")
                content = item.get("content", "")[:200]  # First 200 chars
                summary_parts.append(f"{role}: {content}...")
        
        return f"[АВТОПІДСУМОК] Останні взаємодії:\n" + "\n".join(summary_parts)
    
    def process_new_interaction(self, user_input: str, ai_response: str, ai_client=None) -> Dict:
        """
        Process new interaction and return optimized context
        """
        # Add new interaction
        new_interaction = [
            {"role": "user", "content": user_input},
            {"role": "assistant", "content": ai_response}
        ]
        
        self.conversation_state["current_session"].extend(new_interaction)
        
        # Check if we need to summarize
        if self.should_summarize(user_input + ai_response):
            if ai_client and self.conversation_state["current_session"]:
                # Create summary of older context
                context_to_summarize = self.conversation_state["current_session"][:-4]  # All except last 2 interactions
                
                if context_to_summarize:
                    new_summary = self.summarize_context(context_to_summarize, ai_client)
                    
                    # Update conversation state
                    self.conversation_state["summarized_history"] += f"\n\n[ПІДСУМОК {datetime.now().strftime('%H:%M')}]\n{new_summary}"
                    self.conversation_state["current_session"] = self.conversation_state["current_session"][-4:]  # Keep last 2 interactions
                    self.conversation_state["last_summary_timestamp"] = datetime.now().isoformat()
        
        # Update token estimate
        self.conversation_state["token_count_estimate"] = (
            self.estimate_tokens(self.conversation_state["summarized_history"]) +
            self.estimate_tokens(''.join([str(item) for item in self.conversation_state["current_session"]]))
        )
        
        return self.get_optimized_context()
    
    def get_optimized_context(self) -> Dict:
        """
        Return optimized context ready for AI
        """
        context = {
            "summarized_history": self.conversation_state["summarized_history"],
            "current_session": self.conversation_state["current_session"],
            "estimated_tokens": self.conversation_state["token_count_estimate"],
            "last_summary": self.conversation_state["last_summary_timestamp"]
        }
        
        return context
    
    def format_for_ai_prompt(self) -> str:
        """
        Format context for inclusion in AI prompt
        """
        formatted_context = ""
        
        if self.conversation_state["summarized_history"]:
            formatted_context += f"[ПОПЕРЕДНІЙ КОНТЕКСТ]\n{self.conversation_state['summarized_history']}\n\n"
        
        formatted_context += "[ПОТОЧНА СЕСІЯ]\n"
        for item in self.conversation_state["current_session"]:
            if isinstance(item, dict):
                role = item.get("role", "").upper()
                content = item.get("content", "")
                formatted_context += f"{role}: {content}\n\n"
        
        return formatted_context
    
    def save_state(self, filepath: str):
        """Save conversation state to file"""
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(self.conversation_state, f, ensure_ascii=False, indent=2)
            logger.info(f"Context state saved to {filepath}")
        except Exception as e:
            logger.error(f"Failed to save context state: {e}")
    
    def load_state(self, filepath: str):
        """Load conversation state from file"""
        try:
            if os.path.exists(filepath):
                with open(filepath, 'r', encoding='utf-8') as f:
                    self.conversation_state = json.load(f)
                logger.info(f"Context state loaded from {filepath}")
                return True
        except Exception as e:
            logger.error(f"Failed to load context state: {e}")
        return False

# Utility functions for easy integration
def create_smart_context_manager(max_tokens=45000):
    """Create a context manager instance"""
    return ContextSummarizer(max_context_tokens=max_tokens)

def integrate_with_orchestrator(context_manager, orchestrator_instance):
    """
    Integration helper for existing orchestrator
    """
    # This will be implemented based on your orchestrator structure
    pass
