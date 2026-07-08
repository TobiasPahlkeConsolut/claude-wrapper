/**
 * Unit tests for Interactive CLI Setup - Core functionality only
 * Tests interactive prompts logic without external dependencies
 */

import {
  InteractiveApiKeySetup,
  IReadlineInterface,
  promptForApiProtection,
  interactiveSetup
} from '../../../src/cli/interactive';
import { SECURITY_ENV_VARS } from '../../../src/config/security-constants';

// Mock readline interface for testing
class MockReadlineInterface implements IReadlineInterface {
  private responses: string[];
  private currentIndex = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async question(): Promise<string> {
    if (this.currentIndex >= this.responses.length) {
      return '';
    }
    return this.responses[this.currentIndex++]!;
  }

  close(): void {
    // Mock implementation
  }
}

describe('InteractiveApiKeySetup', () => {
  let consoleSpy: jest.SpyInstance;
  let originalEnv: typeof process.env;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    originalEnv = { ...process.env };
    
    // Clear security environment variables
    delete process.env[SECURITY_ENV_VARS.API_KEY];
    delete process.env[SECURITY_ENV_VARS.REQUIRE_API_KEY];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('promptForApiProtection', () => {
    it('should return existing when API_KEY is set and skipIfSet is true', async () => {
      process.env[SECURITY_ENV_VARS.API_KEY] = 'existing-key';
      
      const setup = new InteractiveApiKeySetup();
      const result = await setup.promptForApiProtection({ skipIfSet: true });

      expect(result.apiKey).toBeNull();
      expect(result.userChoice).toBe('existing');
      expect(result.message).toBe('API key already configured via environment variable');
    });

    it('should generate API key when user answers yes', async () => {
      const mockReadline = new MockReadlineInterface(['y']);
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      const result = await setup.promptForApiProtection();

      expect(result.userChoice).toBe('yes');
      expect(result.apiKey).toBeDefined();
      expect(typeof result.apiKey).toBe('string');
      expect(result.apiKey!.length).toBe(32); // Default length
      expect(result.message).toBe('API key protection enabled with generated token');
    });

    it('should handle case-insensitive yes responses', async () => {
      const responses = ['Y', 'yes', 'YES', 'Yes'];
      
      for (const response of responses) {
        const mockReadline = new MockReadlineInterface([response]);
        const setup = new InteractiveApiKeySetup(mockReadline);
        
        const result = await setup.promptForApiProtection();
        expect(result.userChoice).toBe('yes');
        expect(result.apiKey).toBeDefined();
      }
    });

    it('should not generate API key when user answers no', async () => {
      const mockReadline = new MockReadlineInterface(['n']);
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      const result = await setup.promptForApiProtection();

      expect(result.userChoice).toBe('no');
      expect(result.apiKey).toBeNull();
      expect(result.message).toBe('API key protection disabled by user choice');
    });

    it('should default to no for empty or unrecognized responses', async () => {
      const responses = ['', 'maybe', 'invalid'];
      
      for (const response of responses) {
        const mockReadline = new MockReadlineInterface([response]);
        const setup = new InteractiveApiKeySetup(mockReadline);
        
        const result = await setup.promptForApiProtection();
        expect(result.userChoice).toBe('no');
        expect(result.apiKey).toBeNull();
      }
    });

    it('should generate API key with custom length', async () => {
      const customLength = 16;
      const mockReadline = new MockReadlineInterface(['y']);
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      const result = await setup.promptForApiProtection({ tokenLength: customLength });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey!.length).toBe(customLength);
    });

    it('should display security prompts when generating key', async () => {
      const mockReadline = new MockReadlineInterface(['y']);
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      await setup.promptForApiProtection();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🔐 API Key Protection Setup'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅ API key protection enabled!'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🔑 Your API key:'));
    });

    it('should display disabled message when user declines', async () => {
      const mockReadline = new MockReadlineInterface(['n']);
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      await setup.promptForApiProtection();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ℹ️  API key protection disabled.'));
    });

    it('should call readline close in finally block', async () => {
      const mockReadline = new MockReadlineInterface(['y']);
      const closeSpy = jest.spyOn(mockReadline, 'close');
      const setup = new InteractiveApiKeySetup(mockReadline);
      
      await setup.promptForApiProtection();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('promptForApiProtection convenience function', () => {
    it('should return API key when user accepts', async () => {
      const mockReadline = new MockReadlineInterface(['y']);
      const apiKey = await promptForApiProtection({ readline: mockReadline });

      expect(apiKey).toBeDefined();
      expect(typeof apiKey).toBe('string');
      expect(apiKey!.length).toBe(32);
    });

    it('should return null when user declines', async () => {
      const mockReadline = new MockReadlineInterface(['n']);
      const apiKey = await promptForApiProtection({ readline: mockReadline });

      expect(apiKey).toBeNull();
    });

    it('should return null when API key already exists', async () => {
      process.env[SECURITY_ENV_VARS.API_KEY] = 'existing-key';
      
      const apiKey = await promptForApiProtection({ skipIfSet: true });

      expect(apiKey).toBeNull();
    });
  });

  describe('maskApiKey', () => {
    it('should mask API key correctly', () => {
      const setup = new InteractiveApiKeySetup();
      const apiKey = 'abcdefghijklmnop';
      
      // Access private method for testing
      const maskMethod = (setup as any).maskApiKey;
      const masked = maskMethod(apiKey);

      expect(masked).toBe('abc**********nop');
    });

    it('should handle short API keys', () => {
      const setup = new InteractiveApiKeySetup();
      const shortKey = 'abc';

      const maskMethod = (setup as any).maskApiKey;
      const masked = maskMethod(shortKey);

      expect(masked).toBe('***');
    });
  });
});

describe('interactiveSetup - applies the chosen key to the environment', () => {
  let consoleSpy: jest.SpyInstance;
  const originalKey = process.env[SECURITY_ENV_VARS.API_KEY];

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    delete process.env[SECURITY_ENV_VARS.API_KEY];
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (originalKey === undefined) {
      delete process.env[SECURITY_ENV_VARS.API_KEY];
    } else {
      process.env[SECURITY_ENV_VARS.API_KEY] = originalKey;
    }
  });

  it('should set API_KEY in the environment when the user opts in (regression: key was previously discarded)', async () => {
    const result = await interactiveSetup(new MockReadlineInterface(['y']));

    expect(result).toBeTruthy();
    expect(process.env[SECURITY_ENV_VARS.API_KEY]).toBe(result);
  });

  it('should leave auth disabled when the user declines', async () => {
    const result = await interactiveSetup(new MockReadlineInterface(['n']));

    expect(result).toBeNull();
    expect(process.env[SECURITY_ENV_VARS.API_KEY]).toBeUndefined();
  });

  it('should preserve an already-configured key', async () => {
    process.env[SECURITY_ENV_VARS.API_KEY] = 'preset-key';

    const result = await interactiveSetup(new MockReadlineInterface(['y']));

    expect(result).toBe('preset-key');
    expect(process.env[SECURITY_ENV_VARS.API_KEY]).toBe('preset-key');
  });
});