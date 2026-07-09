import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/error';
import { logger } from '../../utils/logger';
import { BASE_MODEL_IDS } from '../../config/models';

// Re-exported for callers that validate an incoming model string (the chat
// route). The allowlist and the parsing rules live in config/models so the
// route, the validator, and the CLI invocation can't drift apart.
export { VALID_MODEL_IDS, isValidModel } from '../../config/models';

const router = Router();

// The `/v1/models` discovery payload, built from the shared allowlist so it
// always lists exactly the base models the CLI will accept. Callers append an
// optional `:<effort>` suffix (e.g. `opus:high`) to pick a reasoning-effort
// tier per config entry — see VALID_EFFORT_LEVELS — rather than enumerating
// every model×effort combination here.
const CLAUDE_MODELS = BASE_MODEL_IDS.map((id) => ({
  id,
  object: 'model',
  owned_by: 'anthropic',
  created: 1709164800,
}));

router.get('/v1/models', asyncHandler(async (_req: Request, res: Response) => {
  logger.info('Returning available Claude models', { count: CLAUDE_MODELS.length });
  
  res.json({
    object: 'list',
    data: CLAUDE_MODELS
  });
}));

export default router;