import {
  buildTutorModelEnvironment,
  credentialId,
  resolveTutorModelId,
  validateModelConfiguration,
} from './model-config-store';

describe('model configuration', () => {
  const tutors = [
    {
      id: 'fast',
      label: 'Fast tutor',
      provider: 'gemini' as const,
      model: 'gemini/gemini-flash',
    },
    {
      id: 'deep',
      label: 'Deep tutor',
      provider: 'anthropic' as const,
      model: 'anthropic/claude-sonnet',
    },
  ];

  it('keeps the tutor selections and default', () => {
    expect(
      validateModelConfiguration({ tutors, defaultTutorId: 'fast' }),
    ).toEqual({ version: 1, tutors, defaultTutorId: 'fast' });
  });

  it('ignores a sensing model left in an older configuration', () => {
    expect(
      validateModelConfiguration({
        sensing: { ...tutors[0], id: 'sensing' },
        tutors,
        defaultTutorId: 'fast',
      } as Parameters<typeof validateModelConfiguration>[0]),
    ).toEqual({ version: 1, tutors, defaultTutorId: 'fast' });
  });

  it('rejects a missing default tutor', () => {
    expect(() =>
      validateModelConfiguration({ tutors, defaultTutorId: 'missing' }),
    ).toThrow('Choose a default tutor model.');
  });

  it('uses role-scoped credential IDs', () => {
    expect(credentialId('tutor', 'gemini')).toBe('tutor:gemini');
  });

  it('exports each tutor provider key and ignores old sensing keys', () => {
    const config = validateModelConfiguration({
      tutors,
      defaultTutorId: 'fast',
    });
    expect(
      buildTutorModelEnvironment(config, {
        'sensing:gemini': 'sensing-secret',
        'tutor:gemini': 'tutor-google-secret',
        'tutor:anthropic': 'tutor-anthropic-secret',
      }),
    ).toEqual({
      GEMINI_API_KEY: 'tutor-google-secret',
      ANTHROPIC_API_KEY: 'tutor-anthropic-secret',
    });
  });

  it('supports an optional key for an OpenAI-compatible endpoint', () => {
    const config = validateModelConfiguration({
      tutors: [
        {
          id: 'endpoint',
          label: 'Endpoint',
          provider: 'hosted_vllm',
          model: 'hosted_vllm/Qwen/Chat',
          baseUrl: 'https://inference.example.test/v1',
        },
      ],
      defaultTutorId: 'endpoint',
    });

    expect(
      buildTutorModelEnvironment(config, {
        'tutor:hosted_vllm': 'optional-endpoint-key',
      }),
    ).toMatchObject({
      HOSTED_VLLM_API_BASE: 'https://inference.example.test/v1',
      HOSTED_VLLM_API_KEY: 'optional-endpoint-key',
    });
  });

  it('routes an Inkling tutor through Tinker with a tutor-scoped key', () => {
    const config = validateModelConfiguration({
      tutors: [
        {
          id: 'voice',
          label: 'Voice tutor',
          provider: 'tinker',
          model: 'thinkingmachines/Inkling-Small:peft:262144',
        },
      ],
      defaultTutorId: 'voice',
    });

    expect(config.tutors[0].model).toBe(
      'tinker/thinkingmachines/Inkling-Small:peft:262144',
    );
    expect(
      buildTutorModelEnvironment(config, { 'tutor:tinker': 'tinker-secret' })
        .TINKER_API_KEY,
    ).toBe('tinker-secret');
  });
});

describe('shared Pi model assignments', () => {
  const pi = {
    id: 'pi-chat',
    label: 'Connected model',
    provider: 'pi' as const,
    model: 'pi/test/vendor/model',
  };
  it('does not export provider credentials for Pi models', () => {
    const config = validateModelConfiguration({
      tutors: [pi],
      defaultTutorId: pi.id,
    });
    expect(buildTutorModelEnvironment(config, {})).toEqual({});
  });
  it('drops incomplete Pi IDs', () => {
    expect(() =>
      validateModelConfiguration({
        tutors: [{ ...pi, model: 'pi/provider' }],
        defaultTutorId: pi.id,
      }),
    ).toThrow('Add at least one tutor model.');
  });
});

it('prefers managed configuration over the legacy environment model', () => {
  const config = validateModelConfiguration({
    tutors: [
      { id: 'chat', label: 'Chat', provider: 'pi', model: 'pi/test/chat' },
    ],
    defaultTutorId: 'chat',
  });
  expect(resolveTutorModelId(config, { TUTOR_MODEL: 'openai/legacy' })).toBe(
    'pi/test/chat',
  );
  expect(resolveTutorModelId(null, { TUTOR_MODEL: 'openai/chat' })).toBe(
    'openai/chat',
  );
});
