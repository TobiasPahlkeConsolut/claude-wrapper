import { Router, Request, Response } from 'express';
import { CoreWrapper } from '../../core/wrapper';
import { StreamingHandler } from '../../streaming/handler';
import { OpenAIRequest } from '../../types';
import { InvalidRequestError } from '../../utils/errors';
import { asyncHandler } from '../middleware/error';
import { streamingMiddleware } from '../middleware/streaming';
import { isValidModel } from './models';
import { logger } from '../../utils/logger';

const router = Router();
const coreWrapper = new CoreWrapper();
const streamingHandler = new StreamingHandler();

// Apply streaming middleware to chat completions
router.post('/v1/chat/completions', 
  streamingMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    logger.info('Chat completion request received', {
      model: req.body.model,
      messageCount: req.body.messages?.length,
      isStreaming: req.body.stream
    });

    const request: OpenAIRequest = req.body;
    
    // Validate required fields
    if (!request.model || !request.messages || !Array.isArray(request.messages)) {
      throw new InvalidRequestError('Invalid request format: model and messages are required');
    }

    // Reject unknown models. Besides being correct API behavior, this is a
    // security control: the model string is passed to the `claude` CLI's
    // --model flag, and the non-streaming path builds its command through a
    // shell - an unvalidated value could carry shell metacharacters. The
    // allowlist (GET /v1/models) blocks that entirely.
    if (!isValidModel(request.model)) {
      throw new InvalidRequestError(
        `Unsupported model. See GET /v1/models for the list of supported models.`
      );
    }

    if (request.messages.length === 0) {
      throw new InvalidRequestError('Messages array cannot be empty');
    }

    // Validate message format
    for (const message of request.messages) {
      if (!message.role || !['system', 'user', 'assistant', 'tool'].includes(message.role)) {
        throw new InvalidRequestError('Invalid message role. Must be one of: system, user, assistant, tool');
      }
      // An assistant tool-call turn carries its payload in `tool_calls` and
      // legitimately has `content: null` (per the OpenAI spec). Clients like
      // VS Code resend that turn on the next request (alongside the tool
      // result) to continue the conversation, so requiring content here
      // previously 400'd the entire tool round-trip.
      const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
      if (!hasToolCalls && (message.content === undefined || message.content === null)) {
        throw new InvalidRequestError('Message content is required');
      }
    }

    // Handle streaming vs non-streaming requests
    if (request.stream) {
      logger.info('Processing streaming chat completion', {
        model: request.model,
        messageCount: request.messages.length
      });
      
      // Handle streaming request - response is managed by StreamingHandler
      await streamingHandler.handleStreamingRequest(request, res);
      
    } else {
      logger.info('Processing non-streaming chat completion', {
        model: request.model,
        messageCount: request.messages.length
      });
      
      // Handle non-streaming request
      const response = await coreWrapper.handleChatCompletion(request);
      
      logger.info('Chat completion request completed successfully', {
        requestId: response.id,
        model: response.model
      });

      res.json(response);
    }
  })
);

export default router;