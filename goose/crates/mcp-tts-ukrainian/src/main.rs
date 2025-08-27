use anyhow::Result;
use mcp_server::{ByteTransport, Server};
use mcp_server::router::RouterService;
use mcp_tts_ukrainian::UkrainianTTSRouter;
use tokio::io::{stdin, stdout};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{self, EnvFilter};

type UkrainianTTSServer = Server<RouterService<UkrainianTTSRouter>>;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let file_appender = RollingFileAppender::new(Rotation::DAILY, "logs", "ukrainian-tts-mcp.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    tracing::info!("🎙️ Starting Ukrainian TTS MCP Server");

    // Create the router
    let router = UkrainianTTSRouter::new();
    let router_service = RouterService(router);

    // Create transport for stdin/stdout
    let transport = ByteTransport::new(stdin(), stdout());

    // Create and run the server
    let server = UkrainianTTSServer::new(router_service);
    server.run(transport).await?;

    Ok(())
}
