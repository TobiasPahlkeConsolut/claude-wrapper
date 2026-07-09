// OpenAI API Types (from original POC)
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: any[];
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// A single event emitted by the streaming path. Text deltas arrive as the
// Claude CLI produces them; a 'tool_calls' event is emitted instead of text
// when a tool-carrying request resolves to a tool call (detected by sniffing
// the first non-whitespace character - see CoreWrapper.streamChatCompletion);
// a final 'done' event carries the stop reason and (unlike the old buffered
// path) the real token usage reported by the CLI.
export type ClaudeStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; toolCalls: OpenAIToolCall[] }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'tool_calls'; usage?: OpenAIUsage };

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls';
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// Validation Types
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Claude CLI Types
export interface ClaudeRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: any[];
  systemPrompt?: string;
}

// Core Interface Contracts (SOLID Principles)
export interface IClaudeClient {
  execute(request: ClaudeRequest): Promise<string>;
  executeStreaming(request: ClaudeRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown>;
}

export interface IClaudeResolver {
  findClaudeCommand(): Promise<string>;
  executeClaudeCommand(prompt: string, model: string, systemPrompt?: string | null): Promise<string>;
  executeClaudeCommandStreaming(prompt: string, model: string, systemPrompt?: string | null): AsyncGenerator<ClaudeStreamEvent, void, unknown>;
}

export interface IResponseValidator {
  validate(response: string): ValidationResult;
  parse(response: string): OpenAIResponse;
}

export interface ICoreWrapper {
  handleChatCompletion(request: OpenAIRequest): Promise<OpenAIResponse>;
  streamChatCompletion(request: OpenAIRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown>;
}

// Configuration Types
export interface EnvironmentConfig {
  port: number;
  host: string;
  timeout: number;
  claudeCommand: string | undefined;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// Error Types
export interface ClaudeWrapperError {
  code: string;
  message: string;
  details?: any;
}


// Streaming Types (Phase 4A)
export interface StreamingToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface StreamingDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: StreamingToolCallDelta[];
}

export interface OpenAIStreamingChoice {
  index: number;
  delta: StreamingDelta;
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface OpenAIStreamingResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamingChoice[];
  usage?: OpenAIUsage;
}

export interface StreamConnection {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  isActive: boolean;
  response?: any; // Express Response object
}

export interface IStreamingHandler {
  handleStreamingRequest(request: OpenAIRequest, response: any): Promise<void>;
  createStreamingResponse(request: OpenAIRequest): AsyncGenerator<string, void, unknown>;
}

export interface IStreamingFormatter {
  formatChunk(chunk: OpenAIStreamingResponse): string;
  formatError(error: Error): string;
  formatDone(): string;
  formatInitialChunk(requestId: string, model: string): string;
  createContentChunk(requestId: string, model: string, content: string): string;
  createToolCallsChunk(requestId: string, model: string, toolCalls: OpenAIToolCall[]): string;
  createFinalChunk(requestId: string, model: string, finishReason?: string, usage?: OpenAIUsage): string;
}

export interface IStreamingManager {
  createConnection(id: string, response: any): void;
  getConnection(id: string): StreamConnection | null;
  closeConnection(id: string): boolean;
  cleanup(): void;
  getActiveConnections(): number;
  shutdown(): void;
}