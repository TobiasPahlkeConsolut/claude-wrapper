import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/error';
import { logger } from '../../utils/logger';

const router = Router();

// Claude models available via the `claude` CLI's --model flag.
// Short aliases (fable/opus/sonnet/haiku) resolve to the latest model in that
// tier; the full IDs let a caller pin an exact version. Keep in sync with
// shared/models.md in the claude-api skill when new models ship.
const CLAUDE_MODELS = [
  // Latest-of-tier aliases
  { id: 'fable', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'opus', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'sonnet', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'haiku', object: 'model', owned_by: 'anthropic', created: 1709164800 },

  // Pinned full model IDs
  { id: 'claude-fable-5', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-opus-4-8', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-opus-4-7', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-opus-4-6', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-sonnet-5', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-sonnet-4-6', object: 'model', owned_by: 'anthropic', created: 1709164800 },
  { id: 'claude-haiku-4-5', object: 'model', owned_by: 'anthropic', created: 1709164800 }
];

// Allowlist of model identifiers we will pass to the `claude` CLI's --model
// flag. Validating against this set is what prevents a caller-supplied model
// from carrying shell metacharacters into the CLI invocation (the non-streaming
// path builds its command via a shell). Keep in sync with CLAUDE_MODELS above.
export const VALID_MODEL_IDS: ReadonlySet<string> = new Set(CLAUDE_MODELS.map(m => m.id));

export function isValidModel(model: string): boolean {
  return VALID_MODEL_IDS.has(model);
}

router.get('/v1/models', asyncHandler(async (_req: Request, res: Response) => {
  logger.info('Returning available Claude models', { count: CLAUDE_MODELS.length });
  
  res.json({
    object: 'list',
    data: CLAUDE_MODELS
  });
}));

export default router;