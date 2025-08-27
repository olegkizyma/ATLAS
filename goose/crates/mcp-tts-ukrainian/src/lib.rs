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
//! - mykyta (male, default)
//! - oleksa (male)
//! - tetiana (female)
//! - lada (female)
//! 
//! Other languages use Google TTS with automatic language detection.

pub mod router;

pub use router::UkrainianTTSRouter;
