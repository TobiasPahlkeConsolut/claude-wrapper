import {
  parseModelSpec,
  isValidModel,
  VALID_MODEL_IDS,
  VALID_EFFORT_LEVELS,
} from '../../../src/config/models';

describe('config/models model+effort parsing', () => {
  describe('parseModelSpec', () => {
    it('parses a bare model id with no effort', () => {
      expect(parseModelSpec('opus')).toEqual({ model: 'opus' });
      expect(parseModelSpec('claude-opus-4-8')).toEqual({ model: 'claude-opus-4-8' });
    });

    it('parses a model id with an effort suffix', () => {
      expect(parseModelSpec('opus:high')).toEqual({ model: 'opus', effort: 'high' });
      expect(parseModelSpec('opus:low')).toEqual({ model: 'opus', effort: 'low' });
    });

    it('splits a pinned (hyphenated) id from its effort on the colon', () => {
      expect(parseModelSpec('claude-sonnet-5:max')).toEqual({
        model: 'claude-sonnet-5',
        effort: 'max',
      });
    });

    it('accepts every documented effort level', () => {
      for (const level of VALID_EFFORT_LEVELS) {
        expect(parseModelSpec(`opus:${level}`)).toEqual({ model: 'opus', effort: level });
      }
    });

    it('rejects an unknown base model', () => {
      expect(parseModelSpec('gpt-4')).toBeNull();
      expect(parseModelSpec('gpt-4:high')).toBeNull();
    });

    it('rejects an unknown effort level (base is valid)', () => {
      expect(parseModelSpec('opus:ultra')).toBeNull();
      expect(parseModelSpec('opus:')).toBeNull();
    });

    it('rejects shell-metacharacter injection in either half', () => {
      expect(parseModelSpec('sonnet & calc.exe')).toBeNull();
      expect(parseModelSpec('opus:high; rm -rf /')).toBeNull();
      expect(parseModelSpec('opus:$(whoami)')).toBeNull();
    });
  });

  describe('isValidModel', () => {
    it('accepts bare and effort-suffixed ids', () => {
      expect(isValidModel('opus')).toBe(true);
      expect(isValidModel('opus:high')).toBe(true);
    });

    it('rejects unknown models and bad effort suffixes', () => {
      expect(isValidModel('gpt-4')).toBe(false);
      expect(isValidModel('opus:ultra')).toBe(false);
    });

    it('agrees with the allowlist for every base model', () => {
      for (const id of VALID_MODEL_IDS) {
        expect(isValidModel(id)).toBe(true);
      }
    });
  });
});
