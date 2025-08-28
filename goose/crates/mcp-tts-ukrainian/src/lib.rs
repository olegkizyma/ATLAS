//! Ukrainian TTS MCP Server for Goose
//! 
//! This crate provides a Model Context Protocol (MCP) server that integrates
//! Ukrainian Text-to-Speech capabilities into the Goose AI assistant system.
//! 
//! ## Features
//! 
//! - Ukrainian TTS using robinhad/ukrainian-tts with multiple voices
//! - Google TTS fallback for other languages
//! - Audio playback through pygame
//! - Full MCP protocol compatibility
//! - Robust error handling and fallback mechanisms
//! - Multiple Python module compatibility
//! 
//! ## Usage
//! 
//! The server exposes three main tools:
//! - `say_tts`: Convert text to speech with voice and language options
//! - `list_voices`: Get available voices and languages
//! - `tts_status`: Check TTS engine status
//! 
//! ## Voice Options
//! 
//! Ukrainian voices (ukrainian-tts):
//! - tetiana (female, default) - high quality
//! - mykyta (male) - clear pronunciation
//! - oleksa (male) - natural sound
//! - lada (female) - expressive
//! 
//! Other languages use Google TTS with automatic language detection.
//! 
//! ## Integration Notes
//! 
//! This Rust crate integrates with Python TTS implementations by:
//! - Using PyO3 for Python interop
//! - Supporting multiple module names (mcp_tts_fixed, mcp_tts_server, etc.)
//! - Providing graceful fallbacks for missing dependencies
//! - Maintaining full async compatibility with Goose

pub mod router;

pub use router::UkrainianTTSRouter;
