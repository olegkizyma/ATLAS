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
                        "description": "Language code (uk for Ukrainian, en for English)",
                        "default": "uk"
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
            instructions: "Ukrainian TTS (Text-to-Speech) MCP server. Supports Ukrainian and English text-to-speech with multiple voice options including high-quality Ukrainian voices (tetiana (default), mykyta, oleksa, lada) and Google TTS as fallback.".to_string(),
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

            // Add multiple possible TTS paths for better compatibility
            let possible_paths = vec![
                "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv/lib/python3.11/site-packages",
                "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv/lib/python3.12/site-packages", 
                "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian",
                "/Users/dev/Documents/GitHub/ATLAS/goose/crates/mcp-tts-ukrainian",
                "."
            ];

            for path_str in possible_paths {
                if std::path::Path::new(path_str).exists() {
                    path.call_method1("insert", (0, path_str))
                        .map_err(|e| ErrorData {
                            code: ErrorCode::INTERNAL_ERROR,
                            message: format!("Failed to add path {}: {}", path_str, e).into(),
                            data: None,
                        })?;
                    tracing::info!("Added Python path: {}", path_str);
                }
            }

            // Try to import required modules with better error handling
            match py.import_bound("pygame") {
                Ok(_) => tracing::info!("pygame imported successfully"),
                Err(e) => tracing::warn!("pygame not available: {}", e),
            }

            match py.import_bound("gtts") {
                Ok(_) => tracing::info!("gtts imported successfully"),
                Err(e) => tracing::warn!("gtts not available: {}", e),
            }

            // Try to import our TTS module
            match py.import_bound("mcp_tts_fixed") {
                Ok(_) => tracing::info!("mcp_tts_fixed imported successfully"),
                Err(e) => {
                    tracing::warn!("mcp_tts_fixed not available, trying alternatives: {}", e);
                    // Try alternative module names
                    for module_name in &["mcp_tts_server", "mcp_tts_simple"] {
                        match py.import_bound(*module_name) {
                            Ok(_) => {
                                tracing::info!("{} imported successfully", module_name);
                                break;
                            },
                            Err(e) => tracing::debug!("{} not available: {}", module_name, e),
                        }
                    }
                }
            }

            Ok(())
        })
    }

    async fn call_tts(&self, text: &str, voice: &str, lang: &str) -> Result<String, ErrorData> {
        let text = text.to_string();
        let voice = voice.to_string();
        let lang = lang.to_string();

        tracing::info!("TTS call: text='{}', voice='{}', lang='{}'", text, voice, lang);

        let result = tokio::task::spawn_blocking(move || {
            Python::with_gil(|py| -> Result<String, ErrorData> {
                // Try different module names in order of preference
                let module_names = vec!["mcp_tts_fixed", "mcp_tts_server", "mcp_tts_simple"];
                let mut tts_module = None;
                
                for module_name in &module_names {
                    match py.import_bound(*module_name) {
                        Ok(module) => {
                            tracing::info!("Successfully imported {}", module_name);
                            tts_module = Some(module);
                            break;
                        },
                        Err(e) => tracing::debug!("Failed to import {}: {}", module_name, e),
                    }
                }

                let tts_module = tts_module.ok_or_else(|| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: "Failed to import any TTS module. Please check if mcp_tts_fixed.py is available.".into(),
                    data: None,
                })?;

                // Try different class names
                let class_names = vec!["MCPTTSServer", "TTSServer", "UkrainianTTSServer"];
                let mut tts_class = None;
                
                for class_name in &class_names {
                    if let Ok(class) = tts_module.getattr(*class_name) {
                        tracing::info!("Found TTS class: {}", class_name);
                        tts_class = Some(class);
                        break;
                    }
                }

                let tts_class = tts_class.ok_or_else(|| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: "Failed to find TTS server class".into(),
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

                // Try different method names for calling TTS
                let method_names = vec!["call_tool_sync", "say_tts", "synthesize"];
                let mut result = None;
                
                for method_name in &method_names {
                    match tts_instance.call_method1(*method_name, ("say_tts", &args)) {
                        Ok(res) => {
                            tracing::info!("TTS call successful using method: {}", method_name);
                            result = Some(res);
                            break;
                        },
                        Err(e) => tracing::debug!("Method {} failed: {}", method_name, e),
                    }
                }

                let result = result.ok_or_else(|| ErrorData {
                    code: ErrorCode::INTERNAL_ERROR,
                    message: "Failed to call TTS with any available method".into(),
                    data: None,
                })?;

                // Convert result to string with better handling
                let result_str = if let Ok(s) = result.extract::<String>() {
                    s
                } else if let Ok(dict) = result.downcast::<PyDict>() {
                    // Handle dictionary response
                    if let Ok(content) = dict.get_item("content") {
                        content.unwrap().extract::<String>().unwrap_or_else(|_| "TTS completed successfully".to_string())
                    } else {
                        "TTS completed successfully".to_string()
                    }
                } else {
                    format!("TTS completed: {:?}", result)
                };
                
                tracing::info!("TTS result: {}", result_str);
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
                        .unwrap_or("uk");

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
