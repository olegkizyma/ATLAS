use mcp_core::{
    handler::{PromptError, ResourceError},
    protocol::ServerCapabilities,
};
use mcp_server::router::CapabilitiesBuilder;
use mcp_server::Router;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use rmcp::model::{
    Content, ErrorCode, ErrorData, JsonRpcMessage, Prompt, Resource, Tool,
};
use rmcp::object;
use serde_json::Value;
use std::{
    future::Future,
    pin::Pin,
};
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct UkrainianTTSRouter {
    tools: Vec<Tool>,
    instructions: String,
}

impl Default for UkrainianTTSRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl UkrainianTTSRouter {
    pub fn new() -> Self {
        // Initialize Python and set up paths
        if let Err(e) = Self::init_python() {
            eprintln!("Failed to initialize Python TTS: {}", e);
        }

        let say_tts = Tool::new(
            "say_tts",
            "Converts text to speech using Ukrainian TTS engine with voice and language selection",
            object!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to convert to speech"
                    },
                    "voice": {
                        "type": "string",
                        "description": "Voice to use (mykyta, oleksa, tetiana, lada, google)",
                        "default": "tetiana"
                    },
                    "lang": {
                        "type": "string",
                        "description": "Language code (uk for Ukrainian, en for English, auto for auto-detect)",
                        "default": "auto"
                    }
                },
                "required": ["text"]
            })
        );

        let list_voices = Tool::new(
            "list_voices",
            "Lists all available TTS voices",
            object!({
                "type": "object",
                "properties": {},
                "required": []
            })
        );

        let tts_status = Tool::new(
            "tts_status",
            "Gets the current status of the TTS engine",
            object!({
                "type": "object",
                "properties": {},
                "required": []
            })
        );

        Self {
            tools: vec![say_tts, list_voices, tts_status],
            instructions: "Ukrainian TTS (Text-to-Speech) MCP server. Supports Ukrainian and English text-to-speech with multiple voice options including high-quality Ukrainian voices (mykyta, oleksa, tetiana, lada) and Google TTS as fallback.".to_string(),
        }
    }

    fn init_python() -> Result<(), ErrorData> {
        Python::with_gil(|py| {
            let sys = py.import_bound("sys").map_err(|e| ErrorData {
                code: ErrorCode::INTERNAL_ERROR,
                message: format!("Failed to import sys: {}", e).into(),
                data: None,
            })?;

            let path = sys.getattr("path").map_err(|e| ErrorData {
                code: ErrorCode::INTERNAL_ERROR,
                message: format!("Failed to get sys.path: {}", e).into(),
                data: None,
            })?;

            // Add virtual environment site-packages path
            path.call_method1("insert", (0, "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv/lib/python3.11/site-packages"))
                .map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to add venv site-packages path: {}", e).into(),
                    data: None,
                })?;

            path.call_method1("append", ("/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian",))
                .map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to add TTS path: {}", e).into(),
                    data: None,
                })?;

            // Try to import required modules to verify they're available
            py.import_bound("pygame").map_err(|e| ErrorData {
                code: ErrorCode::INTERNAL_ERROR,
                message: format!("Failed to import pygame: {}", e).into(),
                data: None,
            })?;

            py.import_bound("gtts").map_err(|e| ErrorData {
                code: ErrorCode::INTERNAL_ERROR,
                message: format!("Failed to import gtts: {}", e).into(),
                data: None,
            })?;

            Ok(())
        })
    }

    async fn call_tts(&self, text: &str, voice: &str, lang: &str) -> Result<String, ErrorData> {
        let text = text.to_string();
        let voice = voice.to_string();
        let lang = lang.to_string();

        let result = tokio::task::spawn_blocking(move || {
            Python::with_gil(|py| -> Result<String, ErrorData> {
                let tts_module = py.import_bound("mcp_tts_server").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to import TTS server: {}", e).into(),
                    data: None,
                })?;

                let tts_class = tts_module.getattr("MCPTTSServer").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to get TTS server class: {}", e).into(),
                    data: None,
                })?;

                let tts_instance = tts_class.call0().map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to create TTS server instance: {}", e).into(),
                    data: None,
                })?;

                let args = PyDict::new_bound(py);
                args.set_item("text", &text).map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to set text argument: {}", e).into(),
                    data: None,
                })?;
                args.set_item("voice", &voice).map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to set voice argument: {}", e).into(),
                    data: None,
                })?;
                args.set_item("lang", &lang).map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to set lang argument: {}", e).into(),
                    data: None,
                })?;

                let result = tts_instance
                    .call_method1("call_tool_sync", ("say_tts", args))
                    .map_err(|e| ErrorData {
                        code: ErrorCode::INTERNAL_ERROR,
                        message: format!("Failed to call TTS: {}", e).into(),
                        data: None,
                    })?;

                // Convert result to string
                let result_str = result.extract::<String>().unwrap_or_else(|_| format!("{:?}", result));
                Ok(result_str)
            })
        }).await.map_err(|e| ErrorData {
            code: ErrorCode::INTERNAL_ERROR,
            message: format!("Task join error: {}", e).into(),
            data: None,
        })?;

        result
    }

    async fn get_voices(&self) -> Result<String, ErrorData> {
        let result = tokio::task::spawn_blocking(move || {
            Python::with_gil(|py| -> Result<String, ErrorData> {
                let tts_module = py.import_bound("mcp_tts_server").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to import TTS server: {}", e).into(),
                    data: None,
                })?;

                let tts_class = tts_module.getattr("MCPTTSServer").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to get TTS server class: {}", e).into(),
                    data: None,
                })?;

                let tts_instance = tts_class.call0().map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to create TTS server instance: {}", e).into(),
                    data: None,
                })?;

                let result = tts_instance
                    .call_method1("call_tool_sync", ("list_voices", PyDict::new_bound(py)))
                    .map_err(|e| ErrorData {
                        code: ErrorCode::INTERNAL_ERROR,
                        message: format!("Failed to get voices: {}", e).into(),
                        data: None,
                    })?;

                let result_str = result.extract::<String>().unwrap_or_else(|_| format!("{:?}", result));
                Ok(result_str)
            })
        }).await.map_err(|e| ErrorData {
            code: ErrorCode::INTERNAL_ERROR,
            message: format!("Task join error: {}", e).into(),
            data: None,
        })?;

        result
    }

    async fn get_status(&self) -> Result<String, ErrorData> {
        let result = tokio::task::spawn_blocking(move || {
            Python::with_gil(|py| -> Result<String, ErrorData> {
                let tts_module = py.import_bound("mcp_tts_server").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to import TTS server: {}", e).into(),
                    data: None,
                })?;

                let tts_class = tts_module.getattr("MCPTTSServer").map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to get TTS server class: {}", e).into(),
                    data: None,
                })?;

                let tts_instance = tts_class.call0().map_err(|e| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: format!("Failed to create TTS server instance: {}", e).into(),
                    data: None,
                })?;

                let result = tts_instance
                    .call_method1("call_tool_sync", ("tts_status", PyDict::new_bound(py)))
                    .map_err(|e| ErrorData {
                        code: ErrorCode::INTERNAL_ERROR,
                        message: format!("Failed to get status: {}", e).into(),
                        data: None,
                    })?;

                let result_str = result.extract::<String>().unwrap_or_else(|_| format!("{:?}", result));
                Ok(result_str)
            })
        }).await.map_err(|e| ErrorData {
            code: ErrorCode::INTERNAL_ERROR,
            message: format!("Task join error: {}", e).into(),
            data: None,
        })?;

        result
    }
}

impl Router for UkrainianTTSRouter {
    fn name(&self) -> String {
        "ukrainian-tts".to_string()
    }

    fn instructions(&self) -> String {
        self.instructions.clone()
    }

    fn capabilities(&self) -> ServerCapabilities {
        CapabilitiesBuilder::new()
            .with_tools(false)
            .build()
    }

    fn list_tools(&self) -> Vec<Tool> {
        self.tools.clone()
    }

    fn call_tool(
        &self,
        name: &str,
        arguments: Value,
        _notifier: mpsc::Sender<JsonRpcMessage>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Content>, ErrorData>> + Send + 'static>> {
        let this = self.clone();
        let name = name.to_string();
        let arguments = arguments.clone();

        Box::pin(async move {
            match name.as_str() {
                "say_tts" => {
                    let text = arguments
                        .get("text")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| ErrorData {
                            code: ErrorCode::INVALID_PARAMS,
                            message: "Missing required parameter: text".into(),
                            data: None,
                        })?;

                    let voice = arguments
                        .get("voice")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tetiana");

                    let lang = arguments
                        .get("lang")
                        .and_then(|v| v.as_str())
                        .unwrap_or("auto");

                    match this.call_tts(text, voice, lang).await {
                        Ok(result) => Ok(vec![Content::text(result)]),
                        Err(err) => Ok(vec![Content::text(format!("TTS Error: {}", err.message))]),
                    }
                }
                "list_voices" => {
                    match this.get_voices().await {
                        Ok(result) => Ok(vec![Content::text(result)]),
                        Err(err) => Ok(vec![Content::text(format!("Error getting voices: {}", err.message))]),
                    }
                }
                "tts_status" => {
                    match this.get_status().await {
                        Ok(result) => Ok(vec![Content::text(result)]),
                        Err(err) => Ok(vec![Content::text(format!("Error getting status: {}", err.message))]),
                    }
                }
                _ => Err(ErrorData {
                    code: ErrorCode::METHOD_NOT_FOUND,
                    message: format!("Unknown tool: {}", name).into(),
                    data: None,
                }),
            }
        })
    }

    fn list_prompts(&self) -> Vec<Prompt> {
        vec![]
    }

    fn get_prompt(&self, _name: &str) -> Pin<Box<dyn Future<Output = Result<String, PromptError>> + Send + 'static>> {
        Box::pin(async move {
            Err(PromptError::NotFound("No prompts available".to_string()))
        })
    }

    fn list_resources(&self) -> Vec<Resource> {
        vec![]
    }

    fn read_resource(&self, _uri: &str) -> Pin<Box<dyn Future<Output = Result<String, ResourceError>> + Send + 'static>> {
        Box::pin(async move {
            Err(ResourceError::NotFound("No resources available".to_string()))
        })
    }
}
