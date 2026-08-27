import { PROVIDER_REGISTRY, isKnownProvider } from '../../src/llm/providerRegistry';
import { BeeConfig } from '../../src/bee/BeeConfig';

describe('PROVIDER_REGISTRY', () => {
  it('should have all four built-in providers', () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual(
      ['anthropic', 'gemini', 'ollama', 'openai'].sort()
    );
  });

  it('should default Gemini to a current (non-deprecated) model', () => {
    expect(PROVIDER_REGISTRY.gemini.defaultModel).toBe('gemini-flash-2.0');

    const limits = new BeeConfig().getModelLimits(PROVIDER_REGISTRY.gemini.defaultModel);
    expect(limits.deprecated).toBeFalsy();
  });

  it('should expose a default model that BeeConfig knows about for every provider', () => {
    const config = new BeeConfig();
    const registered = config.getRegisteredModels();

    for (const descriptor of Object.values(PROVIDER_REGISTRY)) {
      expect(descriptor.defaultModel).toBeTruthy();
      expect(registered).toContain(descriptor.defaultModel);
    }
  });

  it('isKnownProvider narrows known names and rejects unknown ones', () => {
    expect(isKnownProvider('gemini')).toBe(true);
    expect(isKnownProvider('totally-made-up')).toBe(false);
  });
});

describe('BeeConfig model registry', () => {
  let config: BeeConfig;

  beforeEach(() => {
    config = new BeeConfig();
  });

  it('should register the current Gemini models', () => {
    const models = config.getRegisteredModels();

    expect(models).toContain('gemini-flash-2.0');
    expect(models).toContain('gemini-flash-lite-latest');
    expect(models).toContain('gemini-3.6-flash');
    expect(models).toContain('gemini-2.0-pro');
  });

  it('should return real limits (not conservative defaults) for gemini-flash-lite-latest', () => {
    const limits = config.getModelLimits('gemini-flash-lite-latest');

    expect(limits.name).toBe('Gemini Flash Lite (latest)');
    expect(limits.requestsPerMinute).toBe(600);
    expect(limits.recommendedDelayMs).toBe(200);
  });

  it('should keep deprecated legacy Gemini models registered and marked', () => {
    const flash = config.getModelLimits('gemini-1.5-flash');
    const pro = config.getModelLimits('gemini-1.5-pro');

    expect(flash.deprecated).toBe(true);
    expect(pro.deprecated).toBe(true);
    // limits themselves are unchanged for backward compatibility
    expect(flash.requestsPerMinute).toBe(60);
  });

  it('should warn when a deprecated model is used', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    config.getModelLimits('gemini-1.5-flash');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warn.mockRestore();
  });

  it('should fall back to conservative defaults silently for an unregistered model', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const limits = config.getModelLimits('gemini-9.9-future-preview');

    expect(limits.name).toBe('Unknown Model');
    expect(limits.requestsPerMinute).toBe(10);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    warn.mockRestore();
    log.mockRestore();
  });
});
